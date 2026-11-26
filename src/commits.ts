/**
 * push に含まれる commit の絞り込み（docs/spec.md §3.2）
 * API は呼ばず、受け取った配列をふるいにかけるだけ
 */
import type { GitHubCommit } from "./github.ts";

/** 表示する commit の最大件数 */
export const MAX_COMMITS_SHOWN = 5;

/** "0000…" の SHA（ブランチ作成時の before / ブランチ削除時の head） */
export function isZeroSha(sha: string): boolean {
  return /^0+$/.test(sha);
}

/**
 * push した本人が書いた commit だけを残す
 *
 * 除外するもの
 *   1. マージ commit（親が 2 つ以上）
 *   2. GitHub の画面上で作られた commit（committer が web-flow）
 *   3. 作者が push した本人ではない commit（ユーザー名ではなく ID で比較）
 *   4. 作者が不明（null）で、かつ同じ push の中にマージ commit があるもの
 */
export function pickOwnCommits(commits: GitHubCommit[], pusherId: number): GitHubCommit[] {
  const hasMerge = commits.some((c) => c.parents.length >= 2);

  return commits.filter((c) => {
    if (c.parents.length >= 2) return false;
    if (c.committer?.login === "web-flow") return false;
    if (c.author === null) return !hasMerge;
    return c.author.id === pusherId;
  });
}

/** 表示用に、新しい方から最大 5 件を新しい順で返す（API は古い順で返す） */
export function newestFirst(commits: GitHubCommit[]): GitHubCommit[] {
  return commits.slice(-MAX_COMMITS_SHOWN).reverse();
}

/** commit メッセージの 1 行目 = タイトル */
export function commitTitle(message: string): string {
  return message.split("\n")[0].trim();
}
