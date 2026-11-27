/**
 * Worker のエントリポイント
 *
 *   fetch     … Discord のスラッシュコマンド（Interactions エンドポイント）
 *   scheduled … Cron Triggers
 *                 5 分ごと   … GitHub をポーリングする
 *                 1 日 1 回 … /ranking 用の草と PR 数を取って保存する
 */
import { syncContributions } from "./contribution-sync.ts";
import { verifyDiscordRequest } from "./discord/verify.ts";
import { handleCommand, InteractionType, type Interaction } from "./discord/handlers.ts";
import type { Env } from "./env.ts";
import { runPoll } from "./poller.ts";

/** wrangler.toml の crons と同じ文字列にすること（UTC 0:10 ＝ 日本時間 9:10。昨日の分が出そろってから取る） */
const DAILY_CRON = "10 0 * * *";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    if (interaction.type === InteractionType.APPLICATION_COMMAND) return handleCommand(env, interaction, ctx);

    return new Response("Unsupported interaction", { status: 400 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (controller.cron === DAILY_CRON) {
      ctx.waitUntil(syncContributions(env, Date.now()).catch((e) => console.error("草と PR 数の取得でエラー", e)));
      return;
    }
    ctx.waitUntil(runPoll(env));
  },
} satisfies ExportedHandler<Env>;
