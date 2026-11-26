import { describe, expect, it } from "vitest";
import {
  ADMINISTRATOR,
  canPost,
  computeChannelPermissions,
  REQUIRED_FOR_POSTING,
  REQUIRED_FOR_THREAD_POSTING,
  SEND_MESSAGES,
  VIEW_CHANNEL,
} from "../src/discord/permissions.ts";

const GUILD = "100";
const BOT = "200";
const BOT_ROLE = "300";

const s = (n: bigint) => n.toString();

describe("computeChannelPermissions", () => {
  it("ロールに必要な権限があれば投稿できる", () => {
    const perms = computeChannelPermissions({
      guildId: GUILD,
      memberId: BOT,
      memberRoleIds: [BOT_ROLE],
      roles: [
        { id: GUILD, permissions: "0" },
        { id: BOT_ROLE, permissions: s(REQUIRED_FOR_POSTING) },
      ],
      overwrites: [],
    });
    expect(canPost(perms)).toBe(true);
  });

  it("チャンネルで @everyone の閲覧が拒否されていると投稿できない", () => {
    const perms = computeChannelPermissions({
      guildId: GUILD,
      memberId: BOT,
      memberRoleIds: [],
      roles: [{ id: GUILD, permissions: s(REQUIRED_FOR_POSTING) }],
      overwrites: [{ id: GUILD, type: 0, allow: "0", deny: s(VIEW_CHANNEL) }],
    });
    expect(canPost(perms)).toBe(false);
  });

  it("@everyone で拒否されていても、Bot のロールで許可されていれば投稿できる", () => {
    const perms = computeChannelPermissions({
      guildId: GUILD,
      memberId: BOT,
      memberRoleIds: [BOT_ROLE],
      roles: [
        { id: GUILD, permissions: s(REQUIRED_FOR_POSTING) },
        { id: BOT_ROLE, permissions: "0" },
      ],
      overwrites: [
        { id: GUILD, type: 0, allow: "0", deny: s(VIEW_CHANNEL | SEND_MESSAGES) },
        { id: BOT_ROLE, type: 0, allow: s(VIEW_CHANNEL | SEND_MESSAGES), deny: "0" },
      ],
    });
    expect(canPost(perms)).toBe(true);
  });

  it("スレッドには「スレッドでメッセージを送る」が要る（「メッセージを送る」だけでは不可）", () => {
    const base = { guildId: GUILD, memberId: BOT, memberRoleIds: [], overwrites: [] };
    const sendOnly = computeChannelPermissions({ ...base, roles: [{ id: GUILD, permissions: s(REQUIRED_FOR_POSTING) }] });
    expect(canPost(sendOnly, true)).toBe(false);

    const threadOk = computeChannelPermissions({ ...base, roles: [{ id: GUILD, permissions: s(REQUIRED_FOR_THREAD_POSTING) }] });
    expect(canPost(threadOk, true)).toBe(true);
  });

  it("管理者権限があれば上書きに関係なく投稿できる", () => {
    const perms = computeChannelPermissions({
      guildId: GUILD,
      memberId: BOT,
      memberRoleIds: [BOT_ROLE],
      roles: [
        { id: GUILD, permissions: "0" },
        { id: BOT_ROLE, permissions: s(ADMINISTRATOR) },
      ],
      overwrites: [{ id: BOT, type: 1, allow: "0", deny: s(REQUIRED_FOR_POSTING) }],
    });
    expect(canPost(perms)).toBe(true);
  });
});
