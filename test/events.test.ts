import { describe, expect, it } from "vitest";
import { nextSeenIds, parseSeenIds, selectNewEvents } from "../src/events.ts";
import type { GitHubEvent } from "../src/github.ts";

function ev(id: string, createdAt: string, type = "PullRequestEvent"): GitHubEvent {
  return {
    id,
    type,
    actor: { id: 1, login: "bob", avatar_url: "" },
    repo: { name: "jyogi/web-app" },
    payload: {},
    created_at: createdAt,
  };
}

describe("selectNewEvents", () => {
  it("前回見た ID にないものだけを古い順で返す", () => {
    const events = [ev("3", "2026-11-26T03:00:00Z"), ev("2", "2026-11-26T02:00:00Z"), ev("1", "2026-11-26T01:00:00Z")];
    const result = selectNewEvents(events, new Set(["1"]));
    expect(result.map((e) => e.id)).toEqual(["2", "3"]);
  });

  it("ID の大小に関係なく判定する（実データ：PushEvent だけ ID が大きい）", () => {
    // 登録直後に見えていたのは ID の大きい PushEvent。その後に ID の小さい PR のイベントが来る
    const events = [
      ev("21347330820", "2026-11-26T06:04:12Z", "PullRequestEvent"),
      ev("26820064995", "2026-11-09T13:54:13Z", "PushEvent"),
    ];
    const result = selectNewEvents(events, new Set(["26820064995"]));
    expect(result.map((e) => e.id)).toEqual(["21347330820"]);
  });

  it("反映が遅れて後から出てきた古い日時のイベントも拾う", () => {
    const events = [ev("B", "2026-11-26T07:00:00Z"), ev("LATE", "2026-11-26T06:00:00Z"), ev("A", "2026-11-26T05:00:00Z")];
    const result = selectNewEvents(events, new Set(["A", "B"]));
    expect(result.map((e) => e.id)).toEqual(["LATE"]);
  });
});

describe("nextSeenIds", () => {
  const events = [ev("3", "2026-11-26T03:00:00Z"), ev("2", "2026-11-26T02:00:00Z"), ev("1", "2026-11-26T01:00:00Z")];

  it("すべて処理できたら、今回見えた ID をすべて記録する", () => {
    expect(nextSeenIds(events, new Set(["1"]), new Set(["2", "3"]))).toEqual(["3", "2", "1"]);
  });

  it("途中で止まったら、処理していない ID は記録しない（次回やり直す）", () => {
    expect(nextSeenIds(events, new Set(["1"]), new Set(["2"]))).toEqual(["2", "1"]);
  });

  it("今回の結果に含まれない古い ID は捨てる（一覧が増え続けない）", () => {
    expect(nextSeenIds(events, new Set(["1", "0", "-1"]), new Set(["2", "3"]))).toEqual(["3", "2", "1"]);
  });
});

describe("parseSeenIds", () => {
  it("JSON 配列を読み込む。壊れていたら空にする", () => {
    expect([...parseSeenIds('["1","2"]')]).toEqual(["1", "2"]);
    expect(parseSeenIds("not json").size).toBe(0);
  });
});
