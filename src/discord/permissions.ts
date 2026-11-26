/**
 * Bot があるチャンネルに投稿できるかの計算（/config channel で使う）
 *
 * Discord の権限は「サーバー全体のロール権限」に「チャンネルごとの上書き」を重ねて決まる。
 * 計算の順番は Discord の公式ドキュメントのとおり:
 *   1. @everyone ロールと、Bot に付いているロールの権限を OR で合わせる
 *   2. 管理者権限があれば、すべて許可
 *   3. チャンネルの上書きを @everyone → ロール → Bot 個人 の順に適用する（deny を外してから allow を足す）
 */

export interface GuildRole {
  id: string;
  permissions: string; // 数値の文字列（ビットフラグ）
}

export interface PermissionOverwrite {
  id: string;
  type: number; // 0 = ロール, 1 = メンバー
  allow: string;
  deny: string;
}

export const ADMINISTRATOR = 1n << 3n;
export const VIEW_CHANNEL = 1n << 10n;
export const SEND_MESSAGES = 1n << 11n;
export const EMBED_LINKS = 1n << 14n;
export const SEND_MESSAGES_IN_THREADS = 1n << 38n;

/** タイムラインの投稿に必要な権限（通常のチャンネル） */
export const REQUIRED_FOR_POSTING = VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS;
/** タイムラインの投稿に必要な権限（スレッド。「メッセージを送る」の代わりに「スレッドでメッセージを送る」が要る） */
export const REQUIRED_FOR_THREAD_POSTING = VIEW_CHANNEL | SEND_MESSAGES_IN_THREADS | EMBED_LINKS;

// チャンネルの種類
export const ANNOUNCEMENT_THREAD = 10;
export const PUBLIC_THREAD = 11; // フォーラムの投稿も公開スレッド

/** 投稿先として選べるスレッドか（プライベートスレッドは Bot をメンバーに加える必要があるため対象外） */
export function isThread(channelType: number): boolean {
  return channelType === ANNOUNCEMENT_THREAD || channelType === PUBLIC_THREAD;
}

export function computeChannelPermissions(p: {
  guildId: string; // @everyone ロールの ID はサーバー ID と同じ
  memberId: string;
  memberRoleIds: string[];
  roles: GuildRole[];
  overwrites: PermissionOverwrite[];
}): bigint {
  const roleById = new Map(p.roles.map((r) => [r.id, BigInt(r.permissions)]));

  // 1. サーバー全体のロール権限
  let perms = roleById.get(p.guildId) ?? 0n;
  for (const id of p.memberRoleIds) perms |= roleById.get(id) ?? 0n;

  // 2. 管理者
  if (perms & ADMINISTRATOR) return ~0n;

  // 3. チャンネルの上書き
  const everyone = p.overwrites.find((o) => o.id === p.guildId);
  if (everyone) {
    perms &= ~BigInt(everyone.deny);
    perms |= BigInt(everyone.allow);
  }

  let allow = 0n;
  let deny = 0n;
  for (const o of p.overwrites) {
    if (o.type === 0 && p.memberRoleIds.includes(o.id)) {
      allow |= BigInt(o.allow);
      deny |= BigInt(o.deny);
    }
  }
  perms &= ~deny;
  perms |= allow;

  const member = p.overwrites.find((o) => o.type === 1 && o.id === p.memberId);
  if (member) {
    perms &= ~BigInt(member.deny);
    perms |= BigInt(member.allow);
  }

  return perms;
}

export function canPost(perms: bigint, thread = false): boolean {
  const required = thread ? REQUIRED_FOR_THREAD_POSTING : REQUIRED_FOR_POSTING;
  return (perms & required) === required;
}
