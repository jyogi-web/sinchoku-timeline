/**
 * 草の日数を月ごとに扱うための計算（docs/spec.md §6.1）
 * API や DB は呼ばず、「どの期間を GitHub に問い合わせるか」と「合計」を決めるだけ
 *
 * 月や年の区切りはすべて UTC（GraphQL に渡す期間に合わせる）
 */

/** 保存してある 1 か月分 */
export interface StoredMonth {
  greenDays: number;
  fetchedAt: number; // ms
}

/** GitHub に問い合わせる 1 回分の期間（contributionsCollection は 1 年以内しか指定できないので、年をまたがない） */
export interface DateRange {
  from: string; // ISO 8601（UTC）
  to: string;
  days: number; // 期間の日数（問い合わせの重さの目安）
}

/** "2026-11" */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthStart(year: number, month: number): number {
  return Date.UTC(year, month - 1, 1);
}

/** 保存した値が「その月が終わってから取ったもの」なら確定 */
export function isFinal(month: string, fetchedAt: number): boolean {
  const [y, m] = month.split("-").map(Number);
  return fetchedAt >= monthStart(y, m + 1);
}

/**
 * 問い合わせる期間を決める
 * - 今月は毎回取る
 * - 活動した年のうち、終わった月で「保存がない」「月の途中に取った」ものを取る
 * 同じ年の中で取る月は、最初の月から最後の月までをまとめて 1 つの期間にする
 */
export function planRanges(years: number[], stored: ReadonlyMap<string, StoredMonth>, now: number): DateRange[] {
  const today = new Date(now);
  const thisYear = today.getUTCFullYear();
  const thisMonth = today.getUTCMonth() + 1;

  const needed = new Map<number, number[]>(); // 年 → 取る月
  const add = (y: number, m: number) => needed.set(y, [...(needed.get(y) ?? []), m]);

  for (const y of new Set(years)) {
    if (!Number.isInteger(y) || y > thisYear) continue;
    const lastMonth = y === thisYear ? thisMonth - 1 : 12; // 終わった月まで
    for (let m = 1; m <= lastMonth; m++) {
      const s = stored.get(monthKey(y, m));
      if (!s || !isFinal(monthKey(y, m), s.fetchedAt)) add(y, m);
    }
  }
  add(thisYear, thisMonth);

  return [...needed.entries()]
    .sort(([a], [b]) => a - b)
    .map(([y, months]) => {
      const first = Math.min(...months);
      const last = Math.max(...months);
      const from = monthStart(y, first);
      const end = monthStart(y, last + 1); // 最後の月の翌月 1 日
      return {
        from: new Date(from).toISOString(),
        to: new Date(end - 1000).toISOString(), // 最後の月の末日 23:59:59
        days: Math.round((end - from) / 86_400_000),
      };
    });
}

/** 取得した日ごとの数を、月ごとの「草が生えた日数」にまとめる */
export function greenDaysByMonth(days: { date: string; contributionCount: number }[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const d of days) {
    const key = d.date.slice(0, 7); // "2026-11-27" → "2026-11"
    result.set(key, (result.get(key) ?? 0) + (d.contributionCount > 0 ? 1 : 0));
  }
  return result;
}

/** 保存してある月と今回取った月を合わせて、全期間の草の日数を出す（同じ月は今回取った方を使う） */
export function totalGreenDays(stored: ReadonlyMap<string, StoredMonth>, fetched: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const [month, s] of stored) if (!fetched.has(month)) total += s.greenDays;
  for (const n of fetched.values()) total += n;
  return total;
}

/**
 * 問い合わせを、1 回あたりの日数が maxDays 以下になるように分ける（GitHub の処理上限対策）
 * 1 つの期間が maxDays を超えていても、それだけで 1 回にする
 */
export function packByDays<T extends { days: number }>(items: T[], maxDays: number): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let sum = 0;
  for (const item of items) {
    if (current.length > 0 && sum + item.days > maxDays) {
      groups.push(current);
      current = [];
      sum = 0;
    }
    current.push(item);
    sum += item.days;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
