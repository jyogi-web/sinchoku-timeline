/**
 * 草の日数を GitHub から取り、月ごとに D1 に保存しながら集計する（docs/spec.md §6.1）
 *
 *   /register … 登録した人 1 人分を取る（過去の分をここで保存しておく）
 *   /ranking  … 全員分。普段は今月の分だけ取り、保存してある月と合わせる。
 *               保存が欠けている人（この仕組みより前に登録した人・登録時に失敗した人）はその分も取る
 */
import { greenDaysByMonth, monthKey, planRanges, totalGreenDays, type StoredMonth } from "./contributions.ts";
import * as db from "./db.ts";
import type { Env } from "./env.ts";
import { fetchContributionBasics, fetchContributionDays } from "./github.ts";
import type { RankingStats } from "./ranking.ts";

export async function syncContributions(
  env: Env,
  users: { github_login: string; github_id: number }[],
  now: number,
): Promise<RankingStats[]> {
  if (users.length === 0) return [];

  const [basics, rows] = await Promise.all([
    fetchContributionBasics(
      env,
      users.map((u) => u.github_login),
    ),
    db.listContributionMonths(env.DB),
  ]);

  const storedById = new Map<number, Map<string, StoredMonth>>();
  for (const r of rows) {
    if (!storedById.has(r.github_id)) storedById.set(r.github_id, new Map());
    storedById.get(r.github_id)!.set(r.month, { greenDays: r.green_days, fetchedAt: r.fetched_at });
  }

  // GitHub で見つからない人・別人の名前になっている人（ID が違う）は外す
  const targets = users.flatMap((u, i) => {
    const b = basics[i];
    if (!b || b.databaseId !== u.github_id) {
      console.warn(`GitHub ユーザー ${u.github_login} が見つからないため、ランキングから外します`);
      return [];
    }
    const stored = storedById.get(u.github_id) ?? new Map<string, StoredMonth>();
    return [{ githubId: u.github_id, basics: b, stored, ranges: planRanges(b.years, stored, now) }];
  });

  const days = await fetchContributionDays(
    env,
    targets.map((t) => ({ login: t.basics.login, ranges: t.ranges })),
  );

  const thisMonth = monthKey(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1);
  const toSave: db.ContributionMonthRow[] = [];
  const stats = targets.map((t, i) => {
    // 問い合わせた期間の外の日が混ざっても数えないようにする
    const inRange = days[i].filter((d) => t.ranges.some((r) => d.date >= r.from.slice(0, 10) && d.date <= r.to.slice(0, 10)));
    const fetched = greenDaysByMonth(inRange);
    // 今月はまだ増えるので保存しない（毎回取る）
    for (const [month, greenDays] of fetched) {
      if (month < thisMonth) toSave.push({ github_id: t.githubId, month, green_days: greenDays, fetched_at: now });
    }
    return { login: t.basics.login, prs: t.basics.prs, days: totalGreenDays(t.stored, fetched) };
  });

  await db.saveContributionMonths(env.DB, toSave);
  return stats;
}
