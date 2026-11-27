/**
 * スラッシュコマンドの処理（docs/spec.md §6）
 *
 * Discord から届いた Interaction（コマンドの実行）を受け取り、応答の JSON を返す。
 * Discord は 3 秒以内に応答しないとタイムアウト扱いにするので、重い処理はしない。
 * 時間のかかる処理（/ranking）は先に応答を返し、ctx.waitUntil で続きを処理してから応答を書き換える。
 */
import * as db from "../db.ts";
import type { Env } from "../env.ts";
import { fetchContributionStats, fetchUser, isValidLogin } from "../github.ts";
import { helpText, list, msg, ranking as rankingText } from "../messages.ts";
import { buildRankingText, countGreenDays, rankStats } from "../ranking.ts";
import { editOriginalResponse, getChannel, getGuildMember, getGuildRoles } from "./api.ts";
import { canPost, computeChannelPermissions, isThread } from "./permissions.ts";

// ---- Interaction の型（使う部分だけ） ----

interface CommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: CommandOption[];
}

export interface Interaction {
  type: number; // 1 = PING, 2 = APPLICATION_COMMAND
  token: string; // 応答の書き換えに使う（15 分有効）
  guild_id?: string;
  member?: { user: { id: string } }; // サーバー内で実行されたとき
  user?: { id: string }; // DM で実行されたとき
  data?: { name: string; options?: CommandOption[] };
}

export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 } as const;

const CHANNEL_MESSAGE_WITH_SOURCE = 4;
const EPHEMERAL = 1 << 6; // 実行した本人にだけ見える

/** コマンドへの応答（ephemeral = true なら本人にだけ表示） */
function reply(content: string, ephemeral = true): Response {
  return Response.json({
    type: CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } },
  });
}

export async function handleCommand(env: Env, interaction: Interaction, ctx: ExecutionContext): Promise<Response> {
  const userId = interaction.member?.user.id ?? interaction.user?.id;
  const data = interaction.data;
  if (!userId || !data) return reply(msg.internalError());

  try {
    switch (data.name) {
      case "register":
        return await register(env, userId, String(data.options?.[0]?.value ?? ""));
      case "unregister":
        return await unregister(env, userId);
      case "push":
        return await push(env, userId, data.options?.[0]?.name === "on");
      case "list":
        return await listUsers(env);
      case "ranking":
        return await ranking(env, interaction.token, userId, ctx);
      case "config":
        return await config(env, interaction, data.options?.[0]);
      case "help":
        return reply(helpText(await db.getSetting(env.DB, db.SETTING_CHANNEL_ID)));
      default:
        return reply(msg.internalError());
    }
  } catch (e) {
    console.error(`/${data.name} の処理でエラー`, e);
    return reply(msg.internalError());
  }
}

// ---- /register ----
async function register(env: Env, discordUserId: string, input: string): Promise<Response> {
  const name = input.trim();
  if (!isValidLogin(name)) return reply(msg.githubUserNotFound(name));

  // GitHub に存在するか確認し、ID と正式なユーザー名（大文字小文字）を取る
  const gh = await fetchUser(env, name);
  if (!gh) return reply(msg.githubUserNotFound(name));

  // 同じ GitHub アカウントを他の人が登録していないか
  const owner = await db.getUserByGithubId(env.DB, gh.id);
  if (owner && owner.discord_user_id !== discordUserId) return reply(msg.takenByOther(gh.login));

  const now = Date.now();
  const me = await db.getUser(env.DB, discordUserId);

  if (!me) {
    await db.insertUser(env.DB, discordUserId, gh.login, gh.id, now);
    return reply(msg.registered(gh.login));
  }
  if (me.github_id === gh.id) {
    // 同じアカウント。GitHub 側でユーザー名が変わっていれば追従する
    if (me.github_login !== gh.login) await db.updateGithubLogin(env.DB, discordUserId, gh.login, now);
    return reply(msg.alreadyRegistered(gh.login));
  }
  await db.changeGithub(env.DB, discordUserId, gh.login, gh.id, now);
  return reply(msg.registerChanged(me.github_login, gh.login));
}

// ---- /unregister ----
async function unregister(env: Env, discordUserId: string): Promise<Response> {
  const deleted = await db.deleteUser(env.DB, discordUserId);
  return reply(deleted ? msg.unregistered() : msg.notRegistered());
}

// ---- /push on|off ----
async function push(env: Env, discordUserId: string, enabled: boolean): Promise<Response> {
  const updated = await db.setPushEnabled(env.DB, discordUserId, enabled, Date.now());
  if (!updated) return reply(msg.registerFirst());
  return reply(enabled ? msg.pushOn() : msg.pushOff());
}

// ---- /list（全員に見える） ----
async function listUsers(env: Env): Promise<Response> {
  const users = await db.listUsers(env.DB);
  if (users.length === 0) return reply(list.empty(), false);
  const lines = users.map((u) => list.line(u.github_login, u.push_enabled === 1));
  return reply([list.heading(users.length), ...lines].join("\n"), false);
}

// ---- /ranking（全員に見える） ----
async function ranking(env: Env, interactionToken: string, discordUserId: string, ctx: ExecutionContext): Promise<Response> {
  const [users, me] = await Promise.all([db.listUsers(env.DB), db.getUser(env.DB, discordUserId)]);
  const myLogin = me?.github_login ?? null;
  if (users.length === 0) return reply(buildRankingText([], myLogin), false);

  // GitHub への問い合わせは 3 秒に間に合わないことがあるので、先に「集計しています…」と返してから書き換える
  ctx.waitUntil(
    (async () => {
      try {
        const stats = await fetchContributionStats(env, users.map((u) => u.github_login));
        const ranked = rankStats(
          stats.map((s) => ({ login: s.login, prs: s.prs, days: s.years.reduce((sum, y) => sum + countGreenDays(y.weeks), 0) })),
        );
        await editOriginalResponse(env, interactionToken, buildRankingText(ranked, myLogin));
      } catch (e) {
        console.error("/ranking の集計でエラー", e);
        await editOriginalResponse(env, interactionToken, msg.internalError()).catch((e2) => console.error("/ranking のエラー表示に失敗", e2));
      }
    })(),
  );
  return reply(rankingText.loading(), false);
}

// ---- /config channel <#チャンネル> ----
async function config(env: Env, interaction: Interaction, sub: CommandOption | undefined): Promise<Response> {
  if (sub?.name !== "channel" || !interaction.guild_id) return reply(msg.internalError());
  const channelId = String(sub.options?.[0]?.value ?? "");

  // Bot がそのチャンネルに投稿できるかを確認する（Bot のユーザー ID = アプリケーション ID）
  const botId = env.DISCORD_APPLICATION_ID;
  const [member, roles, channel] = await Promise.all([
    getGuildMember(env, interaction.guild_id, botId),
    getGuildRoles(env, interaction.guild_id),
    getChannel(env, channelId).catch(() => null), // Bot から見えないチャンネルは取得できない
  ]);
  if (!channel) return reply(msg.noPermission(channelId));

  // スレッドは自分の権限設定を持たず、親チャンネルのものを引き継ぐ
  const thread = isThread(channel.type);
  if (thread && channel.thread_metadata?.locked) return reply(msg.noPermission(channelId));
  const permissionSource = thread && channel.parent_id ? await getChannel(env, channel.parent_id).catch(() => null) : channel;
  if (!permissionSource) return reply(msg.noPermission(channelId));

  const perms = computeChannelPermissions({
    guildId: interaction.guild_id,
    memberId: botId,
    memberRoleIds: member.roles,
    roles,
    overwrites: permissionSource.permission_overwrites ?? [],
  });
  if (!canPost(perms, thread)) return reply(msg.noPermission(channelId));

  await db.setSetting(env.DB, db.SETTING_CHANNEL_ID, channelId);
  return reply(msg.channelChanged(channelId));
}
