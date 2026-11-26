import { describe, expect, it } from "vitest";
import { buildCommitMessage, buildPrMessage } from "../src/cards.ts";

describe("buildPrMessage", () => {
  it("作成者・タイトル・リンク・リポジトリと番号を出す", () => {
    const m = buildPrMessage({
      login: "alice",
      avatarUrl: "https://avatars.example/alice",
      repo: "jyogi/web-app",
      number: 42,
      title: "ログイン画面に入力チェックを追加",
      createdAt: "2026-11-26T05:00:00Z",
    });
    const e = m.embeds[0];
    expect(e.author.name).toBe("alice がPRを作成しました");
    expect(e.title).toBe("ログイン画面に入力チェックを追加");
    expect(e.url).toBe("https://github.com/jyogi/web-app/pull/42");
    expect(e.footer.text).toBe("jyogi/web-app · #42");
    expect(m.allowed_mentions.parse).toEqual([]);
  });
});

describe("buildCommitMessage", () => {
  const base = {
    login: "bob",
    avatarUrl: "https://avatars.example/bob",
    repo: "jyogi/web-app",
    branch: "main",
    commits: [{ sha: "a1b2c3d4e5f6", title: "バリデーションを追加" }],
    createdAt: "2026-11-26T05:00:00Z",
  };

  it("件数とブランチを出す", () => {
    const e = buildCommitMessage({ ...base, count: 6 }).embeds[0];
    expect(e.author.name).toBe("bob が6件のcommitを追加しました");
    expect(e.footer.text).toBe("jyogi/web-app · main");
    expect(e.description).toBe("[`a1b2c3d`](https://github.com/jyogi/web-app/commit/a1b2c3d4e5f6) バリデーションを追加");
  });

  it("ブランチの初回 push は件数を出さない", () => {
    const e = buildCommitMessage({ ...base, count: null }).embeds[0];
    expect(e.author.name).toBe("bob がcommitを追加しました");
  });
});
