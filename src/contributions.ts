/**
 * 草の日数を月ごとに扱うための計算（docs/spec.md §6.1）
 * API や DB は呼ばず、「どの期間を GitHub に問い合わせるか」と「保存する値」を決めるだけ
 *
 * 日付・月・年の区切りはすべて UTC（GraphQL に渡す期間に合わせる）
 * 日付は "2026-11-27" の形の文字列で扱う
 */

/** GitHub に問い合わせる 1 回分の期間（contributionsCollection は 1 年以内しか指定できないので、年をまたがない） */
export interface DateRange {
  from: string; // ISO 8601（UTC）
  to: string;
  days: number; // 期間の日数（問い合わせの重さの目安）
}

const DAY_MS = 86_400_000;

/** "2026-11" */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** UTC の日付 "2026-11-27" */
export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function toMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

export function addDays(date: string, n: number): string {
  return utcDate(toMs(date) + n * DAY_MS);
}

/** 数え終わっている最後の日（＝昨日）。今日の分はまだ増えるので数えない */
export function lastFinishedDay(now: number): string {
  return addDays(utcDate(now), -1);
}

function monthEnd(year: number, month: number): string {
  return utcDate(Date.UTC(year, month, 1) - DAY_MS);
}

/** from〜to（両端を含む）を 1 つの期間にする */
function range(from: string, to: string): DateRange {
  return {
    from: `${from}T00:00:00.000Z`,
    to: `${to}T23:59:59.000Z`,
    days: Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1,
  };
}

/** from〜to を年の区切りで分ける。from > to なら空 */
function splitByYear(from: string, to: string): DateRange[] {
  const ranges: DateRange[] = [];
  let start = from;
  while (start <= to) {
    const yearEnd = `${start.slice(0, 4)}-12-31`;
    const end = yearEnd < to ? yearEnd : to;
    ranges.push(range(start, end));
    start = addDays(end, 1);
  }
  return ranges;
}

/**
 * 問い合わせる期間を決める。end は数える最後の日（普段は昨日）
 *
 * - syncedThrough がある（前回どこまで数えたか分かっている）人：その次の日〜end だけ取る（普段は 1 日分）
 * - ない人（初めての人・この仕組みより前に登録した人）：
 *     活動した年のうち保存のない月と、end の月の 1 日〜end を取る
 *     同じ年の中で取る月は、最初の月から最後の月までをまとめて 1 つの期間にする
 */
export function planRanges(
  years: number[],
  storedMonths: ReadonlySet<string>,
  syncedThrough: string | null,
  end: string,
): DateRange[] {
  if (syncedThrough !== null) return splitByYear(addDays(syncedThrough, 1), end);

  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5, 7));
  const needed = new Map<number, number[]>(); // 年 → 取る月
  const add = (y: number, m: number) => needed.set(y, [...(needed.get(y) ?? []), m]);

  for (const y of new Set(years)) {
    if (!Number.isInteger(y) || y > endYear) continue;
    const lastMonth = y === endYear ? endMonth - 1 : 12; // end の月より前の月
    for (let m = 1; m <= lastMonth; m++) if (!storedMonths.has(monthKey(y, m))) add(y, m);
  }
  add(endYear, endMonth);

  return [...needed.entries()]
    .sort(([a], [b]) => a - b)
    .map(([y, months]) => {
      const first = Math.min(...months);
      const last = Math.max(...months);
      const to = y === endYear && last === endMonth ? end : monthEnd(y, last);
      return range(`${monthKey(y, first)}-01`, to);
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

/**
 * 保存する月ごとの値を出す（足した後の値で上書きするので、同じ計算を 2 回しても数が増えない）
 * - incremental（前回の続きから取った）：保存してある数に、今回取った日の分を足す
 * - そうでない：取った月は、その月の頭から取っているので今回の数で置き換える
 */
export function mergeMonths(
  stored: ReadonlyMap<string, number>,
  fetched: ReadonlyMap<string, number>,
  incremental: boolean,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [month, n] of fetched) result.set(month, (incremental ? (stored.get(month) ?? 0) : 0) + n);
  return result;
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
