/** Worker に渡される環境（wrangler.toml のバインディングとシークレット） */
export interface Env {
  DB: D1Database;
  GITHUB_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
}
