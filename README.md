# sinchoku-timeline

Discord に登録したメンバーの GitHub 上の活動（PR の作成・commit）を、Discord のチャンネルに feed として流す Bot。
仕様は [docs/spec.md](docs/spec.md) を参照。

## 構成

```
src/
  index.ts              エントリポイント（fetch = スラッシュコマンド / scheduled = 5 分ごとのポーリング）
  poller.ts             ポーリング本体（Events API → 絞り込み → Discord に投稿）
  github.ts             GitHub REST API の呼び出し
  commits.ts            push に含まれる commit の絞り込み
  cards.ts              Discord に流すカード（Embed）の組み立て
  messages.ts           Bot が表示する文言（docs/spec.md §8）
  budget.ts             1 回の実行で使える外部リクエスト数の管理
  db.ts                 D1 へのアクセス
  env.ts                環境変数・バインディングの型
  discord/
    verify.ts           Interactions の署名検証
    handlers.ts         各スラッシュコマンドの処理
    definitions.ts      スラッシュコマンドの定義
    api.ts              Discord REST API の呼び出し
    permissions.ts      Bot がチャンネルに投稿できるかの計算
migrations/             D1 のテーブル定義
scripts/
  register-commands.ts  スラッシュコマンドを Discord に登録する
test/                   API を呼ばない部分のテスト
```

## 開発

```sh
npm install
npm run typecheck
npm test
```

## セットアップ

### 1. 必要なもの

| もの | 用意する場所 |
|---|---|
| GitHub の Personal Access Token（スコープなし） | GitHub → Settings → Developer settings |
| Discord アプリケーション（Bot） | Discord Developer Portal |
| Cloudflare アカウント | Cloudflare（無料プラン） |

Discord アプリケーションからは **Application ID**・**Public Key**・**Bot Token** を控えておく。
Bot は `bot` と `applications.commands` のスコープでサーバーに招待する。

### 2. D1 データベースを作る

```sh
npx wrangler d1 create sinchoku-timeline
```

表示された `database_id` を `wrangler.toml` に書き、テーブルを作る。

```sh
npm run db:migrate:remote
```

### 3. シークレットを設定する

```sh
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
```

### 4. デプロイする

```sh
npm run deploy
```

表示された Worker の URL（`https://sinchoku-timeline.<アカウント>.workers.dev`）を、Discord Developer Portal の
**Interactions Endpoint URL** に登録する。

### 5. スラッシュコマンドを登録する

`.dev.vars.example` を `.dev.vars` にコピーして値を入れ、実行する。

```sh
npm run register-commands
```

### 6. 投稿先を決める

Discord で `/config channel #チャンネル` を実行する。投稿先が決まるまでポーリングは動かない。

## ローカルで動かす

```sh
cp .dev.vars.example .dev.vars   # 値を入れる
npm run db:migrate:local
npm run dev
```

別のターミナルから定期実行を手動で起こせる。

```sh
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```
