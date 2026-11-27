/**
 * 草の日数と PR 数を GitHub から取り、D1 に保存する（docs/spec.md §6.1）
 *
 *   1 日 1 回の Cron … 全員分。前回数えた日の次の日〜昨日の分だけ取って足す（普段は 1 日分）
 *   /register       … 登録した人 1 人分
 *   /ranking        … まだ一度も数えていない人（この仕組みより前に登録した人・登録時に失敗した人）の分だけ
 *
 * /ranking はここで保存した値を読むだけで、GitHub には問い合わせない
 */
import { greenDaysByMonth, lastFinishedDay, mergeMonths, planRanges } from "./contributions.ts";
import * as db from "./db.ts";
import type { Env } from "./env.ts";
import { fetchContributionBasics, fetchContributionDays } from "./github.ts";

/**
 * githubIds を渡したらその人だけ、省略したら登録者全員を更新する
 */
export async function syncContributions(env: Env, now: number, githubIds?: number[]): Promise<void> {
  // 登録者と保存してある月を同時に読む（同じ時点の値で計算するため）
  const snapshot = await db.loadContributionSnapshot(env.DB);
  const users = githubIds ? snapshot.users.filter((u) => githubIds.includes(u.github_id)) : snapshot.users;
  if (users.length === 0) return;

  const storedById = new Map<number, Map<string, number>>();
  for (const r of snapshot.months) {
    if (!storedById.has(r.github_id)) storedById.set(r.github_id, new Map());
    storedById.get(r.github_id)!.set(r.month, r.green_days);
  }

  const end = lastFinishedDay(now);
  const basics = await fetchContributionBasics(
    env,
    users.map((u) => u.github_login),
  );

  // GitHub で見つからない人・別人の名前になっている人（ID が違う）は更新しない（前の数字のまま）
  const targets = users.flatMap((u, i) => {
    const b = basics[i];
    if (!b || b.databaseId !== u.github_id) {
      console.warn(`GitHub ユーザー ${u.github_login} が見つからないため、草と PR 数を更新しません`);
      return [];
    }
    const stored = storedById.get(u.github_id) ?? new Map<string, number>();
    const syncedThrough = u.contributions_synced_through;
    // 前回 end まで数え終わっていれば、草は取らず PR 数だけ更新する
    const ranges = syncedThrough !== null && syncedThrough >= end ? [] : planRanges(b.years, new Set(stored.keys()), syncedThrough, end);
    return [{ user: u, basics: b, stored, ranges }];
  });

  const days = await fetchContributionDays(
    env,
    targets.filter((t) => t.ranges.length > 0).map((t) => ({ login: t.basics.login, ranges: t.ranges })),
  );

  const months: db.ContributionMonthRow[] = [];
  const stats: db.ContributionStatsUpdate[] = [];
  let k = 0;
  for (const t of targets) {
    if (t.ranges.length > 0) {
      // 問い合わせた期間の外の日が混ざっても数えないようにする
      const inRange = days[k++].filter((d) => t.ranges.some((r) => d.date >= r.from.slice(0, 10) && d.date <= r.to.slice(0, 10)));
      const merged = mergeMonths(t.stored, greenDaysByMonth(inRange), t.user.contributions_synced_through !== null);
      for (const [month, greenDays] of merged) months.push({ github_id: t.user.github_id, month, green_days: greenDays, fetched_at: now });
    }
    const syncedThrough = t.ranges.length > 0 ? end : t.user.contributions_synced_through;
    stats.push({ github_id: t.user.github_id, prs: t.basics.prs, contributions_synced_through: syncedThrough });
  }

  // 月の数と「どの日まで数えたか」は 1 つのまとまり（トランザクション）で保存する。途中で失敗したら全部なかったことになる
  await db.saveContributionSync(env.DB, months, stats);
}
