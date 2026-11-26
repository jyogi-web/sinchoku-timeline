/**
 * GitHub REST API の呼び出し
 *
 * 使う API（すべて運営側の PAT で認証する）
 *   GET /users/{username}                       … /register 時の存在確認と GitHub ID の取得
 *   GET /users/{username}/events/public         … ポーリング（ETag 付き）
 *   GET /repos/{owner}/{repo}/pulls/{number}    … PR のタイトル取得（イベントにタイトルが含まれないため）
 *   GET /repos/{owner}/{repo}/compare/{a}...{b} … push で増えた commit の一覧
 *   GET /repos/{owner}/{repo}/commits/{sha}     … ブランチ初回 push のときの最新 commit
 */
import type { RequestBudget } from "./budget.ts";
import type { Env } from "./env.ts";

const API = "https://api.github.com";

// ---- 型（使う部分だけ） ----

export interface GitHubActor {
  id: number;
  login: string;
  avatar_url: string;
}

export interface GitHubEvent {
  id: string; // 新しいものほど大きい数字（文字列で返る）
  type: string; // "PullRequestEvent" | "PushEvent" | ...
  actor: GitHubActor;
  repo: { name: string }; // "owner/repo"
  payload: unknown;
  created_at: string; // ISO 8601
}

export interface PullRequestEventPayload {
  action: string; // "opened" | "closed" | ...
  number: number;
}

export interface PushEventPayload {
  ref: string; // "refs/heads/main"
  before: string; // push 前のブランチの先頭 SHA
  head: string; // push 後のブランチの先頭 SHA
}

export interface GitHubCommit {
  sha: string;
  commit: { message: string };
  author: { id: number; login: string } | null; // GitHub アカウントに紐づかないメールだと null
  committer: { id: number; login: string } | null;
  parents: { sha: string }[];
}

export type EventsResult =
  | { status: "not_modified" }
  | { status: "ok"; events: GitHubEvent[]; etag: string | null }
  | { status: "not_found" };

/** レート制限にかかった。この実行はここで打ち切る */
export class GitHubRateLimitError extends Error {
  constructor(status: number) {
    super(`GitHub API のレート制限にかかりました（HTTP ${status}）`);
  }
}

// ---- 共通 ----

async function request(env: Env, path: string, budget?: RequestBudget, headers: Record<string, string> = {}): Promise<Response> {
  budget?.spend();
  const res = await fetch(API + path, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "sinchoku-timeline",
      ...headers,
    },
  });
  if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) {
    throw new GitHubRateLimitError(res.status);
  }
  return res;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`GitHub API エラー: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** GitHub のユーザー名として正しい形か（URL に埋め込む前のチェック） */
export function isValidLogin(login: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login);
}

function encodeRepo(fullName: string): string {
  const [owner, repo] = fullName.split("/");
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

// ---- 各 API ----

/** ユーザーの存在確認。いなければ null */
export async function fetchUser(env: Env, login: string): Promise<{ id: number; login: string } | null> {
  const res = await request(env, `/users/${encodeURIComponent(login)}`);
  if (res.status === 404) return null;
  return json(res);
}

/**
 * ユーザーの public なイベントを取得する（新しい順で返る）
 * 前回の ETag を If-None-Match に付け、変化がなければ 304 が返る（レート制限を消費しない）
 */
export async function fetchUserEvents(env: Env, budget: RequestBudget, login: string, etag: string | null): Promise<EventsResult> {
  const res = await request(
    env,
    `/users/${encodeURIComponent(login)}/events/public?per_page=100`,
    budget,
    etag ? { "If-None-Match": etag } : {},
  );
  if (res.status === 304) return { status: "not_modified" };
  if (res.status === 404) return { status: "not_found" };
  const events = await json<GitHubEvent[]>(res);
  return { status: "ok", events, etag: res.headers.get("ETag") };
}

/** PR のタイトルを取得する。PR が見つからなければ null */
export async function fetchPull(env: Env, budget: RequestBudget, repo: string, number: number): Promise<{ title: string } | null> {
  const res = await request(env, `/repos/${encodeRepo(repo)}/pulls/${number}`, budget);
  if (res.status === 404) return null;
  return json(res);
}

/** before と head の間にある commit（古い順）。比較できなければ null */
export async function fetchCompare(env: Env, budget: RequestBudget, repo: string, before: string, head: string): Promise<GitHubCommit[] | null> {
  const res = await request(env, `/repos/${encodeRepo(repo)}/compare/${before}...${head}`, budget);
  if (res.status === 404) return null;
  const body = await json<{ commits: GitHubCommit[] }>(res);
  return body.commits;
}

/** commit を 1 件取得する。見つからなければ null */
export async function fetchCommit(env: Env, budget: RequestBudget, repo: string, sha: string): Promise<GitHubCommit | null> {
  const res = await request(env, `/repos/${encodeRepo(repo)}/commits/${sha}`, budget);
  if (res.status === 404 || res.status === 422) return null;
  return json(res);
}
