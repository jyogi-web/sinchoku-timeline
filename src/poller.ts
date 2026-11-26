/**
 * ポーリング本体（docs/spec.md §4, §5）
 *
 * Cron で 5 分ごとに呼ばれる。登録者ごとに Events API を確認し、
 * 新しい PR の作成と（オンの人だけ）commit をタイムラインに流す。
 */
import { BudgetExceededError, RequestBudget } from "./budget.ts";
import { buildCommitMessage, buildPrMessage, type DiscordMessage } from "./cards.ts";
import { commitTitle, isZeroSha, newestFirst, pickOwnCommits } from "./commits.ts";
import * as db from "./db.ts";
import { DiscordRateLimitError, PostFailedError, postMessage } from "./discord/api.ts";
import type { Env } from "./env.ts";
import {
  fetchCommit,
  fetchCompare,
  fetchPull,
  fetchUserEvents,
  GitHubRateLimitError,
  type GitHubCommit,
  type GitHubEvent,
  type PullRequestEventPayload,
  type PushEventPayload,
} from "./github.ts";

/** 停止から復帰したとき、これより古いイベントは流さない（§5） */
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

export async function runPoll(env: Env, now = Date.now()): Promise<void> {
  const channelId = await db.getSetting(env.DB, db.SETTING_CHANNEL_ID);
  if (!channelId) {
    console.log("投稿先チャンネルが未設定のため、ポーリングをスキップしました");
    return;
  }

  const budget = new RequestBudget();
  const users = await db.listUsersForPolling(env.DB);

  for (const user of users) {
    if (!budget.canSpend(1)) break; // 残りは次回
    try {
      await pollUser(env, budget, channelId, user, now);
    } catch (e) {
      if (e instanceof BudgetExceededError || e instanceof GitHubRateLimitError || e instanceof DiscordRateLimitError) {
        console.log(`この回の処理を打ち切ります: ${e.message}`);
        break;
      }
      // その他のエラーはこのユーザーだけ飛ばして次へ
      console.error(`${user.github_login} の処理でエラー`, e);
    }
  }
}

async function pollUser(env: Env, budget: RequestBudget, channelId: string, user: db.UserRow, now: number): Promise<void> {
  const res = await fetchUserEvents(env, budget, user.github_login, user.etag);

  // 変化なし（304）／ユーザーが見つからない：確認した時刻だけ更新
  if (res.status !== "ok") {
    if (res.status === "not_found") console.log(`${user.github_login} が GitHub に見つかりません`);
    await db.savePollState(env.DB, user.discord_user_id, { etag: user.etag, lastEventId: user.last_event_id, lastPolledAt: now });
    return;
  }

  // API は新しい順で返すので、古い順に並べ替える
  const events = [...res.events].sort((a, b) => compareEventId(a.id, b.id));

  // 登録直後：過去分は流さず、最新のイベント ID を記録するだけ（§5）
  if (user.last_event_id === null) {
    const newest = events.at(-1)?.id ?? "0";
    await db.savePollState(env.DB, user.discord_user_id, { etag: res.etag, lastEventId: newest, lastPolledAt: now });
    return;
  }

  const lastId = user.last_event_id;
  const newEvents = events.filter((e) => compareEventId(e.id, lastId) > 0);

  let processedId = lastId;
  let completed = false;
  try {
    for (const event of newEvents) {
      await handleEvent(env, budget, channelId, user, event, now);
      processedId = event.id; // 1 件処理するたびに進める
    }
    completed = true;
  } catch (e) {
    // 投稿の失敗はこのユーザーだけ止めて、次回やり直す。それ以外は上に投げる
    if (!(e instanceof PostFailedError)) throw e;
    console.error(e.message);
  } finally {
    // 途中で止まったときは ETag を更新しない（更新すると次回 304 になり、残りを取りこぼす）
    // 確認時刻も更新しないので、次回も先頭の方で処理される
    await db.savePollState(env.DB, user.discord_user_id, {
      etag: completed ? res.etag : user.etag,
      lastEventId: processedId,
      lastPolledAt: completed ? now : user.last_polled_at,
    });
  }
}

/** イベント 1 件の処理。流さないものは何もせずに返る */
async function handleEvent(env: Env, budget: RequestBudget, channelId: string, user: db.UserRow, event: GitHubEvent, now: number): Promise<void> {
  if (now - Date.parse(event.created_at) > MAX_EVENT_AGE_MS) return;

  const message =
    event.type === "PullRequestEvent"
      ? await prMessage(env, budget, event)
      : event.type === "PushEvent" && user.push_enabled === 1
        ? await commitMessage(env, budget, event)
        : null;

  if (message) await postMessage(env, budget, channelId, message);
}

/** PR の作成（§3.1）。タイトルを取るために pulls API を 1 回呼ぶ */
async function prMessage(env: Env, budget: RequestBudget, event: GitHubEvent): Promise<DiscordMessage | null> {
  const payload = event.payload as PullRequestEventPayload;
  if (payload.action !== "opened") return null;

  budget.require(2); // PR の取得 + 投稿
  const pr = await fetchPull(env, budget, event.repo.name, payload.number);
  if (!pr) return null;

  return buildPrMessage({
    login: event.actor.login,
    avatarUrl: event.actor.avatar_url,
    repo: event.repo.name,
    number: payload.number,
    title: pr.title,
    createdAt: event.created_at,
  });
}

/** commit の追加（§3.2）。commit の一覧を取るために API を 1 回呼ぶ */
async function commitMessage(env: Env, budget: RequestBudget, event: GitHubEvent): Promise<DiscordMessage | null> {
  const payload = event.payload as PushEventPayload;
  if (!payload.ref.startsWith("refs/heads/")) return null; // タグの push は対象外
  if (isZeroSha(payload.head)) return null; // ブランチ削除

  budget.require(2); // commit の取得 + 投稿
  const repo = event.repo.name;

  let commits: GitHubCommit[] | null = null;
  let countKnown = true;
  if (!isZeroSha(payload.before)) {
    commits = await fetchCompare(env, budget, repo, payload.before, payload.head);
  }
  if (commits === null) {
    // ブランチの初回 push（または比較できなかった）：最新の 1 件だけ、件数なし
    budget.require(2);
    const head = await fetchCommit(env, budget, repo, payload.head);
    commits = head ? [head] : [];
    countKnown = false;
  }

  const own = pickOwnCommits(commits, event.actor.id);
  if (own.length === 0) return null; // 本人の commit がなければ流さない

  return buildCommitMessage({
    login: event.actor.login,
    avatarUrl: event.actor.avatar_url,
    repo,
    branch: payload.ref.slice("refs/heads/".length),
    commits: newestFirst(own).map((c) => ({ sha: c.sha, title: commitTitle(c.commit.message) })),
    count: countKnown ? own.length : null,
    createdAt: event.created_at,
  });
}

/** イベント ID（数字の文字列）の大小比較。桁数が多いので BigInt で比べる */
export function compareEventId(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
