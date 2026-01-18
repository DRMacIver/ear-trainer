/**
 * Ratio Range Exercise
 *
 * Two tones play and the user places a range bar on a ratio scale to estimate
 * the ratio between them. Similar to frequency-range but for ratios.
 *
 * The ratio is displayed on a log scale from 1.0 to 3.0 (about 1.5 octaves).
 * Difficulty adapts by narrowing the bar width.
 */

import { playFrequency } from "../audio.js";
import { loadDifficulty, saveDifficulty } from "../lib/storage.js";

const MIN_FREQ = 128;
const MAX_FREQ = 1024;
const LOG_MIN = Math.log2(MIN_FREQ);

const NOTE_DURATION = 0.6;
const NOTE_GAP = 0.3;
const AUTO_ADVANCE_DELAY = 1000;

// Ratio scale: 1.0 to 3.0 (log scale)
const MIN_RATIO = 1.0;
const MAX_RATIO = 3.0;
const RATIO_LOG_MIN = Math.log2(MIN_RATIO); // 0
const RATIO_LOG_MAX = Math.log2(MAX_RATIO); // ~1.585
const RATIO_LOG_RANGE = RATIO_LOG_MAX - RATIO_LOG_MIN;

// Adaptive difficulty parameters (similar to frequency-range)
const INITIAL_BAR_WIDTH = 0.4; // In log2 ratio units (~1.32x range)
const MIN_BAR_WIDTH = 0.05; // Very narrow (~1.035x range)
const MAX_BAR_WIDTH = 0.4; // Maximum width
const WARMUP_ROUNDS = 5;
const TARGET_SUCCESS_RATE = 0.85;
const DECAY_FACTOR = 0.97;
const MAX_SHRINK_RATE = 0.9;
const MAX_GROW_RATE = 1.2;

interface HistoryMarker {
  ratio: number;
  logPos: number; // 0-1 position on scale
  age: number;
  result: "correct" | "low" | "high";
  guessPosition: number;
}

interface ExerciseState {
  frequencies: [number, number];
  currentRatio: number;
  selectedPosition: number; // 0-1 on the ratio scale
  hasAnswered: boolean;
  wasCorrect: boolean | null;
  barWidth: number; // In log2 ratio units
  totalCorrect: number;
  totalAttempts: number;
  streak: number;
  history: HistoryMarker[];
  inputEnabled: boolean;
  isDragging: boolean;
}

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

function ratioToLogPosition(ratio: number): number {
  return (Math.log2(ratio) - RATIO_LOG_MIN) / RATIO_LOG_RANGE;
}

function logPositionToRatio(pos: number): number {
  return Math.pow(2, pos * RATIO_LOG_RANGE + RATIO_LOG_MIN);
}

function getBarWidth(): number {
  return state.barWidth;
}

function getBarWidthPercent(): number {
  return (getBarWidth() / RATIO_LOG_RANGE) * 100;
}

/**
 * Generate a pair of frequencies with a ratio in our range.
 * Randomly orders them (higher or lower first).
 */
function generateFrequencyPair(): {
  frequencies: [number, number];
  ratio: number;
} {
  // Pick a random ratio in the valid range
  const ratioLogPos = Math.random();
  const ratio = logPositionToRatio(ratioLogPos);

  // Pick a base frequency such that both frequencies fit in range
  const maxLower = MAX_FREQ / ratio;
  const logMinLower = LOG_MIN;
  const logMaxLower = Math.log2(Math.min(maxLower, MAX_FREQ));

  const logLower = logMinLower + Math.random() * (logMaxLower - logMinLower);
  const lowerFreq = Math.pow(2, logLower);
  const higherFreq = lowerFreq * ratio;

  // Clamp to valid range
  const clampedLower = Math.max(MIN_FREQ, Math.min(MAX_FREQ, lowerFreq));
  const clampedHigher = Math.max(MIN_FREQ, Math.min(MAX_FREQ, higherFreq));

  // Recalculate actual ratio
  const actualRatio = clampedHigher / clampedLower;

  // Randomly decide order
  const higherFirst = Math.random() < 0.5;
  const frequencies: [number, number] = higherFirst
    ? [clampedHigher, clampedLower]
    : [clampedLower, clampedHigher];

  return { frequencies, ratio: actualRatio };
}

function initExercise(): void {
  const savedBarWidth = loadDifficulty("ratio-range", INITIAL_BAR_WIDTH);
  const barWidth = Math.max(
    MIN_BAR_WIDTH,
    Math.min(MAX_BAR_WIDTH, savedBarWidth)
  );

  state = {
    frequencies: [0, 0],
    currentRatio: 1,
    selectedPosition: 0.5,
    hasAnswered: false,
    wasCorrect: null,
    barWidth,
    totalCorrect: 0,
    totalAttempts: 0,
    streak: 0,
    history: [],
    inputEnabled: false,
    isDragging: false,
  };

  setupNextRound();
}

function setupNextRound(): void {
  const { frequencies, ratio } = generateFrequencyPair();
  state.frequencies = frequencies;
  state.currentRatio = ratio;
  state.hasAnswered = false;
  state.wasCorrect = null;
  state.inputEnabled = false;
}

function getRatioResult(): "correct" | "low" | "high" {
  const barHalfWidth = getBarWidth() / 2 / RATIO_LOG_RANGE;
  const ratioLogPos = ratioToLogPosition(state.currentRatio);
  const minPos = state.selectedPosition - barHalfWidth;
  const maxPos = state.selectedPosition + barHalfWidth;

  if (ratioLogPos >= minPos && ratioLogPos <= maxPos) {
    return "correct";
  } else if (ratioLogPos < minPos) {
    return "low";
  } else {
    return "high";
  }
}

function calculateAdaptiveBarWidth(): number {
  if (state.history.length < WARMUP_ROUNDS) {
    return INITIAL_BAR_WIDTH;
  }

  const weightedErrors: { error: number; weight: number }[] = state.history.map(
    (h, index) => ({
      error: Math.abs(h.guessPosition - h.logPos) * RATIO_LOG_RANGE,
      weight: Math.pow(DECAY_FACTOR, index),
    })
  );

  weightedErrors.sort((a, b) => a.error - b.error);

  const totalWeight = weightedErrors.reduce((sum, e) => sum + e.weight, 0);
  const targetWeight = TARGET_SUCCESS_RATE * totalWeight;

  let cumulativeWeight = 0;
  let percentileError = 0;

  for (const entry of weightedErrors) {
    cumulativeWeight += entry.weight;
    percentileError = entry.error;
    if (cumulativeWeight >= targetWeight) {
      break;
    }
  }

  const targetWidth = 2 * percentileError;

  const currentWidth = state.barWidth;
  const minNewWidth = currentWidth * MAX_SHRINK_RATE;
  const maxNewWidth = currentWidth * MAX_GROW_RATE;

  let newWidth = Math.max(minNewWidth, Math.min(maxNewWidth, targetWidth));
  newWidth = Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, newWidth));

  return newWidth;
}

function handleSubmit(): void {
  if (state.hasAnswered || !state.inputEnabled) return;

  state.hasAnswered = true;
  const result = getRatioResult();
  state.wasCorrect = result === "correct";
  state.totalAttempts++;

  state.history.unshift({
    ratio: state.currentRatio,
    logPos: ratioToLogPosition(state.currentRatio),
    age: 0,
    result,
    guessPosition: state.selectedPosition,
  });

  state.history = state.history.map((m, i) => ({
    ...m,
    age: i,
  }));

  if (state.wasCorrect) {
    state.totalCorrect++;
    state.streak++;
  } else {
    state.streak = 0;
  }

  state.barWidth = calculateAdaptiveBarWidth();
  saveDifficulty("ratio-range", state.barWidth);

  render();
  setTimeout(advanceToNext, AUTO_ADVANCE_DELAY);
}

async function advanceToNext(): Promise<void> {
  setupNextRound();
  render();
  await playBothFrequencies();
  state.inputEnabled = true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function playBothFrequencies(): Promise<void> {
  await playFrequency(state.frequencies[0], { duration: NOTE_DURATION });
  await sleep(NOTE_GAP * 1000);
  await playFrequency(state.frequencies[1], { duration: NOTE_DURATION });
  state.inputEnabled = true;
}

function formatRatio(ratio: number): string {
  return ratio.toFixed(2) + ":1";
}

function render(): void {
  const app = document.getElementById("app")!;

  const barWidthPct = getBarWidthPercent();
  const barLeft = state.selectedPosition * 100 - barWidthPct / 2;

  const barHalfWidth = getBarWidth() / 2 / RATIO_LOG_RANGE;
  const minRatio = logPositionToRatio(
    Math.max(0, state.selectedPosition - barHalfWidth)
  );
  const maxRatio = logPositionToRatio(
    Math.min(1, state.selectedPosition + barHalfWidth)
  );

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Ratio Range</h1>
    <p>Two tones play. Drag the bar to estimate the ratio between them (higher ÷ lower).</p>
    <p>Press <strong>Space</strong> to check, <strong>R</strong> to replay.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
        ${!state.hasAnswered ? `<button class="check-button" id="submit-btn">Submit</button>` : ""}
      </div>

      <div class="freq-scale-container">
        <div class="freq-scale" id="ratio-scale">
          <div class="freq-bar" id="ratio-bar" style="left: ${barLeft}%; width: ${barWidthPct}%"></div>
          ${renderHistoryMarkers()}
          ${state.hasAnswered ? `<div class="freq-marker current" style="left: ${ratioToLogPosition(state.currentRatio) * 100}%"></div>` : ""}
        </div>
        <div class="freq-labels">
          <span>1.0</span>
          <span>1.5</span>
          <span>2.0</span>
          <span>2.5</span>
          <span>3.0</span>
        </div>
      </div>

      <div class="freq-info">
        <span>Your range: ${formatRatio(minRatio)} - ${formatRatio(maxRatio)}</span>
        <span class="freq-level">Range: ${Math.pow(2, state.barWidth).toFixed(2)}x</span>
      </div>

      <div id="feedback"></div>

      <div class="stats-row">
        <div class="stats correct-stat">
          <span class="stats-label">Right:</span>
          <span>${state.totalCorrect}</span>
        </div>
        <div class="stats wrong-stat">
          <span class="stats-label">Wrong:</span>
          <span>${state.totalAttempts - state.totalCorrect}</span>
        </div>
        <div class="stats streak-stat">
          <span class="stats-label">Streak:</span>
          <span>${state.streak}${state.streak >= 5 ? " \u{1F525}" : ""}</span>
        </div>
      </div>
    </div>
  `;

  renderFeedback();
  setupEventListeners();
}

function renderHistoryMarkers(): string {
  return state.history
    .filter((m) => m.age > 0 && m.age <= 10)
    .map((m) => {
      const opacity = Math.max(0.1, 1 - m.age / 10);
      const colorClass =
        m.result === "correct" ? "correct" : m.result === "low" ? "low" : "high";
      return `<div class="freq-marker history ${colorClass}" style="left: ${m.logPos * 100}%; opacity: ${opacity}"></div>`;
    })
    .join("");
}

function renderFeedback(): void {
  const feedback = document.getElementById("feedback")!;

  if (!state.hasAnswered) {
    feedback.className = "";
    feedback.textContent = "";
    return;
  }

  const ratioStr = formatRatio(state.currentRatio);
  if (state.wasCorrect) {
    feedback.className = "feedback success fade-out";
    feedback.textContent = `Correct! The ratio was ${ratioStr}.`;
  } else {
    feedback.className = "feedback error fade-out";
    feedback.textContent = `Wrong! The ratio was ${ratioStr}.`;
  }
}

function setupEventListeners(): void {
  const playBtn = document.getElementById("play-btn");
  playBtn?.addEventListener("click", () => {
    if (!state.hasAnswered) {
      playBothFrequencies();
    }
  });

  const submitBtn = document.getElementById("submit-btn");
  submitBtn?.addEventListener("click", handleSubmit);

  const scale = document.getElementById("ratio-scale");
  const bar = document.getElementById("ratio-bar");

  if (scale && bar) {
    const updatePosition = (clientX: number) => {
      if (state.hasAnswered) return;
      const rect = scale.getBoundingClientRect();
      const x = clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));

      const barHalfWidth = getBarWidthPercent() / 200;
      state.selectedPosition = Math.max(
        barHalfWidth,
        Math.min(1 - barHalfWidth, pct)
      );

      const barWidthPct = getBarWidthPercent();
      bar.style.left = `${state.selectedPosition * 100 - barWidthPct / 2}%`;

      const barHalfWidthLog = getBarWidth() / 2 / RATIO_LOG_RANGE;
      const minRatio = logPositionToRatio(
        Math.max(0, state.selectedPosition - barHalfWidthLog)
      );
      const maxRatio = logPositionToRatio(
        Math.min(1, state.selectedPosition + barHalfWidthLog)
      );
      const freqInfo = document.querySelector(".freq-info span");
      if (freqInfo) {
        freqInfo.textContent = `Your range: ${formatRatio(minRatio)} - ${formatRatio(maxRatio)}`;
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (state.hasAnswered) return;
      state.isDragging = true;
      updatePosition(e.clientX);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!state.isDragging) return;
      updatePosition(e.clientX);
    };

    const onMouseUp = () => {
      state.isDragging = false;
    };

    scale.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    scale.addEventListener("touchstart", (e) => {
      if (state.hasAnswered) return;
      state.isDragging = true;
      updatePosition(e.touches[0].clientX);
    });
    document.addEventListener("touchmove", (e) => {
      if (!state.isDragging) return;
      updatePosition(e.touches[0].clientX);
    });
    document.addEventListener("touchend", onMouseUp);
  }

  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
  }

  keyboardHandler = (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!state.hasAnswered) {
        handleSubmit();
      }
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      if (!state.hasAnswered) {
        playBothFrequencies();
      }
    } else if (e.key === "ArrowLeft" && !state.hasAnswered) {
      e.preventDefault();
      const step = 0.02;
      const barHalfWidth = getBarWidthPercent() / 200;
      state.selectedPosition = Math.max(
        barHalfWidth,
        state.selectedPosition - step
      );
      render();
    } else if (e.key === "ArrowRight" && !state.hasAnswered) {
      e.preventDefault();
      const step = 0.02;
      const barHalfWidth = getBarWidthPercent() / 200;
      state.selectedPosition = Math.min(
        1 - barHalfWidth,
        state.selectedPosition + step
      );
      render();
    }
  };

  document.addEventListener("keydown", keyboardHandler);

  const cleanupOnNavigate = () => {
    if (keyboardHandler) {
      document.removeEventListener("keydown", keyboardHandler);
      keyboardHandler = null;
    }
    window.removeEventListener("hashchange", cleanupOnNavigate);
  };
  window.addEventListener("hashchange", cleanupOnNavigate);
}

export async function renderRatioRange(): Promise<void> {
  initExercise();
  render();
  await playBothFrequencies();
  state.inputEnabled = true;
}
