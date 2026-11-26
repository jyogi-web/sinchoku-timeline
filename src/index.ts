/**
 * Worker のエントリポイント
 *
 *   fetch     … Discord のスラッシュコマンド（Interactions エンドポイント）
 *   scheduled … Cron Triggers（5 分ごと）で GitHub をポーリングする
 */
import { verifyDiscordRequest } from "./discord/verify.ts";
import { handleCommand, InteractionType, type Interaction } from "./discord/handlers.ts";
import type { Env } from "./env.ts";
import { runPoll } from "./poller.ts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") return new Response("Not Found", { status: 404 });

    // 署名は生のボディに対して計算されるので、JSON にする前に text で読む
    const body = await request.text();
    const valid = await verifyDiscordRequest(
      env.DISCORD_PUBLIC_KEY,
      request.headers.get("X-Signature-Ed25519"),
      request.headers.get("X-Signature-Timestamp"),
      body,
    );
    if (!valid) return new Response("Invalid signature", { status: 401 });

    const interaction = JSON.parse(body) as Interaction;

    // URL を登録したときに Discord が送ってくる疎通確認
    if (interaction.type === InteractionType.PING) return Response.json({ type: 1 });

    if (interaction.type === InteractionType.APPLICATION_COMMAND) return handleCommand(env, interaction);

    return new Response("Unsupported interaction", { status: 400 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runPoll(env));
  },
} satisfies ExportedHandler<Env>;
