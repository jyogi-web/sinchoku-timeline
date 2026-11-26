# sinchoku-timeline 仕様書（MVP）

Discord サーバーに参加しているメンバーの GitHub 上の活動（PR の作成・commit）を、Discord のチャンネルに feed として流し、開発のやる気を出すための Bot。

## 1. 基本方針

| 項目 | 内容 |
|---|---|
| 対象者 | `/register` で登録したユーザーのみ |
| 対象リポジトリ | public リポジトリのみ（自分のリポジトリ・他人のリポジトリ・OSS を問わない） |
| 本人確認 | 行わない（他人の GitHub 名で登録されることは許容する） |
| 運用費 | 無料（Cloudflare Workers の無料枠で動かす） |

## 2. 構成

| 要素 | 採用 |
|---|---|
| 実行基盤 | Cloudflare Workers |
| 定期実行 | Cron Triggers（5 分間隔・固定） |
| DB | Cloudflare D1（SQLite） |
| 言語 | TypeScript |
| GitHub の認証 | 運営側の Personal Access Token（スコープなし）1 つ |
| Discord | スラッシュコマンド（Interactions エンドポイント）＋ チャンネルへの投稿 |

### 2.1 データ取得方式の決定理由

GitHub の webhook はリポジトリ / organization / GitHub App のインストール先といった「場所」に登録する仕組みで、「ユーザー」を指定して活動を受け取ることはできない。ユーザー単位で public な活動を取得できる公式の手段は Events API のみのため、ポーリング方式を採用する。

- 不採用：リポジトリ webhook（リポジトリごとの設定が必要）
- 不採用：GitHub App（ユーザーごとのインストールが必要。他人のリポジトリへの PR を拾えない）
- 不採用：organization webhook（org のリポジトリしか拾えない）

## 3. 流すイベント

### 3.1 PR の作成

- 対象：`PullRequestEvent` のうち `action === "opened"` のもの
- マージ・クローズ・再オープン・編集は流さない
- 表示内容
  - 作成者の GitHub アイコン（`actor.avatar_url`）と GitHub ユーザー名
  - 「PR を作成しました」
  - PR のタイトル（PR へのリンク付き）
  - リポジトリ名と PR 番号（例：`jyogi/web-app · #42`）
- PR の本文は表示しない
- 取得：PR の作成 1 件ごとに 1 リクエスト
  - イベントの `payload.pull_request` には `base`・`head`・`id`・`number`・`url` しか含まれず、タイトルがない（2026-11 に実データで確認）
  - タイトルは `GET /repos/{owner}/{repo}/pulls/{number}` で取得する
  - PR へのリンクは `https://github.com/{owner}/{repo}/pull/{number}` で組み立てる（リクエスト不要）
  - 作成者のアイコンはイベントの `actor.avatar_url` を使う（リクエスト不要）

### 3.2 commit（push）

- ユーザーごとに `/push on` / `/push off` で切り替え。**初期設定はオフ**
- 対象：`PushEvent`
- 取得：PushEvent 1 件ごとに 1 リクエスト
  - PushEvent の payload は `before`・`head`・`push_id`・`ref`・`repository_id` のみで、commit の一覧・件数は含まれない（2026-11 に実データで確認）
  - 通常：`GET /repos/{owner}/{repo}/compare/{before}...{head}`
  - ブランチの初回 push（`before` が存在しない）：`GET /repos/{owner}/{repo}/commits/{head}` で最新の 1 件のみ
- 絞り込み（以下を除外する）
  1. マージ commit（`parents.length >= 2`）
  2. GitHub の画面上で作られた commit（`committer.login === "web-flow"`）
  3. 作者が push した本人ではない commit（`author.id !== actor.id`。ユーザー名ではなく ID で比較する）
  4. 作者が不明（`author === null`）で、かつ同じ push の中にマージ commit があるもの
     - push の中にマージ commit がなければ、作者不明の commit も本人のものとして扱う
- 件数：絞り込み後に残った commit の数
- 表示内容
  - push した人の GitHub アイコンと GitHub ユーザー名
  - 「◯件の commit を追加しました」（ブランチの初回 push は件数なしで「commit を追加しました」）
  - commit のタイトル（メッセージの 1 行目）を新しい順に最大 5 件。6 件目以降は表示しない
  - リポジトリ名とブランチ名
- 絞り込み後に 0 件なら投稿しない
- ブランチ削除など、`head` に commit がない push はスキップする

## 4. ポーリング

- 5 分ごとに Cron で起動する
- 登録ユーザーごとに `GET /users/{username}/events/public` を呼ぶ
  - 前回のレスポンスの `ETag` を `If-None-Match` に付ける
  - `304 Not Modified` なら何もしない（認証付きリクエストの 304 は GitHub のレート制限を消費しない）
  - `200` なら新しいイベントを処理し、新しい `ETag` を保存する
- 1 回の実行で使う外部リクエスト数に上限を設ける（Workers 無料枠の制限対策）
  - ユーザーを「最後に確認した時刻」が古い順に処理する
  - 上限に近づいたらその回は打ち切り、残りのユーザーは次回に処理する

## 5. 重複と取りこぼし

- ユーザーごとに「最後に処理したイベント ID」を保存する
- 取得したイベントのうち、保存している ID より大きいものだけを古い順に処理する
- Discord への投稿に成功するたびに ID を進める。失敗した場合はそこで止め、次回にやり直す

| ケース | 扱い |
|---|---|
| 登録した直後 | 過去分は流さず、その時点の最新イベント ID を記録するだけ |
| `/register` で GitHub 名を変更 | ETag と最後のイベント ID をリセットし、登録直後と同じ扱い |
| `/unregister` 後に再登録 | 登録直後と同じ扱い |
| 停止からの復帰 | 直近 24 時間以内に発生したイベントだけ流し、それより古いものは捨てる |

※ Events API は直近 30 日・最大 300 件までしか取得できない。

## 6. コマンド

すべてのコマンドは誰でも実行できる。実行結果は実行した本人にだけ表示する（`/list` を除く）。

| コマンド | 内容 |
|---|---|
| `/register <GitHubユーザー名>` | GitHub アカウントを登録する。登録済みなら上書きする（push 設定は引き継ぐ） |
| `/unregister` | 自分の登録を解除する |
| `/push on` | 自分の commit をタイムラインに流す |
| `/push off` | 自分の commit を流さない（初期設定） |
| `/list` | 登録者の一覧を表示する（GitHub ユーザー名と commit 表示のオンオフ。メンションはしない） |
| `/config channel <#チャンネル>` | タイムラインの投稿先チャンネルを変更する |
| `/help` | コマンドの説明と使い方を表示する（文言は別途作成） |

- `/push` などの設定コマンドは、実行した Discord ユーザー自身の設定を変更する（ユーザー名は引数に取らない）

## 7. データの持ち方（Cloudflare D1）

### 7.1 `users`：登録者 1 人につき 1 行

| カラム | 型 | 内容 |
|---|---|---|
| `discord_user_id` | TEXT（主キー） | コマンドを実行した Discord ユーザーの ID |
| `github_login` | TEXT | GitHub ユーザー名（ポーリングの URL に使う） |
| `github_id` | INTEGER（UNIQUE） | GitHub のユーザー ID（commit の作者判定に使う）。同じ GitHub アカウントを複数の Discord ユーザーが登録することは許可しない |
| `push_enabled` | INTEGER | commit 表示のオンオフ（0 / 1、初期値 0） |
| `etag` | TEXT（null 可） | 前回のレスポンスの ETag |
| `last_event_id` | TEXT（null 可） | 最後に処理したイベント ID。null なら「登録直後」として扱う |
| `last_polled_at` | INTEGER（null 可） | 最後に確認した時刻（処理順の決定に使う） |
| `created_at` | INTEGER | 登録日時 |
| `updated_at` | INTEGER | 更新日時 |

### 7.2 `settings`：Bot 全体の設定（キーと値）

| カラム | 型 | 内容 |
|---|---|---|
| `key` | TEXT（主キー） | 設定名（例：`channel_id`） |
| `value` | TEXT | 設定値 |

- MVP で使うキーは `channel_id`（投稿先チャンネル）のみ
- 投稿はチャンネルの webhook URL ではなく、Bot トークンで Discord の REST API（`POST /channels/{channel_id}/messages`）を使う。Bot には投稿先チャンネルでの送信権限が必要

### 7.3 各処理での使い方

| 処理 | 操作 |
|---|---|
| `/register` | `GET /users/{name}` で存在を確認し、`github_id` を取得する。新規なら追加、登録済みなら上書きする。GitHub 名が変わった場合は `etag` と `last_event_id` を null にする |
| `/unregister` | 行を削除する |
| `/push on/off` | `push_enabled` を更新する |
| `/list` | `users` を全件取得する |
| `/config channel` | `settings` の `channel_id` を更新する |
| ポーリング | `last_polled_at` の古い順に取得し、処理後に `etag`・`last_event_id`・`last_polled_at` を更新する |

### 7.4 保存しないもの

- 投稿の履歴は保存しない。ストリークや日ごとの活動量が必要になったら、GitHub GraphQL API の `contributionsCollection`（過去 1 年分の日ごとの活動数）から取得する

## 8. 文言

`{}` は差し込む値。`/list` 以外のコマンドの応答は実行した本人にだけ表示する。

### 8.1 コマンドの説明文（Discord のコマンド候補に表示）

| コマンド / 引数 | 説明文 |
|---|---|
| `/register` | GitHubアカウントを登録する |
| `/register` の `username` | GitHubのユーザー名 |
| `/unregister` | 登録を解除する |
| `/push` | commitを流すかを切り替える |
| `/push` の `on` / `off` | 流す / 流さない |
| `/list` | 登録者の一覧を表示する |
| `/config channel` | 投稿先のチャンネルを変更する |
| `/config channel` の `channel` | 投稿先のチャンネル |
| `/help` | 使い方を表示する |

### 8.2 コマンドの応答

| コマンド | 場面 | 文言 |
|---|---|---|
| `/register` | 新しく登録した | `{github}` で登録しました。 |
| `/register` | 別の GitHub 名に変更した | 登録を `{旧github}` から `{新github}` に変更しました。 |
| `/register` | 同じ名前で再登録した | すでに `{github}` で登録されています。 |
| `/register` | GitHub ユーザーが存在しない | GitHubユーザー `{入力値}` が見つかりませんでした。 |
| `/register` | 同じ GitHub 名を別の人が登録済み | `{github}` は他のメンバーが登録しています。 |
| `/unregister` | 解除した | 登録を解除しました。 |
| `/unregister` | 未登録 | 登録されていません。 |
| `/push` | オンにした | commitを流すようにしました。 |
| `/push` | オフにした | commitを流さないようにしました。 |
| `/push` | 未登録 | 先に `/register` で登録してください。 |
| `/config channel` | 変更した | 投稿先を `#{channel}` に変更しました。 |
| `/config channel` | Bot に投稿権限がない | `#{channel}` に投稿する権限がありません。 |
| 共通 | 内部エラー | エラーが発生しました。時間をおいて試してください。 |

### 8.3 タイムラインのカード

| 場面 | 文言 |
|---|---|
| PR 作成の見出し | `{github}` がPRを作成しました |
| PR の下の行 | `{owner/repo} · #{番号}` |
| commit の見出し | `{github}` が{件数}件のcommitを追加しました |
| commit の見出し（ブランチの初回 push） | `{github}` がcommitを追加しました |
| commit の下の行 | `{owner/repo} · {ブランチ}` |

PR のタイトル・commit のタイトルは GitHub の内容をそのまま表示する。

### 8.4 `/list`

| 場面 | 文言 |
|---|---|
| 見出し | 登録者（{人数}人） |
| 1 行ごと | `{github}`　commit：オン ／ `{github}`　commit：オフ |
| 0 人のとき | 登録者はいません。 |

### 8.5 `/help`

```
/register <GitHubユーザー名>
  GitHubアカウントを登録します。作成したPRが #{channel} に流れます。
  もう一度実行すると、登録を変更できます。

/push on | off
  commitを流すかを切り替えます。初期設定はoffです。

/unregister
  登録を解除します。

/list
  登録者の一覧を表示します。

/config channel <#チャンネル>
  投稿先のチャンネルを変更します。

publicリポジトリの活動だけが対象です。反映まで最大5分ほどかかります。
```

## 9. 今後の検討事項（MVP 外）

- ストリーク、週次のまとめなど、やる気を出す追加機能（GraphQL の `contributionsCollection` を利用する想定）
- 本人確認（GitHub ログインなど）
- commit 作者判定の精度向上（メールアドレスの登録など）
