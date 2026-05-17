# パニックウォッシュ — Phase 1（Firebase対戦版）

> Phase 0（同一端末ローカル版）の仕様は本ドキュメント下部に残してあります。

2人対戦型ポチポチパズルゲームの試作版（同一端末・Firebase なし）。

---

## 遊び方

1. ブラウザで `index.html` を開く
2. Player 1 は画面下側、Player 2 は画面上側（逆向き）を操作する
3. 汚れた茶色のマス（💩）をタップして消す
4. 消し続けて **16マスすべてきれいにする** と「全消し！」ボタンが 5 秒間光る
5. 光っている間にボタンを押すと **相手の盤面に 5 マス汚れを追加** できる
6. 自分の盤面が **16 マス全部汚れたら負け**
7. 60 秒経過したときは **汚れマスが少ない方の勝ち**（同数なら引き分け）
8. 「リスタート」ボタンでいつでも再スタートできる

---

## 起動方法

外部サーバー不要。ファイルをダブルクリックするだけで動作します。

```
panic-wash/
├── index.html       ← ここを開く
├── css/
│   └── style.css
├── js/
│   └── app.js
└── README.md
```

1. フォルダをダウンロード（または展開）する
2. `index.html` をブラウザで開く
3. スマートフォンで試す場合は `file://` で直接開くか、ローカルサーバーを立てる

```bash
# Python があれば簡単にサーバーを立てられる
python -m http.server 8080
# → http://localhost:8080 を開く
```

---

## 実装内容

### ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | HTML 構造。2 つの 4×4 グリッド・全消しボタン・結果オーバーレイ |
| `css/style.css` | スタイル。モバイルファースト・380px 対応 |
| `js/app.js` | ゲームロジック全体（外部ライブラリ不使用） |

### ゲームロジック（app.js）

| 関数 | 役割 |
|---|---|
| `init()` | ゲーム初期化・タイマー開始 |
| `buildGrid(playerId)` | DOM にタイル要素を生成 |
| `addRandomDirty(playerId, count)` | ランダムにクリーンマスを汚す |
| `onTilePointerDown(e)` | タップで汚れを消す |
| `onTimerTick()` | 1 秒ごとのカウントダウン |
| `onDirtyTick()` | 1.8 秒ごとの汚れ追加 |
| `checkZenkeshi(playerId)` | 全消し条件チェック・ボタン有効化 |
| `activateZenkeshi(playerId)` | 全消しボタンを 5 秒有効化 |
| `deactivateZenkeshi(playerId)` | 全消しボタンを無効化 |
| `onZenkeshiPress(playerId)` | 全消し実行・相手へ 5 マス追加 |
| `checkLoseCondition(playerId)` | 16 マス全汚れ→敗北判定 |
| `endGame(reason, loserPlayerId)` | 勝敗確定・結果表示 |
| `renderPlayer(playerId)` | タイル DOM を状態に同期 |
| `clearAllTimers()` | 全 interval/timeout を解除 |
| `shuffle(arr)` | Fisher-Yates シャッフル |

### バランス値（Phase 0 現在）

| 定数 | 値 | 説明 |
|---|---|---|
| `GAME_DURATION_SEC` | 60 秒 | 制限時間 |
| `DIRTY_INTERVAL_MS` | 1800 ms | 汚れ自動追加間隔 |
| `INITIAL_DIRTY` | 3 マス | 開始時の初期汚れ数 |
| `ZENKESHI_DIRTY` | 5 マス | 全消し攻撃で追加する汚れ数 |
| `ZENKESHI_DURATION_MS` | 5000 ms | 全消しボタンの有効時間 |
| `TIMER_WARNING_SEC` | 15 秒 | タイマー警告（赤点滅）開始秒数 |

### タイマー管理

- `setInterval` / `setTimeout` の ID をモジュールスコープ変数で管理
- `init()` 冒頭で `clearAllTimers()` を必ず呼び、二重起動を防止

### UI の工夫

- Player 2 エリアを `rotate(180deg)` で逆向き表示し、向かい合って遊べる
- `aspect-ratio: 1/1` でグリッドサイズを画面高さに追従させる
- 全消しボタン有効中は CSS アニメーション (`zenGlow`) で点滅
- 残り 15 秒以下でタイマーが赤く点滅
- タイル生成アニメーション (`dirtyAppear`) で新規汚れを視覚的に通知
- 押し込み演出は `pointerdown` + CSS `transform` で実現

---

---

## Phase 1 — Firebase 対戦版

### 概要

2台のスマホで別々に接続し、ルームIDを共有して対戦します。
**グリッド状態はローカル管理**し、Firebase には最小限の情報だけ同期します。

### Firebase Realtime Database セットアップ

1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを作成
2. Realtime Database を作成（ロケーション: `asia-southeast1` 推奨）
3. **ルール**を以下の開発用設定に変更

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

> ⚠ 上記は開発・テスト用です。本番では認証付きルールに変更してください。

4. Firebase Console > プロジェクト設定 > マイアプリ > SDK の設定と構成 から設定値を取得

### `js/firebase-config.js` の編集

Firebase Console > プロジェクト設定 > マイアプリ の画面から値をコピーして貼り付けてください。
`★ YOUR_...` と書かれた4項目を必ず書き換えてください。

```js
const firebaseConfig = {
  apiKey:            "AIza...",          // ★ 必須
  authDomain:        "panic-wash.firebaseapp.com",
  databaseURL:       "https://panic-wash-default-rtdb.asia-southeast1.firebasedatabase.app", // ★ 必須（Realtime DB作成後）
  projectId:         "panic-wash",
  storageBucket:     "panic-wash.firebasestorage.app",
  messagingSenderId: "123456789",        // ★ 必須
  appId:             "1:123:web:abc",    // ★ 必須
  measurementId:     "G-XXXXXXXX"       // 任意（Analytics使用時）
};
```

> ⚠ `databaseURL` は Realtime Database を作成しないと表示されません。
> Database 作成 → ロケーション選択 → 「テストモード」で開始 → URLをコピーして貼り付けてください。
>
> 未入力の項目があると起動時に **「Firebase 設定が未入力です」** エラーが表示されます。

### GitHub Pages での公開手順

```bash
git add .
git commit -m "Phase 1: Firebase対戦版"
git push origin main
# GitHub > Settings > Pages > Branch: main / root で公開
```

`index.html` を直接開く場合も動作します（`file://` でOK）。

### ルーム作成・参加方法

| 操作 | 手順 |
|---|---|
| ルーム作成 | 「ルームを作る」を押す → 6文字のルームIDが表示される |
| ID共有 | 「コピー」ボタンでIDをコピーし、相手に送る |
| ルーム参加 | IDを入力欄に貼り付け→「参加」を押す |
| ゲーム開始 | 両者が「準備OK！」を押すと自動でカウントダウン後スタート |

### Firebase 同期情報

| 情報 | 同期タイミング |
|---|---|
| `players/{role}/joined` | 参加時に書き込み |
| `players/{role}/ready` | 準備OK押下時 |
| `startAt` | player1 が両者 ready を確認して書き込み |
| `attackEvents/{id}` | 全消しボタン押下時にプッシュ |
| `players/{role}/dirtyCount` | 3秒ごと・タイムアウト時に書き込み |
| `players/{role}/alive` | 敗北時に `false` を書き込み |
| `players/{role}/timedOut` | 60秒タイムアウト時に書き込み |

**グリッド状態（16マスの汚れ配置）は Firebase に送信しません。各端末でローカル管理します。**

### Firebase データ構造

```
rooms/{roomId}/
  status:    "waiting" | "ready" | "playing" | "finished"
  createdAt: timestamp
  startAt:   timestamp
  host:      "player1"
  players/
    player1/ { joined, ready, name, dirtyCount, alive, timedOut }
    player2/ { joined, ready, name, dirtyCount, alive, timedOut }
  attackEvents/
    {eventId}/ { id, from, to, type, amount, createdAt }
```

### ファイル構成（Phase 1）

```
panic-wash/
├── index.html           ← 全画面を含む
├── css/style.css        ← ロビー/ゲーム/結果の全スタイル
├── js/
│   ├── firebase-config.js  ← ★ここに設定値を入力
│   └── app.js           ← Firebase連携含むゲームロジック
└── README.md
```

### 今後の課題

- Firebase Security Rules の本番用設定（認証付き）
- 切断検知（`onDisconnect` による自動クリーンアップ）
- ルーム一覧・マッチメイキング機能
- 観戦モード・リプレイ機能
- Firestore によるランキング・戦績記録
- PWA 対応（オフラインキャッシュ）

---

## Phase 0 — ローカル同一端末版（参考）

Phase 0 は Firebase なしで同一端末の上下2画面で遊べる試作版です。
`index.html` を直接ブラウザで開くだけで動作します（サーバー不要）。

### Phase 0 のバランス値

| 定数 | 値 | 説明 |
|---|---|---|
| `GAME_DURATION_SEC` | 60 秒 | 制限時間 |
| `DIRTY_INTERVAL_MS` | 1800 ms | 汚れ自動追加間隔 |
| `INITIAL_DIRTY` | 3 マス | 開始時の初期汚れ数 |
| `ZENKESHI_DIRTY` | 5 マス | 全消し攻撃で追加する汚れ数 |
| `ZENKESHI_DURATION_MS` | 5000 ms | 全消しボタンの有効時間 |

> Phase 1（Firebase版）では `js/firebase-config.js` の設定が必要です。
> `apiKey` が `YOUR_API_KEY` のままだと起動時にエラー画面を表示します。
