import { describe, expect, it } from "vitest";
import { buildRankingText, rankStats, type RankingStats } from "../src/ranking.ts";

describe("rankStats", () => {
  it("PR 数の多い順に並べ、同じ PR 数は同率にする（1, 2, 2, 4）", () => {
    const ranked = rankStats([
      { login: "dave", prs: 10, days: 5 },
      { login: "alice", prs: 52, days: 320 },
      { login: "carol", prs: 41, days: 150 },
      { login: "bob", prs: 41, days: 298 },
    ]);
    expect(ranked.map((r) => [r.rank, r.login])).toEqual([
      [1, "alice"],
      [2, "bob"], // 同率の中は草の日数が多い順
      [2, "carol"],
      [4, "dave"],
    ]);
  });

  it("PR 数も草の日数も同じなら GitHub 名順（大文字小文字は区別しない）", () => {
    const ranked = rankStats([
      { login: "bob", prs: 1, days: 1 },
      { login: "Alice", prs: 1, days: 1 },
    ]);
    expect(ranked.map((r) => [r.rank, r.login])).toEqual([
      [1, "Alice"],
      [1, "bob"],
    ]);
  });
});

/** PR 数が n, n-1, … と 1 ずつ減る人を count 人作る */
function people(count: number): RankingStats[] {
  return Array.from({ length: count }, (_, i) => ({ login: `user${i + 1}`, prs: 100 - i, days: 50 }));
}

describe("buildRankingText", () => {
  it("見出しと 1 行ごとの表示", () => {
    const text = buildRankingText(
      rankStats([
        { login: "alice", prs: 52, days: 320 },
        { login: "bob", prs: 41, days: 298 },
      ]),
      "alice",
    );
    expect(text).toBe(["PRランキング（登録者 2人）", "1. alice　52件（草 320日）", "2. bob　41件（草 298日）"].join("\n"));
  });

  it("10 位までを出し、11 位以下の人が実行したら最後にその人の順位を付ける", () => {
    const text = buildRankingText(rankStats(people(15)), "user15");
    const lines = text.split("\n");
    expect(lines.filter((l) => /^\d+\. /.test(l))).toHaveLength(10);
    expect(text).not.toContain("11. ");
    expect(lines.at(-1)).toBe("user15 は15位です。86件（草 50日）");
  });

  it("10 位以内の人が実行したときは、最後の行を付けない", () => {
    const text = buildRankingText(rankStats(people(15)), "user3");
    expect(text).not.toContain("位です。");
  });

  it("10 位が同率なら全員出す", () => {
    const stats = [...people(9), { login: "tie-a", prs: 1, days: 3 }, { login: "tie-b", prs: 1, days: 2 }];
    const text = buildRankingText(rankStats(stats), "tie-b");
    expect(text).toContain("10. tie-a　1件（草 3日）");
    expect(text).toContain("10. tie-b　1件（草 2日）");
    expect(text).not.toContain("位です。"); // 表示されているので付けない
  });

  it("未登録の人が実行したら、ランキングのあとに登録の案内を付ける", () => {
    const text = buildRankingText(rankStats(people(3)), null);
    expect(text.startsWith("PRランキング（登録者 3人）")).toBe(true);
    expect(text.split("\n").at(-1)).toBe("/register で登録すると、ランキングに参加できます。");
  });

  it("GitHub 名の大文字小文字が登録時と違っても本人として扱う", () => {
    const text = buildRankingText(rankStats(people(12)), "USER12");
    expect(text.split("\n").at(-1)).toBe("user12 は12位です。89件（草 50日）");
  });

  it("登録者が 0 人", () => {
    expect(buildRankingText([], "alice")).toBe("登録者はいません。");
    expect(buildRankingText([], null)).toBe("登録者はいません。\n\n/register で登録すると、ランキングに参加できます。");
  });

  it("同率が多すぎて 2000 文字を超えるときは、収まるところまで減らす", () => {
    const stats = [{ login: "top", prs: 9, days: 1 }, ...Array.from({ length: 200 }, (_, i) => ({ login: `zero-user-${i}`, prs: 0, days: 0 }))];
    const text = buildRankingText(rankStats(stats), null);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toContain("…");
    expect(text.split("\n").at(-1)).toBe("/register で登録すると、ランキングに参加できます。");
  });
});
