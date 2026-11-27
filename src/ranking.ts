/**
 * /ranking の集計と表示（docs/spec.md §6.1, §8.5）
 * API は呼ばず、受け取った値から順位を付けて文章を作るだけ
 */
import { ranking as text } from "./messages.ts";

export interface RankingStats {
  login: string; // GitHub 上の正式なユーザー名
  prs: number; // 作成した PR の数
  days: number; // 草が生えた日数（全期間）
}

export interface RankedStats extends RankingStats {
  rank: number;
}

/** 表示する順位の上限（同率なら超えても全員出す） */
export const TOP_RANK = 10;

/** Discord のメッセージ本文の上限 */
const MAX_CONTENT = 2000;

/**
 * PR 数の多い順に並べて順位を付ける。同じ PR 数は同率（1, 2, 2, 4 …）
 * 同率の中は草の日数が多い順、次に GitHub 名順
 */
export function rankStats(stats: RankingStats[]): RankedStats[] {
  const sorted = [...stats].sort(
    (a, b) => b.prs - a.prs || b.days - a.days || a.login.toLowerCase().localeCompare(b.login.toLowerCase()),
  );
  const ranked: RankedStats[] = [];
  sorted.forEach((s, i) => {
    const prev = ranked[i - 1];
    ranked.push({ ...s, rank: prev && prev.prs === s.prs ? prev.rank : i + 1 });
  });
  return ranked;
}

/**
 * ランキングの本文を作る
 * me: 実行した人の GitHub 名。未登録なら null
 */
export function buildRankingText(ranked: RankedStats[], me: string | null): string {
  const footer: string[] = [];
  if (me === null) {
    footer.push(text.joinGuide());
  } else {
    const mine = ranked.find((r) => sameLogin(r.login, me));
    if (mine && mine.rank > TOP_RANK) footer.push(text.yours(mine.login, mine.rank, mine.prs, mine.days));
  }

  if (ranked.length === 0) return [text.empty(), ...footer].join("\n\n");

  const lines = ranked.filter((r) => r.rank <= TOP_RANK).map((r) => text.line(r.rank, r.login, r.prs, r.days));
  const build = (rows: string[], cut: boolean) =>
    [[text.heading(ranked.length), ...rows, ...(cut ? ["…"] : [])].join("\n"), ...footer].join("\n\n");

  // 同率が多くて長くなりすぎたときは、収まるところまで行を減らす
  let content = build(lines, false);
  while (content.length > MAX_CONTENT && lines.length > 0) {
    lines.pop();
    content = build(lines, true);
  }
  return content;
}

function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
