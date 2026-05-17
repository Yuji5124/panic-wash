# パニックウォッシュ — Phase 0

2人対戦型ポチポチパズルゲームの試作版（同一端末・Firebase なし）。

---

## 遊び方

1. ブラウザで `index.html` を開く
2. Player 1 は画面下側、Player 2 は画面上側（逆向き）を操作する
3. 汚れた茶色のマス（💩）をタップして消す
4. 消し続けて **16マスすべてきれいにする** と「全消し！」ボタンが 5 秒間光る
5. 光っている間にボタンを押すと **相手の盤面に 6 マス汚れを追加** できる
6. 自分の盤面が **16 マス全部汚れたら負け**
7. 90 秒経過したときは **汚れマスが少ない方の勝ち**（同数なら引き分け）
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
| `onDirtyTick()` | 1.5 秒ごとの汚れ追加 |
| `checkZenkeshi(playerId)` | 全消し条件チェック・ボタン有効化 |
| `activateZenkeshi(playerId)` | 全消しボタンを 5 秒有効化 |
| `deactivateZenkeshi(playerId)` | 全消しボタンを無効化 |
| `onZenkeshiPress(playerId)` | 全消し実行・相手へ 6 マス追加 |
| `checkLoseCondition(playerId)` | 16 マス全汚れ→敗北判定 |
| `endGame(reason, loserPlayerId)` | 勝敗確定・結果表示 |
| `renderPlayer(playerId)` | タイル DOM を状態に同期 |
| `clearAllTimers()` | 全 interval/timeout を解除 |
| `shuffle(arr)` | Fisher-Yates シャッフル |

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

## 次フェーズ：Firebase 対応予定

Phase 1 では Firebase を使ったオンライン対戦に拡張予定。

### 予定する変更

- **Firebase Realtime Database** でゲーム状態をリアルタイム同期
- ルームコード方式（4 桁）でマッチング
- 各プレイヤーが別端末で自分の盤面だけを操作
- Player 2 の `rotate(180deg)` を解除し、各自正向きで表示
- オフライン検知・再接続処理
- 任意：ランキング・勝率記録（Firestore）

### 移行時の主な作業

1. `firebase.js` を追加して SDK を初期化
2. `app.js` の `state` を Realtime Database の参照に置き換え
3. `onTilePointerDown` でローカル更新 → DB 書き込みに変更
4. `onValue` リスナーで相手の盤面変更を受信して描画
5. ルーム管理ロジック（作成・参加・退室）を追加
