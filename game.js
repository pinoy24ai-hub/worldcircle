'use strict';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const DIFFICULTY_CONFIG = {
  easy:   { timer: 0,  hintCost: 5,  label: 'EASY',   rounds: 10, pointsBase: 10 },
  medium: { timer: 60, hintCost: 5,  label: 'MEDIUM', rounds: 10, pointsBase: 15 },
  hard:   { timer: 30, hintCost: 10, label: 'HARD',   rounds: 10, pointsBase: 20 },
  daily:  { timer: 0,  hintCost: 5,  label: 'DAILY',  rounds: 1,  pointsBase: 10 },
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let state = {
  difficulty: null,
  puzzles: [],
  round: 0,
  score: 0,
  streak: 0,
  bestStreak: 0,
  correct: 0,
  hintsUsed: 0,
  timerSec: 0,
  timerInterval: null,
  selectedIndices: [],
  tiles: [],
  wheelCenter: { x: 0, y: 0 },
  wheelRadius: 0,
  isDragging: false,
  feedbackTimeout: null,
  roundStart: null,
  speedBonuses: 0,
  currentPuzzle: null,
};

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const screens = {
  difficulty:  document.getElementById('screen-difficulty'),
  game:        document.getElementById('screen-game'),
  complete:    document.getElementById('screen-complete'),
  dailyResult: document.getElementById('screen-daily-result'),
};
const wheel          = document.getElementById('wheel');
const wheelWrapper   = document.getElementById('wheel-wrapper');
const trailCanvas    = document.getElementById('trail-canvas');
const ctx            = trailCanvas.getContext('2d');
const scoreDisplay   = document.getElementById('score-display');
const roundLabel     = document.getElementById('round-label');
const progressCircle = document.getElementById('progress-circle');
const diffLabel      = document.getElementById('diff-label');
const wordSlotsEl    = document.getElementById('word-slots');
const wordsHintEl    = document.getElementById('words-hint');
const currentWordEl  = document.getElementById('current-word-text');
const streakEl       = document.getElementById('streak-display');
const timerBarWrap   = document.getElementById('timer-bar-wrap');
const timerBar       = document.getElementById('timer-bar');
const feedbackBanner = document.getElementById('feedback-banner');
const hintCostEl     = document.getElementById('hint-cost');

// ─── SCREEN MANAGEMENT ───────────────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ─── DIFFICULTY SELECTION ────────────────────────────────────────────────────
document.querySelectorAll('.diff-card').forEach(card => {
  card.addEventListener('pointerdown', e => {
    e.preventDefault();
    startGame(card.dataset.difficulty);
  });
});

// Set today's date on daily badge
{
  const today = new Date();
  document.getElementById('daily-badge').textContent =
    today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── START GAME ───────────────────────────────────────────────────────────────
function startGame(difficulty) {
  state.difficulty  = difficulty;
  state.puzzles     = getPuzzles(difficulty);
  state.round       = 0;
  state.score       = 0;
  state.streak      = 0;
  state.bestStreak  = 0;
  state.correct     = 0;
  state.hintsUsed   = 0;
  state.speedBonuses = 0;

  const cfg = DIFFICULTY_CONFIG[difficulty];
  hintCostEl.textContent = `-${cfg.hintCost}`;
  diffLabel.textContent  = cfg.label;
  timerBarWrap.classList.toggle('active', cfg.timer > 0);

  showScreen('game');
  loadRound();
}

// ─── LOAD ROUND ───────────────────────────────────────────────────────────────
function loadRound() {
  clearTimer();
  clearTrail();
  clearSelection();
  state.isDragging = false;

  const cfg    = DIFFICULTY_CONFIG[state.difficulty];
  const total  = Math.min(state.puzzles.length, cfg.rounds);
  const puzzle = state.puzzles[state.round];
  state.currentPuzzle = puzzle;

  // Header
  roundLabel.textContent   = `${state.round + 1}/${total}`;
  scoreDisplay.textContent = state.score;
  updateProgress(state.round, total);
  updateStreak();

  // Words hint — "Find 1 of N words"
  const n = puzzle.validWords.length;
  wordsHintEl.textContent = n === 1
    ? 'Find the hidden word'
    : `Find 1 of ${n} possible words`;

  // Word slots — one per letter
  wordSlotsEl.innerHTML = '';
  for (let i = 0; i < puzzle.letters.length; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    wordSlotsEl.appendChild(slot);
  }

  // Shuffle letters before placing on wheel
  const shuffled = [...puzzle.letters].sort(() => Math.random() - 0.5);
  buildWheel(shuffled);

  state.roundStart = Date.now();
  if (cfg.timer > 0) startTimer(cfg.timer);
}

// ─── WHEEL BUILDER ────────────────────────────────────────────────────────────
function buildWheel(letters) {
  wheel.innerHTML = '';
  state.tiles = [];

  const vw      = window.innerWidth;
  const vh      = window.innerHeight;
  const maxSize = Math.min(vw - 32, vh * 0.42, 340);
  const size    = Math.max(maxSize, 200);
  const radius  = size / 2 - 34;

  wheel.style.width  = size + 'px';
  wheel.style.height = size + 'px';

  // Center hub
  const hub = document.createElement('div');
  hub.className = 'wheel-hub';
  const dot = document.createElement('div');
  dot.className = 'hub-dot';
  hub.appendChild(dot);
  wheel.appendChild(hub);

  const count = letters.length;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const cx = size / 2 + radius * Math.cos(angle);
    const cy = size / 2 + radius * Math.sin(angle);

    const tile = document.createElement('div');
    tile.className    = 'tile';
    tile.textContent  = letters[i];
    tile.style.left   = cx + 'px';
    tile.style.top    = cy + 'px';
    wheel.appendChild(tile);

    state.tiles.push({ el: tile, letter: letters[i], cx, cy, index: i });
  }

  requestAnimationFrame(() => recalcWheelGeometry());
}

function recalcWheelGeometry() {
  const rect = wheel.getBoundingClientRect();
  state.wheelCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  state.wheelRadius = rect.width / 2;
  const wr = wheelWrapper.getBoundingClientRect();
  trailCanvas.width  = wr.width;
  trailCanvas.height = wr.height;
}

// ─── POINTER EVENTS ───────────────────────────────────────────────────────────
wheel.addEventListener('pointerdown',   onPointerDown);
wheel.addEventListener('pointermove',   onPointerMove);
wheel.addEventListener('pointerup',     onPointerUp);
wheel.addEventListener('pointercancel', onPointerUp);

function onPointerDown(e) {
  e.preventDefault();
  wheel.setPointerCapture(e.pointerId);
  recalcWheelGeometry();
  state.isDragging = true;
  clearSelection();
  clearTrail();
  checkTileAtPoint(e.clientX, e.clientY);
  drawTrail(e.clientX, e.clientY);
}

function onPointerMove(e) {
  if (!state.isDragging) return;
  e.preventDefault();
  checkTileAtPoint(e.clientX, e.clientY);
  drawTrail(e.clientX, e.clientY);
}

function onPointerUp(e) {
  if (!state.isDragging) return;
  e.preventDefault();
  state.isDragging = false;
  clearTrail();
  submitWord();
}

// ─── TILE HIT TEST ────────────────────────────────────────────────────────────
function checkTileAtPoint(clientX, clientY) {
  const rect      = wheel.getBoundingClientRect();
  const localX    = clientX - rect.left;
  const localY    = clientY - rect.top;
  const hitRadius = 34;

  for (const tile of state.tiles) {
    if (state.selectedIndices.includes(tile.index)) continue;
    const dx = localX - tile.cx;
    const dy = localY - tile.cy;
    if (Math.sqrt(dx * dx + dy * dy) < hitRadius) {
      selectTile(tile);
      break;
    }
  }
}

function selectTile(tile) {
  state.selectedIndices.push(tile.index);
  tile.el.classList.add('selected');
  updateCurrentWord();
}

function clearSelection() {
  state.selectedIndices = [];
  state.tiles.forEach(t => t.el.classList.remove('selected', 'hint-tile'));
  updateCurrentWord();
}

function updateCurrentWord() {
  const word = state.selectedIndices.map(i => state.tiles[i].letter).join('');
  currentWordEl.textContent = word || '\u00a0';

  const slots = wordSlotsEl.querySelectorAll('.slot');
  slots.forEach((slot, i) => {
    if (i < word.length) {
      slot.textContent = word[i];
      slot.classList.add('filled');
    } else {
      slot.textContent = '';
      slot.classList.remove('filled', 'correct');
    }
  });
}

// ─── TRAIL CANVAS ─────────────────────────────────────────────────────────────
let trailPoints = [];

function drawTrail(clientX, clientY) {
  const wr = wheelWrapper.getBoundingClientRect();
  trailPoints.push({ x: clientX - wr.left, y: clientY - wr.top });

  ctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
  if (trailPoints.length < 2) return;

  drawTileConnectors(wr);

  ctx.beginPath();
  ctx.moveTo(trailPoints[0].x, trailPoints[0].y);
  for (let i = 1; i < trailPoints.length; i++) ctx.lineTo(trailPoints[i].x, trailPoints[i].y);
  ctx.strokeStyle = 'rgba(22,163,74,0.25)';
  ctx.lineWidth   = 3;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.stroke();
}

function drawTileConnectors(wr) {
  const sel = state.selectedIndices;
  if (sel.length < 2) return;
  const wheelRect = wheel.getBoundingClientRect();
  const offX = wheelRect.left - wr.left;
  const offY = wheelRect.top  - wr.top;

  ctx.beginPath();
  for (let i = 0; i < sel.length; i++) {
    const t = state.tiles[sel[i]];
    if (i === 0) ctx.moveTo(offX + t.cx, offY + t.cy);
    else         ctx.lineTo(offX + t.cx, offY + t.cy);
  }
  ctx.strokeStyle = 'rgba(22,163,74,0.65)';
  ctx.lineWidth   = 4;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.stroke();

  sel.forEach(idx => {
    const t = state.tiles[idx];
    ctx.beginPath();
    ctx.arc(offX + t.cx, offY + t.cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(22,163,74,0.7)';
    ctx.fill();
  });
}

function clearTrail() {
  trailPoints = [];
  ctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
}

// ─── WORD SUBMISSION ──────────────────────────────────────────────────────────
function submitWord() {
  const word = state.selectedIndices.map(i => state.tiles[i].letter).join('');
  if (!word.length) return;

  // Must use all letters (fill every slot)
  if (word.length < state.currentPuzzle.letters.length) {
    clearSelection();
    return;
  }

  if (state.currentPuzzle.validWords.includes(word)) {
    handleCorrect(word);
  } else {
    handleWrong();
  }
}

function handleCorrect(word) {
  const cfg     = DIFFICULTY_CONFIG[state.difficulty];
  const elapsed = (Date.now() - state.roundStart) / 1000;
  let   points  = cfg.pointsBase + word.length * 2;

  state.streak++;
  if (state.streak > state.bestStreak) state.bestStreak = state.streak;
  if (state.streak > 1) points = Math.floor(points * (1 + (state.streak - 1) * 0.25));

  if (cfg.timer > 0 && elapsed <= 10) {
    points += 15;
    state.speedBonuses++;
    showFeedback(`\u26a1 Speed Bonus! +${points}`, 'good');
  } else {
    showFeedback(`\u2713 ${word}${state.streak > 1 ? '  \uD83D\uDD25 ' + state.streak + 'x' : ''}  +${points}`, 'good');
  }

  state.score += points;
  state.correct++;
  scoreDisplay.textContent = state.score;
  updateStreak();

  wordSlotsEl.querySelectorAll('.slot').forEach(s => s.classList.add('correct'));
  wheel.classList.add('success');
  setTimeout(() => wheel.classList.remove('success'), 500);

  clearTimer();
  clearSelection();

  setTimeout(() => {
    state.round++;
    const total = Math.min(state.puzzles.length, cfg.rounds);
    if (state.round >= total) endGame();
    else loadRound();
  }, 700);
}

function handleWrong() {
  state.streak = 0;
  updateStreak();
  showFeedback('\u2717 Not a valid word', 'bad');
  wheel.classList.add('shake');
  setTimeout(() => wheel.classList.remove('shake'), 400);
  clearSelection();
}

// ─── TIMER ────────────────────────────────────────────────────────────────────
function startTimer(seconds) {
  state.timerSec = seconds;
  timerBar.style.transition = 'none';
  timerBar.style.width = '100%';
  timerBar.classList.remove('warning');
  timerBar.getBoundingClientRect();
  timerBar.style.transition = `width ${seconds}s linear`;
  timerBar.style.width = '0%';

  state.timerInterval = setInterval(() => {
    state.timerSec--;
    if (state.timerSec <= 8) timerBar.classList.add('warning');
    if (state.timerSec <= 0) {
      clearTimer();
      showFeedback('\u23f1 Time\'s up!', 'bad');
      state.streak = 0;
      updateStreak();
      state.round++;
      const cfg   = DIFFICULTY_CONFIG[state.difficulty];
      const total = Math.min(state.puzzles.length, cfg.rounds);
      setTimeout(() => {
        if (state.round >= total) endGame();
        else loadRound();
      }, 800);
    }
  }, 1000);
}

function clearTimer() {
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
}

// ─── CONTROLS ─────────────────────────────────────────────────────────────────
document.getElementById('btn-clear').addEventListener('pointerdown', e => { e.preventDefault(); clearSelection(); });
document.getElementById('btn-shuffle').addEventListener('pointerdown', e => { e.preventDefault(); shuffleWheel(); });
document.getElementById('btn-hint').addEventListener('pointerdown', e => { e.preventDefault(); useHint(); });
document.getElementById('btn-back').addEventListener('pointerdown', e => { e.preventDefault(); clearTimer(); showScreen('difficulty'); });

function shuffleWheel() {
  const shuffled = [...state.currentPuzzle.letters].sort(() => Math.random() - 0.5);
  clearSelection();
  buildWheel(shuffled);
  requestAnimationFrame(() => recalcWheelGeometry());
}

function useHint() {
  const cfg  = DIFFICULTY_CONFIG[state.difficulty];
  state.score = Math.max(0, state.score - cfg.hintCost);
  scoreDisplay.textContent = state.score;
  state.hintsUsed++;

  // Highlight all letters of the first valid word
  const target = state.currentPuzzle.validWords[0];
  const firstLetter = target[0];

  state.tiles.forEach(t => t.el.classList.remove('hint-tile'));
  state.tiles.filter(t => t.letter === firstLetter).forEach(t => t.el.classList.add('hint-tile'));

  showFeedback(`Hint: starts with "${firstLetter}"  (-${cfg.hintCost} pts)`, 'info');
  setTimeout(() => state.tiles.forEach(t => t.el.classList.remove('hint-tile')), 2200);
}

// ─── PROGRESS RING ────────────────────────────────────────────────────────────
function updateProgress(current, total) {
  const circumference = 125.66;
  progressCircle.style.strokeDashoffset = circumference * (1 - (total > 0 ? current / total : 0));
}

// ─── STREAK ───────────────────────────────────────────────────────────────────
function updateStreak() {
  streakEl.textContent = state.streak >= 2 ? `\uD83D\uDD25 ${state.streak}x Streak` : '';
}

// ─── FEEDBACK BANNER ─────────────────────────────────────────────────────────
function showFeedback(msg, type) {
  if (state.feedbackTimeout) clearTimeout(state.feedbackTimeout);
  feedbackBanner.textContent = msg;
  feedbackBanner.className   = `feedback-banner show ${type}`;
  state.feedbackTimeout = setTimeout(() => feedbackBanner.classList.remove('show'), 1800);
}

// ─── END GAME ─────────────────────────────────────────────────────────────────
function endGame() {
  clearTimer();
  if (state.difficulty === 'daily') showDailyResult();
  else showComplete();
}

function showComplete() {
  const cfg   = DIFFICULTY_CONFIG[state.difficulty];
  const total = Math.min(state.puzzles.length, cfg.rounds);
  document.getElementById('complete-title').textContent = 'Round Complete!';
  document.getElementById('final-score').textContent    = state.score;
  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-val">${state.correct}/${total}</div><div class="stat-lbl">CORRECT</div></div>
    <div class="stat-card"><div class="stat-val">${state.bestStreak}</div><div class="stat-lbl">BEST STREAK</div></div>
    <div class="stat-card"><div class="stat-val">${state.hintsUsed}</div><div class="stat-lbl">HINTS USED</div></div>
    <div class="stat-card"><div class="stat-val">${state.speedBonuses}</div><div class="stat-lbl">SPEED BONUSES</div></div>`;
  showScreen('complete');
}

function showDailyResult() {
  const today = new Date();
  document.getElementById('daily-date').textContent =
    today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('daily-score').textContent = state.score;
  const emoji = state.correct === 1 ? '\uD83D\uDFE2' : '\uD83D\uDD34';
  document.getElementById('share-text-box').textContent =
    `WordCircle Daily \u2014 ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}\n${emoji} Score: ${state.score}\n\uD83D\uDD25 Best Streak: ${state.bestStreak}\nPlay at WordCircle`;
  showScreen('dailyResult');
}

// ─── COMPLETE SCREEN BUTTONS ──────────────────────────────────────────────────
document.getElementById('btn-play-again').addEventListener('pointerdown', e => { e.preventDefault(); startGame(state.difficulty); });
document.getElementById('btn-menu').addEventListener('pointerdown', e => { e.preventDefault(); showScreen('difficulty'); });
document.getElementById('btn-daily-menu').addEventListener('pointerdown', e => { e.preventDefault(); showScreen('difficulty'); });
document.getElementById('btn-copy-share').addEventListener('pointerdown', e => {
  e.preventDefault();
  const txt = document.getElementById('share-text-box').textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => showFeedback('Copied!', 'good'));
});

// ─── RESIZE ───────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  if (screens.game.classList.contains('active')) {
    recalcWheelGeometry();
    const wr = wheelWrapper.getBoundingClientRect();
    trailCanvas.width  = wr.width;
    trailCanvas.height = wr.height;
  }
});
