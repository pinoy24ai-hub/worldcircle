'use strict';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const DIFFICULTY_CONFIG = {
  easy:   { wordLen: 5, timer: 0,  hintCost: 5,  tilesCount: 8,  label: 'EASY',   rounds: 10, pointsBase: 10 },
  medium: { wordLen: 6, timer: 60, hintCost: 5,  tilesCount: 10, label: 'MEDIUM', rounds: 10, pointsBase: 15 },
  hard:   { wordLen: 7, timer: 30, hintCost: 10, tilesCount: 10, label: 'HARD',   rounds: 10, pointsBase: 20 },
  daily:  { wordLen: 5, timer: 0,  hintCost: 5,  tilesCount: 8,  label: 'DAILY',  rounds: 1,  pointsBase: 10 },
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
  timerStart: null,
  selectedIndices: [],
  tiles: [],           // { el, letter, cx, cy, index }
  wheelCenter: { x: 0, y: 0 },
  wheelRadius: 0,
  isDragging: false,
  feedbackTimeout: null,
  hintIndices: [],
  roundStart: null,
  speedBonuses: 0,
  currentPuzzle: null,
};

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const screens = {
  difficulty:   document.getElementById('screen-difficulty'),
  game:         document.getElementById('screen-game'),
  complete:     document.getElementById('screen-complete'),
  dailyResult:  document.getElementById('screen-daily-result'),
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
    const d = card.dataset.difficulty;
    startGame(d);
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
  state.difficulty = difficulty;
  state.puzzles    = getPuzzles(difficulty);
  state.round      = 0;
  state.score      = 0;
  state.streak     = 0;
  state.bestStreak = 0;
  state.correct    = 0;
  state.hintsUsed  = 0;
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
  state.hintIndices = [];
  state.isDragging  = false;

  const cfg   = DIFFICULTY_CONFIG[state.difficulty];
  const total = Math.min(state.puzzles.length, cfg.rounds);
  const puzzle = state.puzzles[state.round];
  state.currentPuzzle = puzzle;

  // Header
  roundLabel.textContent   = `${state.round + 1}/${total}`;
  scoreDisplay.textContent = state.score;
  updateProgress(state.round, total);
  updateStreak();

  // Word slots
  wordSlotsEl.innerHTML = '';
  for (let i = 0; i < puzzle.word.length; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.index = i;
    wordSlotsEl.appendChild(slot);
  }

  // Build wheel
  buildWheel(puzzle.letters);

  // Start timer
  state.roundStart = Date.now();
  if (cfg.timer > 0) {
    startTimer(cfg.timer);
  }
}

// ─── WHEEL BUILDER ────────────────────────────────────────────────────────────
function buildWheel(letters) {
  wheel.innerHTML = '';
  state.tiles = [];

  // Size wheel based on viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxSize = Math.min(vw - 32, vh * 0.42, 340);
  const size     = Math.max(maxSize, 200);
  const radius   = size / 2 - 34;

  wheel.style.width  = size + 'px';
  wheel.style.height = size + 'px';

  // Center hub
  const hub = document.createElement('div');
  hub.className = 'wheel-hub';
  const dot = document.createElement('div');
  dot.className = 'hub-dot';
  hub.appendChild(dot);
  wheel.appendChild(hub);

  // Tiles
  const count = letters.length;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const cx = size / 2 + radius * Math.cos(angle);
    const cy = size / 2 + radius * Math.sin(angle);

    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.textContent = letters[i];
    tile.style.left = cx + 'px';
    tile.style.top  = cy + 'px';
    wheel.appendChild(tile);

    state.tiles.push({ el: tile, letter: letters[i], cx, cy, index: i });
  }

  // Store wheel geometry (recalc after DOM settles)
  requestAnimationFrame(() => recalcWheelGeometry());
}

function recalcWheelGeometry() {
  const rect = wheel.getBoundingClientRect();
  state.wheelCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  state.wheelRadius = rect.width / 2;

  // Also resize canvas
  const wr = wheelWrapper.getBoundingClientRect();
  trailCanvas.width  = wr.width;
  trailCanvas.height = wr.height;
}

// ─── POINTER EVENTS ───────────────────────────────────────────────────────────
wheel.addEventListener('pointerdown', onPointerDown);
wheel.addEventListener('pointermove', onPointerMove);
wheel.addEventListener('pointerup',   onPointerUp);
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
  const rect     = wheel.getBoundingClientRect();
  const localX   = clientX - rect.left;
  const localY   = clientY - rect.top;
  const hitRadius = 34; // px around tile center

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

  // Update slots with typed letters
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
  const wr   = wheelWrapper.getBoundingClientRect();
  const lx   = clientX - wr.left;
  const ly   = clientY - wr.top;
  trailPoints.push({ x: lx, y: ly });

  ctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
  if (trailPoints.length < 2) return;

  // Draw tile-to-tile lines first
  drawTileConnectors(wr);

  // Draw finger trail
  ctx.beginPath();
  ctx.moveTo(trailPoints[0].x, trailPoints[0].y);
  for (let i = 1; i < trailPoints.length; i++) {
    ctx.lineTo(trailPoints[i].x, trailPoints[i].y);
  }
  ctx.strokeStyle = 'rgba(167,139,250,0.35)';
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
    const x = offX + t.cx;
    const y = offY + t.cy;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(139,92,246,0.7)';
  ctx.lineWidth   = 4;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.stroke();

  // Dots at each selected tile
  sel.forEach(idx => {
    const t = state.tiles[idx];
    ctx.beginPath();
    ctx.arc(offX + t.cx, offY + t.cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(167,139,250,0.8)';
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
  if (word.length === 0) return;

  const target = state.currentPuzzle.word;
  if (word === target) {
    handleCorrect();
  } else {
    handleWrong(word);
  }
}

function handleCorrect() {
  const cfg      = DIFFICULTY_CONFIG[state.difficulty];
  const elapsed  = (Date.now() - state.roundStart) / 1000;
  let   points   = cfg.pointsBase + state.currentPuzzle.word.length * 2;

  // Streak multiplier
  state.streak++;
  if (state.streak > state.bestStreak) state.bestStreak = state.streak;
  if (state.streak > 1) {
    points = Math.floor(points * (1 + (state.streak - 1) * 0.25));
  }

  // Speed bonus (timed modes, under 10s)
  if (cfg.timer > 0 && elapsed <= 10) {
    points += 15;
    state.speedBonuses++;
    showFeedback(`⚡ Speed Bonus! +15`, 'good');
  } else {
    showFeedback(`✓ ${state.streak > 1 ? state.streak + 'x Streak! ' : ''}+${points}`, 'good');
  }

  state.score += points;
  state.correct++;
  scoreDisplay.textContent = state.score;
  updateStreak();

  // Green slot animation
  const slots = wordSlotsEl.querySelectorAll('.slot');
  slots.forEach(slot => slot.classList.add('correct'));

  // Wheel success glow
  wheel.classList.add('success');
  setTimeout(() => wheel.classList.remove('success'), 500);

  clearTimer();
  clearSelection();

  setTimeout(() => {
    state.round++;
    const total = Math.min(state.puzzles.length, cfg.rounds);
    if (state.round >= total) {
      endGame();
    } else {
      loadRound();
    }
  }, 600);
}

function handleWrong(word) {
  state.streak = 0;
  updateStreak();
  showFeedback(`✗ Not a word`, 'bad');

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

  // Force reflow
  timerBar.getBoundingClientRect();
  timerBar.style.transition = `width ${seconds}s linear`;
  timerBar.style.width = '0%';

  state.timerInterval = setInterval(() => {
    state.timerSec--;
    if (state.timerSec <= 8) timerBar.classList.add('warning');
    if (state.timerSec <= 0) {
      clearTimer();
      showFeedback('⏱ Time\'s up!', 'bad');
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
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

// ─── CONTROLS ─────────────────────────────────────────────────────────────────
document.getElementById('btn-clear').addEventListener('pointerdown', e => {
  e.preventDefault();
  clearSelection();
});

document.getElementById('btn-shuffle').addEventListener('pointerdown', e => {
  e.preventDefault();
  shuffleWheel();
});

document.getElementById('btn-hint').addEventListener('pointerdown', e => {
  e.preventDefault();
  useHint();
});

document.getElementById('btn-back').addEventListener('pointerdown', e => {
  e.preventDefault();
  clearTimer();
  showScreen('difficulty');
});

function shuffleWheel() {
  const puzzle  = state.currentPuzzle;
  const letters = [...puzzle.letters];
  // Shuffle but keep the target word letters in the array
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  clearSelection();
  buildWheel(letters);
  requestAnimationFrame(() => recalcWheelGeometry());
}

function useHint() {
  const cfg  = DIFFICULTY_CONFIG[state.difficulty];
  const word = state.currentPuzzle.word;

  // Deduct points
  state.score = Math.max(0, state.score - cfg.hintCost);
  scoreDisplay.textContent = state.score;
  state.hintsUsed++;

  // Highlight first letter of target word
  const targetLetters = word.split('');
  const firstLetter   = targetLetters[0];

  // Clear previous hints
  state.tiles.forEach(t => t.el.classList.remove('hint-tile'));

  // Find tiles matching the first letter and highlight them
  const matchingTiles = state.tiles.filter(t => t.letter === firstLetter);
  matchingTiles.forEach(t => {
    t.el.classList.add('hint-tile');
    state.hintIndices.push(t.index);
  });

  showFeedback(`Hint: starts with "${firstLetter}" (-${cfg.hintCost}pts)`, 'info');
  setTimeout(() => {
    state.tiles.forEach(t => t.el.classList.remove('hint-tile'));
  }, 2000);
}

// ─── PROGRESS RING ────────────────────────────────────────────────────────────
function updateProgress(current, total) {
  const circumference = 125.66; // 2π × 20
  const pct    = total > 0 ? current / total : 0;
  const offset = circumference * (1 - pct);
  progressCircle.style.strokeDashoffset = offset;
}

// ─── STREAK DISPLAY ───────────────────────────────────────────────────────────
function updateStreak() {
  if (state.streak >= 2) {
    streakEl.textContent = `🔥 ${state.streak}x Streak`;
  } else {
    streakEl.textContent = '';
  }
}

// ─── FEEDBACK BANNER ─────────────────────────────────────────────────────────
function showFeedback(msg, type) {
  if (state.feedbackTimeout) clearTimeout(state.feedbackTimeout);
  feedbackBanner.textContent = msg;
  feedbackBanner.className   = `feedback-banner show ${type}`;
  state.feedbackTimeout = setTimeout(() => {
    feedbackBanner.classList.remove('show');
  }, 1800);
}

// ─── END GAME ─────────────────────────────────────────────────────────────────
function endGame() {
  clearTimer();
  const cfg   = DIFFICULTY_CONFIG[state.difficulty];
  const total = Math.min(state.puzzles.length, cfg.rounds);

  if (state.difficulty === 'daily') {
    showDailyResult();
  } else {
    showComplete(total);
  }
}

function showComplete(total) {
  document.getElementById('complete-title').textContent = 'Round Complete!';
  document.getElementById('final-score').textContent    = state.score;

  const statsGrid = document.getElementById('stats-grid');
  statsGrid.innerHTML = `
    <div class="stat-card"><div class="stat-val">${state.correct}/${total}</div><div class="stat-lbl">CORRECT</div></div>
    <div class="stat-card"><div class="stat-val">${state.bestStreak}</div><div class="stat-lbl">BEST STREAK</div></div>
    <div class="stat-card"><div class="stat-val">${state.hintsUsed}</div><div class="stat-lbl">HINTS USED</div></div>
    <div class="stat-card"><div class="stat-val">${state.speedBonuses}</div><div class="stat-lbl">SPEED BONUSES</div></div>
  `;

  showScreen('complete');
}

function showDailyResult() {
  const today = new Date();
  document.getElementById('daily-date').textContent =
    today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('daily-score').textContent = state.score;

  // Build share text
  const puzzle   = state.currentPuzzle;
  const emojiRow = state.correct === 1 ? '🟢' : '🔴';
  const shareStr = `WordCircle Daily — ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}\n${emojiRow} Score: ${state.score}\n🔥 Streak: ${state.bestStreak}\nPlay at WordCircle`;
  document.getElementById('share-text-box').textContent = shareStr;

  showScreen('dailyResult');
}

// ─── COMPLETE SCREEN BUTTONS ──────────────────────────────────────────────────
document.getElementById('btn-play-again').addEventListener('pointerdown', e => {
  e.preventDefault();
  startGame(state.difficulty);
});
document.getElementById('btn-menu').addEventListener('pointerdown', e => {
  e.preventDefault();
  showScreen('difficulty');
});
document.getElementById('btn-daily-menu').addEventListener('pointerdown', e => {
  e.preventDefault();
  showScreen('difficulty');
});
document.getElementById('btn-copy-share').addEventListener('pointerdown', e => {
  e.preventDefault();
  const txt = document.getElementById('share-text-box').textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(txt).then(() => {
      showFeedback('Copied to clipboard!', 'good');
    });
  }
});

// ─── RESIZE HANDLER ───────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  if (screens.game.classList.contains('active')) {
    recalcWheelGeometry();
    const wr = wheelWrapper.getBoundingClientRect();
    trailCanvas.width  = wr.width;
    trailCanvas.height = wr.height;
  }
});
