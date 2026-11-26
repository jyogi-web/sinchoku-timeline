/**
 * スラッシュコマンドを Discord に登録する
 *
 *   npm run register-commands
 *
 * .dev.vars の DISCORD_APPLICATION_ID / DISCORD_BOT_TOKEN / DISCORD_GUILD_ID を使う。
 * サーバー単位（guild）で登録するので、反映はすぐ。定義を変えたら再実行する（上書きされる）。
 */
import { commands } from "../src/discord/definitions.ts";

declare const process: { env: Record<string, string | undefined>; exit(code: number): never };

const { DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_APPLICATION_ID || !DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
  console.error(".dev.vars に DISCORD_APPLICATION_ID / DISCORD_BOT_TOKEN / DISCORD_GUILD_ID を設定してください");
  process.exit(1);
}

const url = `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${DISCORD_GUILD_ID}/commands`;
const res = await fetch(url, {
  method: "PUT",
  headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  console.error(`登録に失敗しました: HTTP ${res.status}`, await res.text());
  process.exit(1);
}
console.log(`${commands.length} 個のコマンドを登録しました: ${commands.map((c) => "/" + c.name).join(", ")}`);
