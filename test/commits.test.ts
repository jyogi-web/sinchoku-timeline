import { describe, expect, it } from "vitest";
import { commitTitle, isZeroSha, newestFirst, pickOwnCommits } from "../src/commits.ts";
import type { GitHubCommit } from "../src/github.ts";

const BOB = { id: 1001, login: "bob" };
const ALICE = { id: 2002, login: "alice" };
const WEB_FLOW = { id: 19864447, login: "web-flow" };

function commit(sha: string, opts: { author?: typeof BOB | null; committer?: typeof BOB | null; parents?: number; message?: string } = {}): GitHubCommit {
  const author = opts.author === undefined ? BOB : opts.author;
  return {
    sha,
    commit: { message: opts.message ?? `commit ${sha}` },
    author,
    committer: opts.committer === undefined ? author : opts.committer,
    parents: Array.from({ length: opts.parents ?? 1 }, (_, i) => ({ sha: `p${i}` })),
  };
}

describe("pickOwnCommits", () => {
  it("本人の commit だけを残す", () => {
    const result = pickOwnCommits([commit("a"), commit("b", { author: ALICE }), commit("c")], BOB.id);
    expect(result.map((c) => c.sha)).toEqual(["a", "c"]);
  });

  it("マージ commit を除外する", () => {
    const result = pickOwnCommits([commit("a"), commit("m", { parents: 2 })], BOB.id);
    expect(result.map((c) => c.sha)).toEqual(["a"]);
  });

  it("GitHub の画面で作られた commit（web-flow）を除外する", () => {
    const result = pickOwnCommits([commit("a"), commit("s", { committer: WEB_FLOW })], BOB.id);
    expect(result.map((c) => c.sha)).toEqual(["a"]);
  });

  it("作者が不明でも、マージを含まない push なら本人扱いにする", () => {
    const result = pickOwnCommits([commit("a", { author: null }), commit("b")], BOB.id);
    expect(result.map((c) => c.sha)).toEqual(["a", "b"]);
  });

  it("マージを含む push では、作者が不明な commit を除外する", () => {
    const result = pickOwnCommits(
      [commit("x", { author: null }), commit("m", { parents: 2 }), commit("b")],
      BOB.id,
    );
    expect(result.map((c) => c.sha)).toEqual(["b"]);
  });

  it("仕様書の例：bob が alice の commit を取り込んで push した", () => {
    const pushed = [
      commit("A"),
      commit("M", { parents: 2, message: "Merge branch 'main' into feature/login" }),
      commit("C", { author: ALICE }),
      commit("D", { author: ALICE }),
      commit("B"),
    ];
    expect(pickOwnCommits(pushed, BOB.id).map((c) => c.sha)).toEqual(["A", "B"]);
  });

  it("他人の PR を GitHub の画面でマージした push は 0 件になる", () => {
    const merged = [commit("C", { author: ALICE }), commit("M", { parents: 2, committer: WEB_FLOW })];
    expect(pickOwnCommits(merged, BOB.id)).toEqual([]);
  });
});

describe("newestFirst", () => {
  it("新しい方から 5 件を新しい順で返す", () => {
    const commits = ["1", "2", "3", "4", "5", "6", "7"].map((s) => commit(s));
    expect(newestFirst(commits).map((c) => c.sha)).toEqual(["7", "6", "5", "4", "3"]);
  });
});

describe("commitTitle", () => {
  it("1 行目だけを返す", () => {
    expect(commitTitle("ログインフォームを追加\n\n詳細な説明")).toBe("ログインフォームを追加");
  });
});

describe("isZeroSha", () => {
  it("すべて 0 の SHA を判定する", () => {
    expect(isZeroSha("0000000000000000000000000000000000000000")).toBe(true);
    expect(isZeroSha("2603744cb92ced525f8c749f339c18ef5c6c0d38")).toBe(false);
  });
});
