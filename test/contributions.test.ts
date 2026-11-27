import { describe, expect, it } from "vitest";
import { addDays, greenDaysByMonth, lastFinishedDay, mergeMonths, packByDays, planRanges } from "../src/contributions.ts";

/** 期間を ["from の日付", "to の日付"] にして比べやすくする */
const dates = (ranges: { from: string; to: string }[]) => ranges.map((r) => [r.from.slice(0, 10), r.to.slice(0, 10)]);

/** 2026 年の 1〜10 月を保存してある状態 */
const THROUGH_OCT = new Set(Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`));

describe("日付", () => {
  it("昨日を UTC で出す（月・年をまたぐ）", () => {
    expect(lastFinishedDay(Date.UTC(2026, 10, 27, 0, 10))).toBe("2026-11-26");
    expect(lastFinishedDay(Date.UTC(2026, 11, 1, 0, 10))).toBe("2026-11-30");
    expect(lastFinishedDay(Date.UTC(2027, 0, 1, 0, 10))).toBe("2026-12-31");
  });

  it("日を足す（うるう年）", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("planRanges（前回の続きから）", () => {
  it("普段は昨日の 1 日分だけ取る", () => {
    const ranges = planRanges([2026], THROUGH_OCT, "2026-11-25", "2026-11-26");
    expect(ranges).toEqual([{ from: "2026-11-26T00:00:00.000Z", to: "2026-11-26T23:59:59.000Z", days: 1 }]);
  });

  it("取れなかった日があれば、まとめて取り戻す（年をまたぐときは分ける）", () => {
    const ranges = planRanges([2026], THROUGH_OCT, "2026-12-29", "2027-01-02");
    expect(dates(ranges)).toEqual([
      ["2026-12-30", "2026-12-31"],
      ["2027-01-01", "2027-01-02"],
    ]);
    expect(ranges.map((r) => r.days)).toEqual([2, 2]);
  });

  it("もう昨日まで数えてあれば何も取らない", () => {
    expect(planRanges([2026], THROUGH_OCT, "2026-11-26", "2026-11-26")).toEqual([]);
  });
});

describe("planRanges（まだ数えていない人）", () => {
  it("過去の月が保存してあれば、今月の 1 日〜昨日だけ取る", () => {
    expect(dates(planRanges([2026], THROUGH_OCT, null, "2026-11-26"))).toEqual([["2026-11-01", "2026-11-26"]]);
  });

  it("初めての人は、活動した年を 1 年ずつ取る（今年は昨日まで）", () => {
    const ranges = planRanges([2026, 2024, 2025], new Set(), null, "2026-11-26");
    expect(dates(ranges)).toEqual([
      ["2024-01-01", "2024-12-31"],
      ["2025-01-01", "2025-12-31"],
      ["2026-01-01", "2026-11-26"],
    ]);
    expect(ranges[0].days).toBe(366); // 2024 はうるう年
  });

  it("保存が欠けている月は、その月から取る", () => {
    const stored = new Set(THROUGH_OCT);
    stored.delete("2026-09");
    expect(dates(planRanges([2026], stored, null, "2026-11-26"))).toEqual([["2026-09-01", "2026-11-26"]]);
  });

  it("1 日に実行したら、昨日（先月の末日）までの先月の分を取る", () => {
    expect(dates(planRanges([2026], THROUGH_OCT, null, "2026-11-30"))).toEqual([["2026-11-01", "2026-11-30"]]);
  });

  it("活動した年がなくても、昨日の月は取る", () => {
    expect(dates(planRanges([], new Set(), null, "2026-11-26"))).toEqual([["2026-11-01", "2026-11-26"]]);
  });
});

describe("greenDaysByMonth", () => {
  it("月ごとに、contribution が 1 以上の日を数える", () => {
    const m = greenDaysByMonth([
      { date: "2026-10-30", contributionCount: 2 },
      { date: "2026-10-31", contributionCount: 0 },
      { date: "2026-11-01", contributionCount: 1 },
      { date: "2026-11-02", contributionCount: 5 },
    ]);
    expect([...m]).toEqual([
      ["2026-10", 1],
      ["2026-11", 2],
    ]);
  });

  it("草のない月も 0 として残す（保存して、次から取らないようにするため）", () => {
    expect(greenDaysByMonth([{ date: "2026-09-01", contributionCount: 0 }]).get("2026-09")).toBe(0);
  });
});

describe("mergeMonths", () => {
  const stored = new Map([
    ["2026-10", 20],
    ["2026-11", 5],
  ]);

  it("前回の続きから取ったときは、保存してある数に足す（月をまたいでも、その月に足す）", () => {
    const merged = mergeMonths(
      stored,
      new Map([
        ["2026-11", 1],
        ["2026-12", 1],
      ]),
      true,
    );
    expect([...merged]).toEqual([
      ["2026-11", 6],
      ["2026-12", 1],
    ]);
  });

  it("まだ数えていなかった人は、取った月を今回の数で置き換える", () => {
    expect([...mergeMonths(stored, new Map([["2026-11", 8]]), false)]).toEqual([["2026-11", 8]]);
  });

  it("同じ計算を 2 回しても同じ値になる（足した後の値で上書きするため）", () => {
    const fetched = new Map([["2026-11", 1]]);
    expect(mergeMonths(stored, fetched, true)).toEqual(mergeMonths(stored, fetched, true));
  });
});

describe("packByDays", () => {
  it("1 回あたりの日数が上限を超えないように分ける", () => {
    const groups = packByDays([{ days: 365 }, { days: 365 }, { days: 30 }, { days: 366 }], 800);
    expect(groups.map((g) => g.map((x) => x.days))).toEqual([[365, 365, 30], [366]]);
  });

  it("上限を超える 1 件はそれだけで 1 回にする", () => {
    expect(packByDays([{ days: 900 }, { days: 10 }], 800)).toHaveLength(2);
  });
});
