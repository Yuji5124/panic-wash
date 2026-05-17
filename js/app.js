'use strict';

// ================================================================
// パニックウォッシュ Phase 1 — Firebase Realtime Database 対戦版
// ================================================================

(function main() {

  // ===== Firebase 初期化 =====
  function showFatalError(msg) {
    document.body.innerHTML =
      '<div style="padding:32px;color:#e94560;background:#1a1a2e;min-height:100vh;' +
      'font-family:sans-serif;display:flex;flex-direction:column;justify-content:center">' +
      '<h2 style="margin-bottom:16px">⚠ 設定エラー</h2>' +
      '<p style="line-height:1.8">' + msg + '</p></div>';
  }

  if (typeof firebase === 'undefined') {
    showFatalError('Firebase SDK が読み込めませんでした。<br>インターネット接続を確認してください。');
    return;
  }
  if (!window.firebaseConfig || firebaseConfig.apiKey === 'YOUR_API_KEY') {
    showFatalError('Firebase 設定が未入力です。<br><code>js/firebase-config.js</code> を編集してください。');
    return;
  }

  var db;
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
  } catch (e) {
    showFatalError('Firebase 初期化エラー: ' + e.message);
    return;
  }

  // ===== 定数 =====
  var GRID_SIZE            = 16;
  var INITIAL_DIRTY        = 3;
  var DIRTY_INTERVAL_MS    = 1800;
  var ZENKESHI_DIRTY       = 5;
  var ZENKESHI_DURATION_MS = 5000;
  var GAME_DURATION_SEC    = 60;
  var TIMER_WARNING_SEC    = 15;
  var TIMER_DANGER_SEC     = 10;
  var DIRTY_SYNC_MS        = 3000;  // Firebase への汚れ数同期間隔

  // ===== セッション状態 =====
  var session = { roomId: null, myRole: null, oppRole: null, startAt: null };

  // ===== ゲーム状態（ローカルのみ） =====
  var game = {
    tiles:          [],
    zenkeshiActive: false,
    timeLeft:       GAME_DURATION_SEC,
    running:        false,
    finished:       false,
  };

  var processedAttackIds = {};   // 処理済み攻撃ID管理
  var activeRefs         = [];   // Firebaseリスナー解除用

  // ===== タイマーID =====
  var timerInterval      = null;
  var dirtyInterval      = null;
  var dirtySyncInterval  = null;
  var zenkeshiTimeout    = null;
  var zenkeshiCountdown  = null;
  var timeoutFallback    = null;

  // ===== DOM =====
  var dom = {
    screens: {
      lobby:   document.getElementById('screen-lobby'),
      waiting: document.getElementById('screen-waiting'),
      ready:   document.getElementById('screen-ready'),
      game:    document.getElementById('screen-game'),
      result:  document.getElementById('screen-result'),
    },
    // Lobby
    btnCreate:      document.getElementById('btn-create'),
    inputRoomId:    document.getElementById('input-room-id'),
    btnJoin:        document.getElementById('btn-join'),
    lobbyError:     document.getElementById('lobby-error'),
    // Waiting
    displayRoomId:  document.getElementById('display-room-id'),
    btnCopy:        document.getElementById('btn-copy'),
    btnLeaveWaiting:document.getElementById('btn-leave-waiting'),
    // Ready
    readyRoomId:    document.getElementById('ready-room-id'),
    badgeSelfName:  document.getElementById('badge-self-name'),
    badgeOppName:   document.getElementById('badge-opp-name'),
    badgeSelfReady: document.getElementById('badge-self-ready'),
    badgeOppReady:  document.getElementById('badge-opp-ready'),
    btnReady:       document.getElementById('btn-ready'),
    btnLeaveReady:  document.getElementById('btn-leave-ready'),
    // Game
    timer:           document.getElementById('timer'),
    dirtySelf:       document.getElementById('dirty-self'),
    dirtyOpp:        document.getElementById('dirty-opp'),
    roleBadge:       document.getElementById('role-badge'),
    attackNotif:     document.getElementById('attack-notif'),
    gridSelf:        document.getElementById('grid-self'),
    gameGridWrap:    document.getElementById('game-grid-wrap'),
    zenkeshiBtn:     document.getElementById('zenkeshi-btn'),
    zenkeshiTimerDisp: document.getElementById('zenkeshi-timer-disp'),
    // Result
    resultContent:  document.getElementById('result-content'),
    btnToLobby:     document.getElementById('btn-to-lobby'),
  };

  // ===== 画面切り替え =====
  function showScreen(name) {
    Object.keys(dom.screens).forEach(function(k) {
      dom.screens[k].classList.remove('screen--active');
    });
    dom.screens[name].classList.add('screen--active');
  }

  // ===== ロビー =====
  function setLobbyBusy(busy) {
    dom.btnCreate.disabled = busy;
    dom.btnJoin.disabled   = busy;
  }

  function onCreateRoom() {
    setLobbyBusy(true);
    var roomId = generateRoomId();
    session.roomId  = roomId;
    session.myRole  = 'player1';
    session.oppRole = 'player2';

    db.ref('rooms/' + roomId).set({
      status:    'waiting',
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      host:      'player1',
      players: {
        player1: { joined: true, ready: false, name: 'Player 1',
                   dirtyCount: 0, alive: true, timedOut: false },
      },
    }).then(function() {
      dom.displayRoomId.textContent = roomId;
      showScreen('waiting');
      listenForOpponentJoin(roomId);
    }).catch(function(e) {
      setLobbyBusy(false);
      showLobbyError('作成失敗: ' + e.message);
    });
  }

  function onJoinRoom() {
    var roomId = dom.inputRoomId.value.trim().toUpperCase();
    if (roomId.length < 4) { showLobbyError('ルームIDを入力してください'); return; }

    setLobbyBusy(true);
    db.ref('rooms/' + roomId).once('value').then(function(snap) {
      if (!snap.exists()) { setLobbyBusy(false); showLobbyError('ルームが見つかりません'); return; }
      var room = snap.val();
      if (room.status === 'playing' || room.status === 'finished') {
        setLobbyBusy(false); showLobbyError('このルームはすでにゲーム中です'); return;
      }
      if (room.players && room.players.player2 && room.players.player2.joined) {
        setLobbyBusy(false); showLobbyError('このルームは満員です'); return;
      }

      // トランザクションで player2 スロットを確保（競合防止）
      db.ref('rooms/' + roomId + '/players/player2').transaction(function(cur) {
        if (cur !== null) return; // abort: すでに player2 がいる
        return { joined: true, ready: false, name: 'Player 2',
                 dirtyCount: 0, alive: true, timedOut: false };
      }).then(function(result) {
        if (!result.committed) { showLobbyError('このルームは満員です'); return; }
        // トランザクション成功後に status を再確認（参加直前にゲームが始まった競合を防ぐ）
        return db.ref('rooms/' + roomId + '/status').once('value').then(function(s) {
          if (s.val() === 'playing' || s.val() === 'finished') {
            db.ref('rooms/' + roomId + '/players/player2').remove();
            setLobbyBusy(false);
            showLobbyError('このルームはすでにゲーム中です');
            return;
          }
          session.roomId  = roomId;
          session.myRole  = 'player2';
          session.oppRole = 'player1';
          db.ref('rooms/' + roomId + '/status').set('ready');
          enterReadyScreen(roomId);
        });
      }).catch(function(e) { setLobbyBusy(false); showLobbyError('参加失敗: ' + e.message); });
    }).catch(function(e) { setLobbyBusy(false); showLobbyError('エラー: ' + e.message); });
  }

  function showLobbyError(msg) {
    dom.lobbyError.textContent = msg;
    setTimeout(function() { dom.lobbyError.textContent = ''; }, 4000);
  }

  function listenForOpponentJoin(roomId) {
    var ref = db.ref('rooms/' + roomId + '/players/player2/joined');
    var h = ref.on('value', function(snap) {
      if (snap.val() === true) {
        ref.off('value', h);
        removeRef(ref);
        enterReadyScreen(roomId);
      }
    });
    activeRefs.push({ ref: ref, event: 'value', handler: h });
  }

  // ===== Ready 画面 =====
  function enterReadyScreen(roomId) {
    dom.readyRoomId.textContent   = roomId;
    dom.badgeSelfName.textContent = session.myRole === 'player1' ? 'Player 1' : 'Player 2';
    dom.badgeOppName.textContent  = session.myRole === 'player1' ? 'Player 2' : 'Player 1';
    dom.badgeSelfReady.textContent = '待機中';
    dom.badgeOppReady.textContent  = '待機中';
    dom.badgeSelfReady.classList.remove('badge-status--ok');
    dom.badgeOppReady.classList.remove('badge-status--ok');
    dom.btnReady.disabled = false;
    dom.btnReady.classList.remove('btn--done');
    showScreen('ready');

    // 相手の ready 状態を監視
    var oppReadyRef = db.ref('rooms/' + roomId + '/players/' + session.oppRole + '/ready');
    var h1 = oppReadyRef.on('value', function(snap) {
      var ok = snap.val() === true;
      dom.badgeOppReady.textContent = ok ? '準備OK ✓' : '待機中';
      dom.badgeOppReady.classList.toggle('badge-status--ok', ok);
    });
    activeRefs.push({ ref: oppReadyRef, event: 'value', handler: h1 });

    // status が playing になったらゲーム開始
    var statusRef = db.ref('rooms/' + roomId + '/status');
    var h2 = statusRef.on('value', function(snap) {
      if (snap.val() === 'playing') {
        detachAllListeners();
        db.ref('rooms/' + roomId + '/startAt').once('value').then(function(s) {
          session.startAt = s.val();
          startGame();
        });
      }
    });
    activeRefs.push({ ref: statusRef, event: 'value', handler: h2 });
  }

  function onPressReady() {
    dom.btnReady.disabled = true;
    dom.btnReady.classList.add('btn--done');
    dom.badgeSelfReady.textContent = '準備OK ✓';
    dom.badgeSelfReady.classList.add('badge-status--ok');

    var roomId = session.roomId;
    db.ref('rooms/' + roomId + '/players/' + session.myRole + '/ready').set(true);

    // player1 だけが startAt を書き込む責任を持つ
    if (session.myRole === 'player1') {
      watchBothReady(roomId);
    }
  }

  function watchBothReady(roomId) {
    var playersRef = db.ref('rooms/' + roomId + '/players');
    var h = playersRef.on('value', function(snap) {
      var p = snap.val() || {};
      if (p.player1 && p.player1.ready && p.player2 && p.player2.ready) {
        playersRef.off('value', h);
        removeRef(playersRef);
        var startAt = Date.now() + 1500;  // 1.5秒後にスタート
        db.ref('rooms/' + roomId + '/startAt').set(startAt);
        db.ref('rooms/' + roomId + '/status').set('playing');
      }
    });
    activeRefs.push({ ref: playersRef, event: 'value', handler: h });
  }

  // ===== ゲーム開始 =====
  function startGame() {
    clearGameTimers();
    processedAttackIds = {};

    game = {
      tiles:          new Array(GRID_SIZE).fill(false),
      zenkeshiActive: false,
      timeLeft:       GAME_DURATION_SEC,
      running:        false,
      finished:       false,
    };

    dom.timer.textContent = GAME_DURATION_SEC;
    dom.timer.classList.remove('warning', 'danger');
    dom.roleBadge.textContent  = session.myRole === 'player1' ? 'P1' : 'P2';
    dom.dirtyOpp.textContent   = '?';
    dom.attackNotif.textContent = '';
    dom.zenkeshiBtn.disabled   = true;
    dom.zenkeshiBtn.classList.remove('active');
    dom.zenkeshiTimerDisp.textContent = '';

    buildGrid();
    addRandomDirty(INITIAL_DIRTY);
    renderGrid();

    showScreen('game');

    var delay = Math.max(0, session.startAt - Date.now());
    setTimeout(function() {
      game.running      = true;
      timerInterval     = setInterval(onTimerTick, 1000);
      dirtyInterval     = setInterval(onDirtyTick, DIRTY_INTERVAL_MS);
      dirtySyncInterval = setInterval(syncDirtyCount, DIRTY_SYNC_MS);
      listenAttackEvents();
      listenOpponentStatus();
    }, delay);
  }

  // ===== グリッド構築 =====
  function buildGrid() {
    dom.gridSelf.innerHTML = '';
    for (var i = 0; i < GRID_SIZE; i++) {
      var tile = document.createElement('button');
      tile.className    = 'tile tile--clean';
      tile.dataset.index = i;
      tile.setAttribute('aria-label', 'マス' + (i + 1));
      tile.addEventListener('pointerdown', onTilePointerDown);
      dom.gridSelf.appendChild(tile);
    }
  }

  function onTilePointerDown(e) {
    e.preventDefault();
    if (!game.running) return;
    var tile  = e.currentTarget;
    var index = Number(tile.dataset.index);
    if (!game.tiles[index]) return;

    game.tiles[index] = false;
    tile.classList.add('pressed');
    setTimeout(function() { tile.classList.remove('pressed'); }, 100);
    renderGrid();
    setTimeout(function() { triggerAnimation(tile, 'tile--sparkle', 380); }, 110);
    checkZenkeshi();
  }

  // ===== タイマー =====
  function onTimerTick() {
    if (!game.running) return;
    game.timeLeft -= 1;
    dom.timer.textContent = game.timeLeft;
    if (game.timeLeft <= TIMER_DANGER_SEC) {
      dom.timer.classList.add('danger');
    } else if (game.timeLeft <= TIMER_WARNING_SEC) {
      dom.timer.classList.add('warning');
    }
    if (game.timeLeft <= 0) onTimeout();
  }

  // ===== 汚れ追加（自動） =====
  function onDirtyTick() {
    if (!game.running) return;
    addRandomDirty(1);
    renderGrid();
    checkLoseCondition();
  }

  // ===== Firebase 汚れ数同期 =====
  function syncDirtyCount() {
    if (!game.running && !game.finished) return;
    var count = countDirty();
    db.ref('rooms/' + session.roomId + '/players/' + session.myRole + '/dirtyCount').set(count);
  }

  // ===== 全消し =====
  function checkZenkeshi() {
    var allClean = game.tiles.every(function(d) { return !d; });
    if (allClean && !game.zenkeshiActive) activateZenkeshi();
  }

  function activateZenkeshi() {
    game.zenkeshiActive = true;
    dom.zenkeshiBtn.disabled = false;
    dom.zenkeshiBtn.classList.add('active');
    triggerAnimation(dom.gameGridWrap, 'area--flash', 600);

    var remaining = Math.ceil(ZENKESHI_DURATION_MS / 1000);
    dom.zenkeshiTimerDisp.textContent = remaining + '秒';
    zenkeshiCountdown = setInterval(function() {
      remaining -= 1;
      if (remaining > 0) {
        dom.zenkeshiTimerDisp.textContent = remaining + '秒';
      } else {
        clearInterval(zenkeshiCountdown);
        zenkeshiCountdown = null;
      }
    }, 1000);
    zenkeshiTimeout = setTimeout(deactivateZenkeshi, ZENKESHI_DURATION_MS);
  }

  function deactivateZenkeshi() {
    game.zenkeshiActive = false;
    dom.zenkeshiBtn.disabled = true;
    dom.zenkeshiBtn.classList.remove('active');
    dom.zenkeshiTimerDisp.textContent = '';
    clearInterval(zenkeshiCountdown);
    clearTimeout(zenkeshiTimeout);
    zenkeshiCountdown = zenkeshiTimeout = null;
  }

  function onZenkeshiPress() {
    if (!game.running || !game.zenkeshiActive) return;
    var evRef = db.ref('rooms/' + session.roomId + '/attackEvents').push();
    evRef.set({
      id:        evRef.key,
      from:      session.myRole,
      to:        session.oppRole,
      type:      'zenkeshi',
      amount:    ZENKESHI_DIRTY,
      createdAt: firebase.database.ServerValue.TIMESTAMP,
    });
    deactivateZenkeshi();
  }

  // ===== 攻撃イベント受信 =====
  function listenAttackEvents() {
    var ref = db.ref('rooms/' + session.roomId + '/attackEvents');
    var h = ref.on('child_added', function(snap) {
      var ev = snap.val();
      if (!ev || ev.to !== session.myRole) return;
      if (processedAttackIds[ev.id]) return;
      processedAttackIds[ev.id] = true;
      receiveAttack(ev.amount);
    });
    activeRefs.push({ ref: ref, event: 'child_added', handler: h });
  }

  function receiveAttack(amount) {
    if (!game.running) return;
    addRandomDirty(amount);
    renderGrid();
    triggerAnimation(dom.gridSelf, 'grid--shake', 500);
    showAttackNotif();
    checkLoseCondition();
  }

  function showAttackNotif() {
    dom.attackNotif.textContent = '⚡攻撃！';
    dom.attackNotif.classList.add('attack-notif--active');
    setTimeout(function() {
      dom.attackNotif.textContent = '';
      dom.attackNotif.classList.remove('attack-notif--active');
    }, 1800);
  }

  // ===== 相手状態監視 =====
  function listenOpponentStatus() {
    var ref = db.ref('rooms/' + session.roomId + '/players/' + session.oppRole);
    var h = ref.on('value', function(snap) {
      var d = snap.val() || {};
      dom.dirtyOpp.textContent = (d.dirtyCount !== undefined) ? d.dirtyCount : '?';
      if (d.alive === false && !game.finished) endGame('win', 'opponentLost');
    });
    activeRefs.push({ ref: ref, event: 'value', handler: h });
  }

  // ===== 負け判定 =====
  function checkLoseCondition() {
    if (!game.running) return;
    var allDirty = game.tiles.every(function(d) { return d; });
    if (allDirty) endGame('lose', 'fullDirty');
  }

  // ===== タイムアウト =====
  function onTimeout() {
    if (game.finished) return;
    game.running = false;
    clearGameTimers();

    var myDirty = countDirty();
    db.ref('rooms/' + session.roomId + '/players/' + session.myRole).update({
      dirtyCount: myDirty,
      timedOut:   true,
    });

    // 相手の timedOut を待って勝敗判定
    var playersRef = db.ref('rooms/' + session.roomId + '/players');
    var h = playersRef.on('value', function(snap) {
      var p = snap.val() || {};
      if (p[session.oppRole] && p[session.oppRole].timedOut === true) {
        playersRef.off('value', h);
        removeRef(playersRef);
        clearTimeout(timeoutFallback);
        var myC   = p[session.myRole]  ? (p[session.myRole].dirtyCount  || 0) : 99;
        var oppC  = p[session.oppRole] ? (p[session.oppRole].dirtyCount || 0) : 99;
        if (myC < oppC)      endGame('win',  'timeup');
        else if (myC > oppC) endGame('lose', 'timeup');
        else                 endGame('draw', 'timeup');
      }
    });
    // activeRefs に登録して leaveRoom() や endGame() 経由でも確実に解除できるようにする
    activeRefs.push({ ref: playersRef, event: 'value', handler: h });

    // 相手が切断した場合の保険（5秒後）
    timeoutFallback = setTimeout(function() {
      playersRef.off('value', h);
      removeRef(playersRef);
      if (!game.finished) endGame('win', 'timeup');
    }, 5000);
  }

  // ===== ゲーム終了 =====
  function endGame(outcome, reason) {
    if (game.finished) return;
    game.finished = true;
    game.running  = false;
    clearGameTimers();
    clearTimeout(timeoutFallback);
    detachAllListeners();

    if (outcome === 'lose') {
      db.ref('rooms/' + session.roomId + '/players/' + session.myRole + '/alive').set(false);
    }

    var html = '';
    if (outcome === 'win') {
      html = '<div class="result-win">勝利！</div>' +
             '<p class="result-sub">' + reasonLabel(reason) + '</p>';
    } else if (outcome === 'lose') {
      html = '<div class="result-lose">敗北…</div>' +
             '<p class="result-sub">' + reasonLabel(reason) + '</p>';
    } else {
      html = '<div class="result-draw">引き分け</div>' +
             '<p class="result-sub">汚れ数が同じでした</p>';
    }
    dom.resultContent.innerHTML = html;
    showScreen('result');
  }

  function reasonLabel(r) {
    if (r === 'fullDirty')    return '盤面が全部汚れてしまいました';
    if (r === 'opponentLost') return '相手の盤面が全部汚れました';
    if (r === 'timeup')       return '60秒経過 — 汚れ数で判定';
    return '';
  }

  // ===== 退室 =====
  function leaveRoom() {
    clearGameTimers();
    clearTimeout(timeoutFallback);
    detachAllListeners();

    if (session.roomId && session.myRole) {
      if (session.myRole === 'player1') {
        db.ref('rooms/' + session.roomId).remove();
      } else {
        db.ref('rooms/' + session.roomId + '/players/player2').remove();
        db.ref('rooms/' + session.roomId + '/status').set('waiting');
      }
    }

    session = { roomId: null, myRole: null, oppRole: null, startAt: null };
    game.finished = true;
    dom.lobbyError.textContent = '';
    dom.inputRoomId.value = '';
    setLobbyBusy(false);
    showScreen('lobby');
  }

  // ===== レンダリング =====
  function renderGrid() {
    var els = dom.gridSelf.querySelectorAll('.tile');
    var dirty = 0;
    els.forEach(function(el, i) {
      var isDirty = game.tiles[i];
      el.classList.toggle('tile--dirty', isDirty);
      el.classList.toggle('tile--clean', !isDirty);
      if (isDirty) dirty++;
    });
    dom.dirtySelf.textContent = dirty;
  }

  // ===== ユーティリティ =====
  function addRandomDirty(count) {
    var cleanIdx = game.tiles
      .map(function(d, i) { return !d ? i : null; })
      .filter(function(i) { return i !== null; });
    var toMark = shuffle(cleanIdx).slice(0, count);
    toMark.forEach(function(i) {
      game.tiles[i] = true;
      var el = dom.gridSelf.querySelector('[data-index="' + i + '"]');
      if (el) triggerAnimation(el, 'tile--dirty-new', 400);
    });
  }

  function countDirty() {
    return game.tiles.filter(Boolean).length;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function triggerAnimation(el, cls, dur) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function() { el.classList.remove(cls); }, dur);
  }

  function generateRoomId() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var id = '';
    for (var i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }

  function clearGameTimers() {
    clearInterval(timerInterval);
    clearInterval(dirtyInterval);
    clearInterval(dirtySyncInterval);
    clearTimeout(zenkeshiTimeout);
    clearInterval(zenkeshiCountdown);
    timerInterval = dirtyInterval = dirtySyncInterval = null;
    zenkeshiTimeout = zenkeshiCountdown = null;
  }

  function detachAllListeners() {
    activeRefs.forEach(function(entry) {
      entry.ref.off(entry.event, entry.handler);
    });
    activeRefs = [];
  }

  function removeRef(ref) {
    activeRefs = activeRefs.filter(function(e) { return e.ref !== ref; });
  }

  // ===== イベントリスナー =====
  dom.btnCreate.addEventListener('click', onCreateRoom);
  dom.btnJoin.addEventListener('click', onJoinRoom);
  dom.inputRoomId.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') onJoinRoom();
  });
  dom.inputRoomId.addEventListener('input', function() {
    dom.inputRoomId.value = dom.inputRoomId.value.toUpperCase();
  });
  dom.btnCopy.addEventListener('click', function() {
    var id = session.roomId || dom.displayRoomId.textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(id).then(function() {
        dom.btnCopy.textContent = 'コピー済み✓';
        setTimeout(function() { dom.btnCopy.textContent = 'コピー'; }, 2000);
      });
    } else {
      dom.btnCopy.textContent = id;  // fallback: select manually
    }
  });
  dom.btnLeaveWaiting.addEventListener('click', leaveRoom);
  dom.btnLeaveReady.addEventListener('click', leaveRoom);
  dom.btnReady.addEventListener('click', onPressReady);
  dom.zenkeshiBtn.addEventListener('click', onZenkeshiPress);
  dom.btnToLobby.addEventListener('click', leaveRoom);

  // ===== 起動 =====
  showScreen('lobby');

})(); // end main
