/**
 * タイムラインに流すカード（Discord の Embed）を組み立てる（docs/spec.md §3, §8.3）
 * API は呼ばず、受け取った値から送信する JSON を作るだけ
 */
import { card } from "./messages.ts";

export interface DiscordMessage {
  embeds: DiscordEmbed[];
  allowed_mentions: { parse: string[] };
}

interface DiscordEmbed {
  author: { name: string; icon_url: string };
  title?: string;
  url?: string;
  description?: string;
  footer: { text: string };
  color: number;
  timestamp: string;
}

const COLOR_PR = 0x2da44e; // 緑
const COLOR_COMMIT = 0x3b82f6; // 青

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/** PR 作成のカード */
export function buildPrMessage(p: {
  login: string;
  avatarUrl: string;
  repo: string; // "owner/repo"
  number: number;
  title: string;
  createdAt: string;
}): DiscordMessage {
  return {
    // PR のタイトルに @everyone などが含まれていてもメンションしない
    allowed_mentions: { parse: [] },
    embeds: [
      {
        author: { name: card.prHeading(p.login), icon_url: p.avatarUrl },
        title: truncate(p.title, 256), // Embed の title は 256 文字まで
        url: `https://github.com/${p.repo}/pull/${p.number}`,
        footer: { text: card.prFooter(p.repo, p.number) },
        color: COLOR_PR,
        timestamp: p.createdAt,
      },
    ],
  };
}

/** commit 追加のカード。count が null ならブランチ初回 push（件数なし） */
export function buildCommitMessage(p: {
  login: string;
  avatarUrl: string;
  repo: string;
  branch: string;
  commits: { sha: string; title: string }[]; // 新しい順・最大 5 件
  count: number | null;
  createdAt: string;
}): DiscordMessage {
  const lines = p.commits.map(
    (c) => `[\`${c.sha.slice(0, 7)}\`](https://github.com/${p.repo}/commit/${c.sha}) ${truncate(c.title, 100)}`,
  );
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        author: { name: card.commitHeading(p.login, p.count), icon_url: p.avatarUrl },
        description: lines.join("\n"),
        footer: { text: card.commitFooter(p.repo, p.branch) },
        color: COLOR_COMMIT,
        timestamp: p.createdAt,
      },
    ],
  };
}
