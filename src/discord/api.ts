/**
 * Discord REST API の呼び出し（Bot トークンで認証）
 *
 *   POST /channels/{channel_id}/messages       … タイムラインへの投稿
 *   GET  /guilds/{guild_id}/members/{user_id}  … Bot に付いているロール（権限確認用）
 *   GET  /guilds/{guild_id}/roles              … ロールごとの権限（権限確認用）
 *   GET  /channels/{channel_id}                … チャンネルの権限上書き（権限確認用）
 */
import type { RequestBudget } from "../budget.ts";
import type { DiscordMessage } from "../cards.ts";
import type { Env } from "../env.ts";
import type { GuildRole, PermissionOverwrite } from "./permissions.ts";

const API = "https://discord.com/api/v10";

/** Discord のレート制限にかかった。この実行はここで打ち切る */
export class DiscordRateLimitError extends Error {
  constructor() {
    super("Discord API のレート制限にかかりました");
  }
}

/** 投稿に失敗した（権限不足・チャンネル削除など）。このユーザーの処理を止め、次回やり直す */
export class PostFailedError extends Error {
  constructor(status: number, body: string) {
    super(`Discord への投稿に失敗しました（HTTP ${status}）: ${body}`);
  }
}

function request(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (https://github.com/jyogi-web/sinchoku-timeline, 0.1.0)",
      ...init.headers,
    },
  });
}

export async function postMessage(env: Env, budget: RequestBudget, channelId: string, message: DiscordMessage): Promise<void> {
  budget.spend();
  const res = await request(env, `/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify(message) });
  if (res.status === 429) throw new DiscordRateLimitError();
  if (!res.ok) throw new PostFailedError(res.status, await res.text());
}

async function getJson<T>(env: Env, path: string): Promise<T> {
  const res = await request(env, path);
  if (!res.ok) throw new Error(`Discord API エラー: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export function getGuildMember(env: Env, guildId: string, userId: string) {
  return getJson<{ roles: string[] }>(env, `/guilds/${guildId}/members/${userId}`);
}

export function getGuildRoles(env: Env, guildId: string) {
  return getJson<GuildRole[]>(env, `/guilds/${guildId}/roles`);
}

export function getChannel(env: Env, channelId: string) {
  return getJson<{ id: string; permission_overwrites?: PermissionOverwrite[] }>(env, `/channels/${channelId}`);
}
