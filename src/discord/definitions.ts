/**
 * スラッシュコマンドの定義（docs/spec.md §6, §8.1）
 * scripts/register-commands.ts がこの内容を Discord に登録する
 */

// Discord のオプションの型番号
const SUB_COMMAND = 1;
const STRING = 3;
const CHANNEL = 7;

// チャンネルの種類（テキスト・アナウンス・公開スレッド。プライベートスレッドは対象外）
const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;
const ANNOUNCEMENT_THREAD = 10;
const PUBLIC_THREAD = 11;

export const commands = [
  {
    name: "register",
    description: "GitHubアカウントを登録する",
    options: [{ type: STRING, name: "username", description: "GitHubのユーザー名", required: true }],
  },
  {
    name: "unregister",
    description: "登録を解除する",
  },
  {
    name: "push",
    description: "commitを流すかを切り替える",
    options: [
      { type: SUB_COMMAND, name: "on", description: "流す" },
      { type: SUB_COMMAND, name: "off", description: "流さない" },
    ],
  },
  {
    name: "list",
    description: "登録者の一覧を表示する",
  },
  {
    name: "config",
    // Discord ではサブコマンドを持つコマンドにも説明が必須。仕様書に文言がないため仮置き
    description: "設定を変更する",
    options: [
      {
        type: SUB_COMMAND,
        name: "channel",
        description: "投稿先のチャンネルを変更する",
        options: [
          {
            type: CHANNEL,
            name: "channel",
            description: "投稿先のチャンネル",
            required: true,
            channel_types: [GUILD_TEXT, GUILD_ANNOUNCEMENT, ANNOUNCEMENT_THREAD, PUBLIC_THREAD],
          },
        ],
      },
    ],
  },
  {
    name: "ranking",
    description: "PRの数で登録者を並べる",
  },
  {
    name: "help",
    description: "使い方を表示する",
  },
];
