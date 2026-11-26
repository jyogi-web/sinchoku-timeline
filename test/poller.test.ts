import { describe, expect, it } from "vitest";
import { compareEventId } from "../src/poller.ts";

describe("compareEventId", () => {
  it("桁数の多いイベント ID を数値として比べる", () => {
    expect(compareEventId("51736382612", "9999999999")).toBe(1); // 文字列比較だと逆になる
    expect(compareEventId("100", "100")).toBe(0);
    expect(compareEventId("99", "100")).toBe(-1);
  });
});
