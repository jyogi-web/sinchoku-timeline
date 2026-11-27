/**
 * GitHub REST API の呼び出し
 *
 * 使う API（すべて運営側の PAT で認証する）
 *   GET /users/{username}                       … /register 時の存在確認と GitHub ID の取得
 *   GET /users/{username}/events/public         … ポーリング（ETag 付き）
 *   GET /repos/{owner}/{repo}/pulls/{number}    … PR のタイトル取得（イベントにタイトルが含まれないため）
 *   GET /repos/{owner}/{repo}/compare/{a}...{b} … push で増えた commit の一覧
 *   GET /repos/{owner}/{repo}/commits/{sha}     … ブランチ初回 push のときの最新 commit
 *   POST /graphql                               … /ranking の PR 数と草（REST には草を返す API がない）
 */
import type { RequestBudget } from "./budget.ts";
import type { Env } from "./env.ts";

const API = "https://api.github.com";

// ---- 型（使う部分だけ） ----

export interface GitHubActor {
  id: number;
  login: string;
  avatar_url: string;
}

export interface GitHubEvent {
  id: string; // 新しいものほど大きい数字（文字列で返る）
  type: string; // "PullRequestEvent" | "PushEvent" | ...
  actor: GitHubActor;
  repo: { name: string }; // "owner/repo"
  payload: unknown;
  created_at: string; // ISO 8601
}

export interface PullRequestEventPayload {
  action: string; // "opened" | "closed" | ...
  number: number;
}

export interface PushEventPayload {
  ref: string; // "refs/heads/main"
  before: string; // push 前のブランチの先頭 SHA
  head: string; // push 後のブランチの先頭 SHA
}

export interface GitHubCommit {
  sha: string;
  commit: { message: string };
  author: { id: number; login: string } | null; // GitHub アカウントに紐づかないメールだと null
  committer: { id: number; login: string } | null;
  parents: { sha: string }[];
}

export type EventsResult =
  | { status: "not_modified" }
  | { status: "ok"; events: GitHubEvent[]; etag: string | null }
  | { status: "not_found" };

/** レート制限にかかった。この実行はここで打ち切る */
export class GitHubRateLimitError extends Error {
  constructor(status: number) {
    super(`GitHub API のレート制限にかかりました（HTTP ${status}）`);
  }
}

// ---- 共通 ----

async function request(env: Env, path: string, budget?: RequestBudget, headers: Record<string, string> = {}): Promise<Response> {
  budget?.spend();
  const res = await fetch(API + path, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "sinchoku-timeline",
      ...headers,
    },
  });
  if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) {
    throw new GitHubRateLimitError(res.status);
  }
  return res;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`GitHub API エラー: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** GitHub のユーザー名として正しい形か（URL に埋め込む前のチェック） */
export function isValidLogin(login: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login);
}

function encodeRepo(fullName: string): string {
  const [owner, repo] = fullName.split("/");
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

// ---- 各 API ----

/** ユーザーの存在確認。いなければ null */
export async function fetchUser(env: Env, login: string): Promise<{ id: number; login: string } | null> {
  const res = await request(env, `/users/${encodeURIComponent(login)}`);
  if (res.status === 404) return null;
  return json(res);
}

/**
 * ユーザーの public なイベントを取得する（新しい順で返る）
 * 前回の ETag を If-None-Match に付け、変化がなければ 304 が返る（レート制限を消費しない）
 */
export async function fetchUserEvents(env: Env, budget: RequestBudget, login: string, etag: string | null): Promise<EventsResult> {
  const res = await request(
    env,
    `/users/${encodeURIComponent(login)}/events/public?per_page=100`,
    budget,
    etag ? { "If-None-Match": etag } : {},
  );
  if (res.status === 304) return { status: "not_modified" };
  if (res.status === 404) return { status: "not_found" };
  const events = await json<GitHubEvent[]>(res);
  return { status: "ok", events, etag: res.headers.get("ETag") };
}

/** PR のタイトルを取得する。PR が見つからなければ null */
export async function fetchPull(env: Env, budget: RequestBudget, repo: string, number: number): Promise<{ title: string } | null> {
  const res = await request(env, `/repos/${encodeRepo(repo)}/pulls/${number}`, budget);
  if (res.status === 404) return null;
  return json(res);
}

/** before と head の間にある commit（古い順）。比較できなければ null */
export async function fetchCompare(env: Env, budget: RequestBudget, repo: string, before: string, head: string): Promise<GitHubCommit[] | null> {
  const res = await request(env, `/repos/${encodeRepo(repo)}/compare/${before}...${head}`, budget);
  if (res.status === 404) return null;
  const body = await json<{ commits: GitHubCommit[] }>(res);
  return body.commits;
}

// ---- GraphQL（/ranking 用） ----

interface GraphQLError {
  type?: string; // "NOT_FOUND" など
  message: string;
}

/**
 * GraphQL API を呼ぶ
 * GraphQL はエラーでも HTTP 200 を返し、エラーは errors に入る。
 * 見つからないユーザーは NOT_FOUND になり、そのユーザーの部分だけ null で返るので、それ以外のエラーだけ投げる
 */
async function graphql<T>(env: Env, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(API + "/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "sinchoku-timeline",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) {
    throw new GitHubRateLimitError(res.status);
  }
  const body = await json<{ data?: T; errors?: GraphQLError[] }>(res);
  const fatal = (body.errors ?? []).filter((e) => e.type !== "NOT_FOUND");
  if (fatal.length > 0 || !body.data) throw new Error(`GitHub GraphQL エラー: ${JSON.stringify(body.errors)}`);
  return body.data;
}

/** 1 回の問い合わせにまとめる人数（クエリが大きくなりすぎないように） */
const GRAPHQL_CHUNK = 10;

export interface ContributionStats {
  login: string; // GitHub 上の正式なユーザー名
  prs: number; // 作成した PR の数
  years: { year: number; weeks: { contributionDays: { contributionCount: number }[] }[] }[]; // 年ごとの草
}

/**
 * 登録者の PR 数と、全期間の草（年ごとのカレンダー）を取得する
 * 見つからないユーザー（名前の変更・削除）は結果に含めない
 */
export async function fetchContributionStats(env: Env, logins: string[]): Promise<ContributionStats[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < logins.length; i += GRAPHQL_CHUNK) chunks.push(logins.slice(i, i + GRAPHQL_CHUNK));
  const results = await Promise.all(chunks.map((c) => fetchContributionChunk(env, c)));
  return results.flat();
}

async function fetchContributionChunk(env: Env, logins: string[]): Promise<ContributionStats[]> {
  const variables = Object.fromEntries(logins.map((l, i) => [`l${i}`, l]));
  const params = logins.map((_, i) => `$l${i}: String!`).join(", ");

  // 1 回目：PR 数と、活動した年の一覧
  type Basic = { login: string; pullRequests: { totalCount: number }; contributionsCollection: { contributionYears: number[] } } | null;
  const basic = await graphql<Record<string, Basic>>(
    env,
    `query(${params}) {
${logins.map((_, i) => `  u${i}: user(login: $l${i}) { login pullRequests { totalCount } contributionsCollection { contributionYears } }`).join("\n")}
}`,
    variables,
  );

  const found = logins
    .map((login, i) => ({ i, login, user: basic[`u${i}`] }))
    .filter((f): f is { i: number; login: string; user: NonNullable<Basic> } => {
      if (!f.user) console.warn(`GitHub ユーザー ${f.login} が見つからないため、ランキングから外します`);
      return f.user !== null && f.user !== undefined;
    });
  if (found.length === 0) return [];

  // 2 回目：年ごとのカレンダー（contributionsCollection は 1 回で最大 1 年分のため、年ごとに alias を並べる）
  // 年は API から返った整数なので、そのままクエリに埋め込む
  const yearsOf = (f: (typeof found)[number]) => f.user.contributionsCollection.contributionYears.filter(Number.isInteger);
  type Calendar = Record<string, { contributionCalendar: { weeks: { contributionDays: { contributionCount: number }[] }[] } }> | null;
  const withYears = found.filter((f) => yearsOf(f).length > 0);
  const calendars =
    withYears.length === 0
      ? {}
      : await graphql<Record<string, Calendar>>(
          env,
          `query(${withYears.map((f) => `$l${f.i}: String!`).join(", ")}) {
${withYears
  .map(
    (f) =>
      `  u${f.i}: user(login: $l${f.i}) {\n${yearsOf(f)
        .map(
          (y) =>
            `    y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") { contributionCalendar { weeks { contributionDays { contributionCount } } } }`,
        )
        .join("\n")}\n  }`,
  )
  .join("\n")}
}`,
          Object.fromEntries(withYears.map((f) => [`l${f.i}`, f.login])),
        );

  return found.map((f) => {
    const cal = (calendars as Record<string, Calendar>)[`u${f.i}`];
    return {
      login: f.user.login,
      prs: f.user.pullRequests.totalCount,
      years: yearsOf(f).map((y) => ({ year: y, weeks: cal?.[`y${y}`]?.contributionCalendar.weeks ?? [] })),
    };
  });
}

/** commit を 1 件取得する。見つからなければ null */
export async function fetchCommit(env: Env, budget: RequestBudget, repo: string, sha: string): Promise<GitHubCommit | null> {
  const res = await request(env, `/repos/${encodeRepo(repo)}/commits/${sha}`, budget);
  if (res.status === 404 || res.status === 422) return null;
  return json(res);
}
