/**
 * 新しいイベントの選び出し（docs/spec.md §5）
 *
 * イベント ID は種類ごとに番号の範囲が異なり（PushEvent だけ大きい等）、
 * 「新しいほど大きい」とは限らない。そのため大小では比べず、
 * 「前回取得したイベント ID の一覧に含まれていないもの」を新しいイベントとする。
 * 反映が遅れて後から出てきた古い日時のイベントも、一覧になければ拾える。
 */
import type { GitHubEvent } from "./github.ts";

/** 前回見た ID の一覧にないイベントを、古い順に並べて返す */
export function selectNewEvents(events: GitHubEvent[], seenIds: ReadonlySet<string>): GitHubEvent[] {
  return events
    .filter((e) => !seenIds.has(e.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

/**
 * 次回のために保存する「見た ID の一覧」
 * 今回の取得結果に含まれる ID のうち、前回すでに見たものと、今回処理し終えたものだけを残す。
 * 途中で止まった場合、処理していないイベントは一覧に入らないので次回やり直される。
 * 今回の取得結果に含まれない ID は捨てるので、一覧は最大でも 1 ページ分（100 件）に収まる。
 */
export function nextSeenIds(events: GitHubEvent[], previouslySeen: ReadonlySet<string>, processed: ReadonlySet<string>): string[] {
  return events.map((e) => e.id).filter((id) => previouslySeen.has(id) || processed.has(id));
}

export function parseSeenIds(json: string): Set<string> {
  try {
    const ids = JSON.parse(json);
    return new Set(Array.isArray(ids) ? ids.map(String) : []);
  } catch {
    return new Set();
  }
}
