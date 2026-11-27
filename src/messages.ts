/**
 * Bot が表示する文言（docs/spec.md §8）
 * 文言を変えるときはここだけを直す
 */

// ---- §8.2 コマンドの応答 ----
export const msg = {
  registered: (github: string) => `\`${github}\` で登録しました。`,
  registerChanged: (from: string, to: string) => `登録を \`${from}\` から \`${to}\` に変更しました。`,
  alreadyRegistered: (github: string) => `すでに \`${github}\` で登録されています。`,
  githubUserNotFound: (input: string) => `GitHubユーザー \`${input}\` が見つかりませんでした。`,
  takenByOther: (github: string) => `\`${github}\` は他のメンバーが登録しています。`,

  unregistered: () => "登録を解除しました。",
  notRegistered: () => "登録されていません。",

  pushOn: () => "commitを流すようにしました。",
  pushOff: () => "commitを流さないようにしました。",
  // 仮の文言（ユーザーが差し替える）
  starOn: () => "スターを流すようにしました。",
  starOff: () => "スターを流さないようにしました。",
  registerFirst: () => "先に `/register` で登録してください。",

  channelChanged: (channelId: string) => `投稿先を <#${channelId}> に変更しました。`,
  noPermission: (channelId: string) => `<#${channelId}> に投稿する権限がありません。`,

  internalError: () => "エラーが発生しました。時間をおいて試してください。",
};

// ---- §8.3 タイムラインのカード ----
export const card = {
  prHeading: (github: string) => `${github} がPRを作成しました`,
  prFooter: (repo: string, number: number) => `${repo} · #${number}`,
  commitHeading: (github: string, count: number | null) =>
    count === null ? `${github} がcommitを追加しました` : `${github} が${count}件のcommitを追加しました`,
  // 仮の文言
  starHeading: (github: string, repo: string) => `${github} が ${repo} をスターしました`,
  commitFooter: (repo: string, branch: string) => `${repo} · ${branch}`,
};

// ---- §8.4 /list ----
export const list = {
  heading: (count: number) => `登録者（${count}人）`,
  line: (github: string, pushEnabled: boolean, starEnabled: boolean) =>
    `\`${github}\`　commit：${pushEnabled ? "オン" : "オフ"}　スター：${starEnabled ? "オン" : "オフ"}`,
  empty: () => "登録者はいません。",
};

// ---- §8.5 /ranking（仮の文言） ----
export const ranking = {
  loading: () => "集計しています…",
  heading: (count: number) => `PRランキング（登録者 ${count}人）`,
  line: (rank: number, github: string, prs: number, days: number) => `${rank}. ${github}　${prs}件（草 ${days}日）`,
  yours: (github: string, rank: number, prs: number, days: number) => `${github} は${rank}位です。${prs}件（草 ${days}日）`,
  joinGuide: () => "/register で登録すると、ランキングに参加できます。",
  empty: () => "登録者はいません。",
};

// ---- §8.6 /help ----
// 投稿先が未設定のときは「投稿先のチャンネル」と表示する
export function helpText(channelId: string | null): string {
  const channel = channelId ? `<#${channelId}>` : "投稿先のチャンネル";
  return [
    "`/register <GitHubユーザー名>`",
    `  GitHubアカウントを登録します。作成したPRが ${channel} に流れます。`,
    "  もう一度実行すると、登録を変更できます。",
    "",
    "`/push on | off`",
    "  commitを流すかを切り替えます。初期設定はoffです。",
    "",
    "`/star on | off`",
    "  スターを流すかを切り替えます。初期設定はonです。",
    "",
    "`/unregister`",
    "  登録を解除します。",
    "",
    "`/list`",
    "  登録者の一覧を表示します。",
    "",
    "`/config channel <#チャンネル>`",
    "  投稿先のチャンネルを変更します。",
    "",
    "`/ranking`",
    "  作成したPRの数で登録者を並べます。（）は草が生えた日数です。",
    "",
    "タイムラインに流れるのはpublicリポジトリの活動だけです。反映まで最大5分ほどかかります。",
  ].join("\n");
}
