// ============================================================
// js/firebase-config.js — Firebase プロジェクト設定
// ============================================================
// Firebase Console (https://console.firebase.google.com/) で
// プロジェクトを作成し、以下の値を書き換えてください。
//
// 取得手順:
//   Firebase Console > プロジェクト設定 > マイアプリ
//   > ウェブアプリを追加 > SDK の設定と構成
// ============================================================

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
