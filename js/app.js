'use strict';

// ===== Constants =====
const GRID_SIZE = 16;          // 4×4
const INITIAL_DIRTY = 3;       // 開始時の汚れマス数
const DIRTY_INTERVAL_MS = 1500; // 汚れ追加間隔(ms)
const ZENKESHI_DIRTY = 6;      // 全消し時に相手へ追加する汚れ数
const ZENKESHI_DURATION_MS = 5000; // 全消しボタン有効時間(ms)
const GAME_DURATION_SEC = 90;  // ゲーム時間(秒)
const TIMER_WARNING_SEC = 15;  // 残り秒数警告閾値

// ===== Game State =====
let state = {
  players: {
    1: createPlayerState(),
    2: createPlayerState(),
  },
  timeLeft: GAME_DURATION_SEC,
  running: false,
};

// interval / timeout IDs (リスタート時に解除)
let timerInterval = null;
let dirtyInterval = null;
const zenkeshiTimeouts = { 1: null, 2: null };
const zenkeshiCountdowns = { 1: null, 2: null };

// ===== Player State Factory =====
function createPlayerState() {
  return {
    tiles: new Array(GRID_SIZE).fill(false), // false=clean, true=dirty
    zenkeshiActive: false,
  };
}

// ===== DOM References =====
const dom = {
  timer: document.getElementById('timer'),
  grids: {
    1: document.getElementById('grid-p1'),
    2: document.getElementById('grid-p2'),
  },
  dirtyCounts: {
    1: document.getElementById('dirty-p1'),
    2: document.getElementById('dirty-p2'),
  },
  zenkeshiBtns: {
    1: document.getElementById('zenkeshi-p1'),
    2: document.getElementById('zenkeshi-p2'),
  },
  zenkeshiTimers: {
    1: document.getElementById('zenkeshi-timer-p1'),
    2: document.getElementById('zenkeshi-timer-p2'),
  },
  resultOverlay: document.getElementById('result-overlay'),
  resultText: document.getElementById('result-text'),
  restartBtn: document.getElementById('restart-btn'),
  app: document.getElementById('app'),
};

// ===== Initialization =====
function init() {
  clearAllTimers();

  state = {
    players: {
      1: createPlayerState(),
      2: createPlayerState(),
    },
    timeLeft: GAME_DURATION_SEC,
    running: true,
  };

  dom.app.classList.remove('game-over');
  dom.resultOverlay.classList.add('hidden');
  dom.timer.textContent = GAME_DURATION_SEC;
  dom.timer.classList.remove('warning');

  buildGrid(1);
  buildGrid(2);

  // 初期汚れを配置
  addRandomDirty(1, INITIAL_DIRTY);
  addRandomDirty(2, INITIAL_DIRTY);

  renderAll();

  // メインタイマー
  timerInterval = setInterval(onTimerTick, 1000);

  // 汚れ追加インターバル
  dirtyInterval = setInterval(onDirtyTick, DIRTY_INTERVAL_MS);
}

// ===== Grid Building =====
function buildGrid(playerId) {
  const grid = dom.grids[playerId];
  grid.innerHTML = '';

  for (let i = 0; i < GRID_SIZE; i++) {
    const tile = document.createElement('button');
    tile.className = 'tile tile--clean';
    tile.dataset.index = i;
    tile.dataset.player = playerId;
    tile.setAttribute('aria-label', `Player${playerId} マス${i + 1}`);
    tile.addEventListener('pointerdown', onTilePointerDown);
    grid.appendChild(tile);
  }
}

// ===== Tile Interaction =====
function onTilePointerDown(e) {
  e.preventDefault();
  if (!state.running) return;

  const tile = e.currentTarget;
  const playerId = Number(tile.dataset.player);
  const index = Number(tile.dataset.index);

  if (!state.players[playerId].tiles[index]) return; // clean tile → nothing

  // 汚れを消す
  state.players[playerId].tiles[index] = false;

  // 押し込み演出
  tile.classList.add('pressed');
  setTimeout(() => tile.classList.remove('pressed'), 100);

  renderPlayer(playerId);
  checkZenkeshi(playerId);
}

// ===== Timer Tick =====
function onTimerTick() {
  if (!state.running) return;

  state.timeLeft -= 1;
  dom.timer.textContent = state.timeLeft;

  if (state.timeLeft <= TIMER_WARNING_SEC) {
    dom.timer.classList.add('warning');
  }

  if (state.timeLeft <= 0) {
    endGame('timeout');
  }
}

// ===== Dirty Tick =====
function onDirtyTick() {
  if (!state.running) return;

  addRandomDirty(1, 1);
  addRandomDirty(2, 1);

  renderAll();
  checkLoseCondition(1);
  checkLoseCondition(2);
}

// ===== Add Random Dirty Tiles =====
function addRandomDirty(playerId, count) {
  const tiles = state.players[playerId].tiles;
  const cleanIndices = tiles
    .map((dirty, i) => (!dirty ? i : null))
    .filter(i => i !== null);

  const toMark = shuffle(cleanIndices).slice(0, count);

  toMark.forEach(i => {
    tiles[i] = true;
  });

  // アニメーション用クラス付与
  toMark.forEach(i => {
    const tileEl = getTileElement(playerId, i);
    if (tileEl) {
      tileEl.classList.add('tile--dirty-new');
      setTimeout(() => tileEl.classList.remove('tile--dirty-new'), 400);
    }
  });
}

// ===== Zenkeshi Logic =====
function checkZenkeshi(playerId) {
  const tiles = state.players[playerId].tiles;
  const allClean = tiles.every(d => !d);

  if (allClean && !state.players[playerId].zenkeshiActive) {
    activateZenkeshi(playerId);
  }
}

function activateZenkeshi(playerId) {
  state.players[playerId].zenkeshiActive = true;
  const btn = dom.zenkeshiBtns[playerId];
  btn.disabled = false;
  btn.classList.add('active');

  // カウントダウン表示
  let remaining = Math.ceil(ZENKESHI_DURATION_MS / 1000);
  updateZenkeshiTimer(playerId, remaining);
  zenkeshiCountdowns[playerId] = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      updateZenkeshiTimer(playerId, remaining);
    } else {
      clearInterval(zenkeshiCountdowns[playerId]);
      zenkeshiCountdowns[playerId] = null;
    }
  }, 1000);

  // 5秒後に無効化
  zenkeshiTimeouts[playerId] = setTimeout(() => {
    deactivateZenkeshi(playerId);
  }, ZENKESHI_DURATION_MS);
}

function deactivateZenkeshi(playerId) {
  state.players[playerId].zenkeshiActive = false;
  const btn = dom.zenkeshiBtns[playerId];
  btn.disabled = true;
  btn.classList.remove('active');
  updateZenkeshiTimer(playerId, '');

  clearInterval(zenkeshiCountdowns[playerId]);
  zenkeshiCountdowns[playerId] = null;
  zenkeshiTimeouts[playerId] = null;
}

function updateZenkeshiTimer(playerId, value) {
  dom.zenkeshiTimers[playerId].textContent = value ? `${value}秒` : '';
}

function onZenkeshiPress(playerId) {
  if (!state.running) return;
  if (!state.players[playerId].zenkeshiActive) return;

  const opponentId = playerId === 1 ? 2 : 1;

  // 相手に6マス汚れを追加
  addRandomDirty(opponentId, ZENKESHI_DIRTY);
  renderPlayer(opponentId);
  checkLoseCondition(opponentId);

  deactivateZenkeshi(playerId);

  // タイムアウトのキャンセル
  clearTimeout(zenkeshiTimeouts[playerId]);
  zenkeshiTimeouts[playerId] = null;
}

// ===== Lose Condition =====
function checkLoseCondition(playerId) {
  if (!state.running) return;
  const tiles = state.players[playerId].tiles;
  const allDirty = tiles.every(d => d);
  if (allDirty) {
    endGame('fullDirty', playerId);
  }
}

// ===== End Game =====
function endGame(reason, loserPlayerId) {
  state.running = false;
  clearAllTimers();
  dom.app.classList.add('game-over');

  let message = '';

  if (reason === 'fullDirty') {
    const winnerId = loserPlayerId === 1 ? 2 : 1;
    message = buildWinMessage(winnerId);
  } else if (reason === 'timeout') {
    const dirty1 = countDirty(1);
    const dirty2 = countDirty(2);

    if (dirty1 < dirty2) {
      message = buildWinMessage(1);
    } else if (dirty2 < dirty1) {
      message = buildWinMessage(2);
    } else {
      message = '<span class="draw">引き分け！</span>\n同点です';
    }
  }

  dom.resultText.innerHTML = message;
  dom.resultOverlay.classList.remove('hidden');
}

function buildWinMessage(winnerId) {
  return `<span class="winner">Player ${winnerId}\n勝利！</span>`;
}

// ===== Render =====
function renderAll() {
  renderPlayer(1);
  renderPlayer(2);
}

function renderPlayer(playerId) {
  const tiles = state.players[playerId].tiles;
  const grid = dom.grids[playerId];
  const tileEls = grid.querySelectorAll('.tile');
  let dirtyCount = 0;

  tileEls.forEach((el, i) => {
    const isDirty = tiles[i];
    el.classList.toggle('tile--dirty', isDirty);
    el.classList.toggle('tile--clean', !isDirty);
    if (isDirty) dirtyCount++;
  });

  dom.dirtyCounts[playerId].textContent = dirtyCount;
}

// ===== Utilities =====
function getTileElement(playerId, index) {
  return dom.grids[playerId].querySelector(`[data-index="${index}"]`);
}

function countDirty(playerId) {
  return state.players[playerId].tiles.filter(Boolean).length;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clearAllTimers() {
  clearInterval(timerInterval);
  clearInterval(dirtyInterval);
  timerInterval = null;
  dirtyInterval = null;

  [1, 2].forEach(id => {
    clearTimeout(zenkeshiTimeouts[id]);
    clearInterval(zenkeshiCountdowns[id]);
    zenkeshiTimeouts[id] = null;
    zenkeshiCountdowns[id] = null;
  });
}

// ===== Event Listeners =====
dom.restartBtn.addEventListener('click', init);

dom.zenkeshiBtns[1].addEventListener('click', () => onZenkeshiPress(1));
dom.zenkeshiBtns[2].addEventListener('click', () => onZenkeshiPress(2));

// ===== Start =====
init();
