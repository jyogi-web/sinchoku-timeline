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

- ユーザーごとに「前回取得したイベント ID の一覧」（最大 100 件）を保存する
- 取得したイベントのうち、その一覧に含まれない ID のものだけを、発生日時の古い順に処理する
  - イベント ID は種類によって番号の範囲が異なり（PushEvent だけ大きい等）、新しいほど大きいとは限らない（2026-11 に実データで確認）。そのため ID の大小では比べない
  - 反映が遅れて後から出てきた古い日時のイベントも、一覧になければ処理される
- Discord への投稿に成功したイベントの ID だけを一覧に加える。失敗した場合はそこで止め、残りは次回にやり直す
- 一覧には今回の取得結果に含まれる ID だけを残す（一覧が増え続けない）

| ケース | 扱い |
|---|---|
| 登録した直後 | 過去分は流さず、その時点で見えているイベントの ID を記録するだけ |
| `/register` で GitHub 名を変更 | ETag とイベント ID の一覧をリセットし、登録直後と同じ扱い |
| `/unregister` 後に再登録 | 登録直後と同じ扱い |
| 停止からの復帰 | 直近 24 時間以内に発生したイベントだけ流し、それより古いものは捨てる |

※ Events API は直近 30 日・最大 300 件までしか取得できない。

## 6. コマンド

すべてのコマンドは誰でも実行できる。実行結果は実行した本人にだけ表示する（`/list` と `/ranking` を除く）。

| コマンド | 内容 |
|---|---|
| `/register <GitHubユーザー名>` | GitHub アカウントを登録する。登録済みなら上書きする（push 設定は引き継ぐ） |
| `/unregister` | 自分の登録を解除する |
| `/push on` | 自分の commit をタイムラインに流す |
| `/push off` | 自分の commit を流さない（初期設定） |
| `/list` | 登録者の一覧を表示する（GitHub ユーザー名と commit 表示のオンオフ。メンションはしない） |
| `/config channel <#チャンネル>` | タイムラインの投稿先チャンネルを変更する。テキスト・アナウンスチャンネルと公開スレッド（フォーラムの投稿を含む）を選べる。プライベートスレッドとロックされたスレッドは不可 |
| `/ranking` | 登録者を作成した PR の数で並べ、草が生えた日数を添えて表示する（§6.1） |
| `/help` | コマンドの説明と使い方を表示する（文言は別途作成） |

- `/push` などの設定コマンドは、実行した Discord ユーザー自身の設定を変更する（ユーザー名は引数に取らない）

### 6.1 `/ranking`

- 順位は **作成した PR の数**（GraphQL の `user.pullRequests.totalCount`。Bot のトークンから見える PR すべて＝実質 public 分）
- 各行に **草が生えた日数**（contribution が 1 以上の日の、GitHub を始めてからの合計）を（）で添える。本人がプロフィールで「Private contributions」をオンにしていれば private 分も入る
- 同じ PR 数は同率（2 位が 2 人なら次は 4 位）。同率の中は草の日数が多い順、次に GitHub 名順で並べる
- 10 位以内の人を表示する（10 位が同率で複数いれば全員出す）
- 実行した人が表示されていなければ、最後にその人の順位・PR 数・草の日数を付ける。未登録なら `/register` の案内を付ける
- 返事はチャンネルの全員に見える
- 取得は **`/ranking` が実行されたときだけ**（定期取得・保存はしない）。GitHub GraphQL API（`POST /graphql`）に 2 回問い合わせる
  1. 全員分の PR 数と `contributionsCollection.contributionYears`（活動した年）
  2. 全員分の、年ごとの `contributionCalendar`（`contributionsCollection` は 1 回で最大 1 年分のため、年ごとに alias を並べる）
  - 人数が多いときは 10 人ずつに分けて並行に問い合わせる
- GitHub 名が変わった・削除された登録者は GraphQL で見つからないので、ランキングから外す（ログに残す）
- Discord は 3 秒以内に応答しないとタイムアウトになるため、先に「集計しています…」と返し、集計後にそのメッセージを書き換える（`PATCH /webhooks/{application_id}/{token}/messages/@original`）。失敗したらエラーの文言に書き換える
- 草の数はあとから増えることがある（作業ブランチの commit が main にマージされると、commit した日に数えられる）

## 7. データの持ち方（Cloudflare D1）

### 7.1 `users`：登録者 1 人につき 1 行

| カラム | 型 | 内容 |
|---|---|---|
| `discord_user_id` | TEXT（主キー） | コマンドを実行した Discord ユーザーの ID |
| `github_login` | TEXT | GitHub ユーザー名（ポーリングの URL に使う） |
| `github_id` | INTEGER（UNIQUE） | GitHub のユーザー ID（commit の作者判定に使う）。同じ GitHub アカウントを複数の Discord ユーザーが登録することは許可しない |
| `push_enabled` | INTEGER | commit 表示のオンオフ（0 / 1、初期値 0） |
| `etag` | TEXT（null 可） | 前回のレスポンスの ETag |
| `seen_event_ids` | TEXT（null 可） | 前回取得したイベント ID の JSON 配列（最大 100 件）。null なら「登録直後」として扱う |
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
| `/register` | `GET /users/{name}` で存在を確認し、`github_id` を取得する。新規なら追加、登録済みなら上書きする。GitHub 名が変わった場合は `etag` と `seen_event_ids` を null にする |
| `/unregister` | 行を削除する |
| `/push on/off` | `push_enabled` を更新する |
| `/list` | `users` を全件取得する |
| `/config channel` | `settings` の `channel_id` を更新する |
| `/ranking` | `users` を全件取得する（集計結果は保存しない） |
| ポーリング | `last_polled_at` の古い順に取得し、処理後に `etag`・`seen_event_ids`・`last_polled_at` を更新する |

### 7.4 保存しないもの

- 投稿の履歴は保存しない。PR 数や草の日数は `/ranking` のたびに GitHub GraphQL API から取得する

## 8. 文言

`{}` は差し込む値。`/list` と `/ranking` 以外のコマンドの応答は実行した本人にだけ表示する。

### 8.1 コマンドの説明文（Discord のコマンド候補に表示）

| コマンド / 引数 | 説明文 |
|---|---|
| `/register` | GitHubアカウントを登録する |
| `/register` の `username` | GitHubのユーザー名 |
| `/unregister` | 登録を解除する |
| `/push` | commitを流すかを切り替える |
| `/push` の `on` / `off` | 流す / 流さない |
| `/list` | 登録者の一覧を表示する |
| `/config` | 設定を変更する（Discord の仕様で必須のため仮置き） |
| `/config channel` | 投稿先のチャンネルを変更する |
| `/config channel` の `channel` | 投稿先のチャンネル |
| `/ranking` | PRの数で登録者を並べる |
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

### 8.5 `/ranking`（仮の文言。精査中）

| 場面 | 文言 |
|---|---|
| 集計中 | 集計しています… |
| 見出し | PRランキング（登録者 {人数}人） |
| 1 行ごと | {順位}. {github}　{PR数}件（草 {日数}日） |
| 実行した人が表示外 | {github} は{順位}位です。{PR数}件（草 {日数}日） |
| 実行した人が未登録 | /register で登録すると、ランキングに参加できます。 |
| 登録者が 0 人 | 登録者はいません。 |
| 失敗 | 共通の内部エラーの文言 |

- GitHub 名は英数字とハイフンだけなので、バッククォートで囲まずそのまま出す
- 見出しの人数は、GitHub で見つかった登録者の数

### 8.6 `/help`

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

/ranking
  作成したPRの数で登録者を並べます。（）は草が生えた日数です。

タイムラインに流れるのはpublicリポジトリの活動だけです。反映まで最大5分ほどかかります。
```

- `#{channel}` は Discord のチャンネルリンク（`<#ID>`）で表示する。投稿先が未設定のときは「投稿先のチャンネル」と表示する

## 9. 今後の検討事項（MVP 外）

- 週次のまとめなど、やる気を出す追加機能（GraphQL の `contributionsCollection` を利用する想定）
- 本人確認（GitHub ログインなど）
- commit 作者判定の精度向上（メールアドレスの登録など）
