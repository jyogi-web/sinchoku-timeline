import { describe, expect, it } from "vitest";
import { greenDaysByMonth, isFinal, packByDays, planRanges, totalGreenDays, type StoredMonth } from "../src/contributions.ts";

const NOW = Date.UTC(2026, 10, 27, 12); // 2026-11-27 12:00 UTC
const AFTER = (y: number, m: number) => Date.UTC(y, m, 1, 0, 5); // その月が終わったあと（翌月 1 日）
const DURING = (y: number, m: number) => Date.UTC(y, m - 1, 15); // その月の途中

/** 2026 年の 1〜10 月を確定済みで保存してある状態 */
function storedThrough2026Oct(): Map<string, StoredMonth> {
  const s = new Map<string, StoredMonth>();
  for (let m = 1; m <= 10; m++) s.set(`2026-${String(m).padStart(2, "0")}`, { greenDays: 1, fetchedAt: AFTER(2026, m) });
  return s;
}

describe("isFinal", () => {
  it("月が終わってから取ったものだけ確定", () => {
    expect(isFinal("2026-10", Date.UTC(2026, 10, 1))).toBe(true); // 11/1 0:00
    expect(isFinal("2026-10", Date.UTC(2026, 9, 31, 23))).toBe(false); // 10/31 23:00
    expect(isFinal("2026-12", Date.UTC(2027, 0, 1))).toBe(true); // 年をまたぐ
  });
});

describe("planRanges", () => {
  it("保存がそろっていれば、今月だけ取る", () => {
    const ranges = planRanges([2026], storedThrough2026Oct(), NOW);
    expect(ranges).toEqual([{ from: "2026-11-01T00:00:00.000Z", to: "2026-11-30T23:59:59.000Z", days: 30 }]);
  });

  it("初めての人は、活動した年を 1 年ずつ取る（今年は今月まで）", () => {
    const ranges = planRanges([2026, 2024, 2025], new Map(), NOW);
    expect(ranges.map((r) => [r.from.slice(0, 10), r.to.slice(0, 10)])).toEqual([
      ["2024-01-01", "2024-12-31"],
      ["2025-01-01", "2025-12-31"],
      ["2026-01-01", "2026-11-30"],
    ]);
    expect(ranges[0].days).toBe(366); // 2024 はうるう年
  });

  it("月の途中に取った先月の分は、月が変わったら取り直す", () => {
    const stored = storedThrough2026Oct();
    stored.set("2026-10", { greenDays: 3, fetchedAt: DURING(2026, 10) });
    const ranges = planRanges([2026], stored, NOW);
    expect(ranges.map((r) => [r.from.slice(0, 10), r.to.slice(0, 10)])).toEqual([["2026-10-01", "2026-11-30"]]);
  });

  it("年が明けたら、去年の 12 月を取り直し、今年の 1 月を取る", () => {
    const stored = new Map<string, StoredMonth>();
    for (let m = 1; m <= 12; m++) stored.set(`2026-${String(m).padStart(2, "0")}`, { greenDays: 1, fetchedAt: m === 12 ? DURING(2026, 12) : AFTER(2026, m) });
    const ranges = planRanges([2026], stored, Date.UTC(2027, 0, 3));
    expect(ranges.map((r) => [r.from.slice(0, 10), r.to.slice(0, 10)])).toEqual([
      ["2026-12-01", "2026-12-31"],
      ["2027-01-01", "2027-01-31"],
    ]);
  });

  it("活動した年がなくても今月は取る", () => {
    expect(planRanges([], new Map(), NOW)).toHaveLength(1);
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

describe("totalGreenDays", () => {
  it("保存してある月と今回取った月を足す。同じ月は今回取った方を使う", () => {
    const stored = new Map<string, StoredMonth>([
      ["2026-09", { greenDays: 10, fetchedAt: 0 }],
      ["2026-10", { greenDays: 3, fetchedAt: 0 }],
    ]);
    const fetched = new Map([
      ["2026-10", 20],
      ["2026-11", 5],
    ]);
    expect(totalGreenDays(stored, fetched)).toBe(10 + 20 + 5);
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
