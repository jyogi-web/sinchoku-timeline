/**
 * Discord への接続テスト（投稿のみ。Worker もデプロイも不要）
 *
 *   npm run test-post
 *
 * .dev.vars の DISCORD_BOT_TOKEN と DISCORD_TEST_CHANNEL_ID を使う。
 *   1. Bot トークンが正しいかを確認する（GET /users/@me）
 *   2. 本番と同じ組み立て処理で、PR と commit のサンプルカードを投稿する
 */
import { buildCommitMessage, buildPrMessage, type DiscordMessage } from "../src/cards.ts";

declare const process: { env: Record<string, string | undefined>; exit(code: number): never };

const API = "https://discord.com/api/v10";
const { DISCORD_BOT_TOKEN, DISCORD_TEST_CHANNEL_ID } = process.env;
if (!DISCORD_BOT_TOKEN || !DISCORD_TEST_CHANNEL_ID) {
  console.error(".dev.vars に DISCORD_BOT_TOKEN と DISCORD_TEST_CHANNEL_ID を設定してください");
  process.exit(1);
}

const headers = { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" };

// ---- 1. トークンの確認 ----
const me = await fetch(`${API}/users/@me`, { headers });
if (!me.ok) {
  console.error(`× Bot トークンが使えません（HTTP ${me.status}）。Developer Portal の Bot → Reset Token で発行し直してください`);
  process.exit(1);
}
const bot = (await me.json()) as { id: string; username: string };
console.log(`✓ Bot トークン OK: ${bot.username}（ID: ${bot.id}）`);

// ---- 2. サンプルカードの投稿 ----
const now = new Date().toISOString();
const samples: [string, DiscordMessage][] = [
  [
    "PR のカード",
    buildPrMessage({
      login: "octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
      repo: "jyogi-web/sinchoku-timeline",
      number: 1,
      title: "【接続テスト】ログイン画面に入力チェックを追加",
      createdAt: now,
    }),
  ],
  [
    "commit のカード",
    buildCommitMessage({
      login: "octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
      repo: "jyogi-web/sinchoku-timeline",
      branch: "main",
      commits: [
        { sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", title: "【接続テスト】バリデーションを追加" },
        { sha: "0f1e2d3c4b5a69788796a5b4c3d2e1f012345678", title: "【接続テスト】ログインフォームを追加" },
      ],
      count: 2,
      createdAt: now,
    }),
  ],
];

for (const [label, message] of samples) {
  const res = await fetch(`${API}/channels/${DISCORD_TEST_CHANNEL_ID}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });
  if (res.ok) {
    console.log(`✓ ${label}を投稿しました`);
    continue;
  }

  const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
  const hint =
    body.code === 10003 ? "チャンネル ID が間違っています" :
    body.code === 50001 ? "Bot がそのチャンネルを見られません（サーバーに招待済みか、チャンネルの権限を確認）" :
    body.code === 50013 ? "Bot に「メッセージを送信」「埋め込みリンク」の権限がありません" :
    "";
  console.error(`× ${label}の投稿に失敗（HTTP ${res.status}, code ${body.code}: ${body.message}）${hint ? "\n  → " + hint : ""}`);
  process.exit(1);
}
