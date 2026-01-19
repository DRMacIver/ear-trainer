/**
 * Relative Frequency Exercise
 *
 * A reference tone plays with its frequency displayed. Then a target tone plays.
 * The user must pinpoint the target frequency on a log scale, using the
 * reference as a guide.
 *
 * This is an easier version of Frequency Range because you have a known
 * reference point to compare against.
 */

import { playFrequency } from "../audio.js";
import { loadDifficulty, saveDifficulty } from "../lib/storage.js";

const MIN_FREQ = 128;
const MAX_FREQ = 1024;
const LOG_MIN = Math.log2(MIN_FREQ);
const LOG_MAX = Math.log2(MAX_FREQ);
const LOG_RANGE = LOG_MAX - LOG_MIN;

const NOTE_DURATION = 0.6;
const NOTE_GAP = 0.4;
const AUTO_ADVANCE_DELAY = 1000;

// Adaptive difficulty parameters
const INITIAL_BAR_WIDTH = 1.0; // 1 octave
const MIN_BAR_WIDTH = 0.1; // ~1.07:1 ratio (very hard)
const MAX_BAR_WIDTH = 1.0; // 2:1 ratio (1 octave)
const WARMUP_ROUNDS = 5;
const TARGET_SUCCESS_RATE = 0.85;
const DECAY_FACTOR = 0.97;
const MAX_SHRINK_RATE = 0.9;
const MAX_GROW_RATE = 1.2;

interface HistoryMarker {
  frequency: number;
  logPos: number;
  age: number;
  result: "correct" | "low" | "high";
  guessPosition: number;
}

interface ExerciseState {
  referenceFrequency: number;
  targetFrequency: number;
  selectedPosition: number;
  hasAnswered: boolean;
  wasCorrect: boolean | null;
  barWidth: number;
  totalCorrect: number;
  totalAttempts: number;
  streak: number;
  history: HistoryMarker[];
  inputEnabled: boolean;
  isDragging: boolean;
}

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

function freqToLogPosition(freq: number): number {
  return (Math.log2(freq) - LOG_MIN) / LOG_RANGE;
}

function logPositionToFreq(pos: number): number {
  return Math.pow(2, pos * LOG_RANGE + LOG_MIN);
}

function getBarWidthPercent(): number {
  return (state.barWidth / LOG_RANGE) * 100;
}

/**
 * Pick a random frequency uniform in log space.
 */
function pickRandomFrequency(): number {
  const logPos = Math.random();
  return logPositionToFreq(logPos);
}

/**
 * Generate a reference and target frequency pair.
 */
function generateRound(): { reference: number; target: number } {
  const reference = pickRandomFrequency();
  const target = pickRandomFrequency();
  return { reference, target };
}

function initExercise(): void {
  const savedBarWidth = loadDifficulty("relative-frequency", INITIAL_BAR_WIDTH);
  const barWidth = Math.max(
    MIN_BAR_WIDTH,
    Math.min(MAX_BAR_WIDTH, savedBarWidth)
  );

  state = {
    referenceFrequency: 0,
    targetFrequency: 0,
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
  const { reference, target } = generateRound();
  state.referenceFrequency = reference;
  state.targetFrequency = target;
  state.hasAnswered = false;
  state.wasCorrect = null;
  state.inputEnabled = false;
}

function getResult(): "correct" | "low" | "high" {
  const barHalfWidth = state.barWidth / 2 / LOG_RANGE;
  const freqLogPos = freqToLogPosition(state.targetFrequency);
  const minPos = state.selectedPosition - barHalfWidth;
  const maxPos = state.selectedPosition + barHalfWidth;

  if (freqLogPos >= minPos && freqLogPos <= maxPos) {
    return "correct";
  } else if (freqLogPos < minPos) {
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
      error: Math.abs(h.guessPosition - h.logPos) * LOG_RANGE,
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
  const result = getResult();
  state.wasCorrect = result === "correct";
  state.totalAttempts++;

  state.history.unshift({
    frequency: state.targetFrequency,
    logPos: freqToLogPosition(state.targetFrequency),
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
  saveDifficulty("relative-frequency", state.barWidth);

  render();
  setTimeout(advanceToNext, AUTO_ADVANCE_DELAY);
}

async function advanceToNext(): Promise<void> {
  setupNextRound();
  render();
  await playBothTones();
  state.inputEnabled = true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function playBothTones(): Promise<void> {
  await playFrequency(state.referenceFrequency, { duration: NOTE_DURATION });
  await sleep(NOTE_GAP * 1000);
  await playFrequency(state.targetFrequency, { duration: NOTE_DURATION });
  state.inputEnabled = true;
}

function formatFrequency(freq: number): string {
  return freq >= 1000
    ? `${(freq / 1000).toFixed(2)}kHz`
    : `${Math.round(freq)}Hz`;
}

function render(): void {
  const app = document.getElementById("app")!;

  const barWidthPct = getBarWidthPercent();
  const barLeft = state.selectedPosition * 100 - barWidthPct / 2;

  const barHalfWidth = state.barWidth / 2 / LOG_RANGE;
  const minFreq = logPositionToFreq(
    Math.max(0, state.selectedPosition - barHalfWidth)
  );
  const maxFreq = logPositionToFreq(
    Math.min(1, state.selectedPosition + barHalfWidth)
  );

  const refPosition = freqToLogPosition(state.referenceFrequency) * 100;

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Relative Frequency</h1>
    <p>Reference tone: <strong>${formatFrequency(state.referenceFrequency)}</strong>. Where is the second tone?</p>
    <p>Press <strong>Space</strong> to check, <strong>R</strong> to replay.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
        ${!state.hasAnswered ? `<button class="check-button" id="submit-btn">Submit</button>` : ""}
      </div>

      <div class="freq-scale-container">
        <div class="freq-scale" id="freq-scale">
          <div class="freq-bar" id="freq-bar" style="left: ${barLeft}%; width: ${barWidthPct}%"></div>
          <div class="reference-marker" style="left: ${refPosition}%"></div>
          ${renderHistoryMarkers()}
          ${state.hasAnswered ? `<div class="freq-marker current" style="left: ${freqToLogPosition(state.targetFrequency) * 100}%"></div>` : ""}
        </div>
        <div class="freq-labels">
          <span>128Hz</span>
          <span>256Hz</span>
          <span>512Hz</span>
          <span>1024Hz</span>
        </div>
      </div>

      <div class="freq-info">
        <span>Your range: ${formatFrequency(minFreq)} - ${formatFrequency(maxFreq)}</span>
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
        m.result === "correct"
          ? "correct"
          : m.result === "low"
            ? "low"
            : "high";
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

  const freqStr = formatFrequency(state.targetFrequency);
  if (state.wasCorrect) {
    feedback.className = "feedback success fade-out";
    feedback.textContent = `Correct! The frequency was ${freqStr}.`;
  } else {
    feedback.className = "feedback error fade-out";
    feedback.textContent = `Wrong! The frequency was ${freqStr}.`;
  }
}

function setupEventListeners(): void {
  const playBtn = document.getElementById("play-btn");
  playBtn?.addEventListener("click", () => {
    if (!state.hasAnswered) {
      playBothTones();
    }
  });

  const submitBtn = document.getElementById("submit-btn");
  submitBtn?.addEventListener("click", handleSubmit);

  const scale = document.getElementById("freq-scale");
  const bar = document.getElementById("freq-bar");

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

      const barHalfWidthLog = state.barWidth / 2 / LOG_RANGE;
      const minFreq = logPositionToFreq(
        Math.max(0, state.selectedPosition - barHalfWidthLog)
      );
      const maxFreq = logPositionToFreq(
        Math.min(1, state.selectedPosition + barHalfWidthLog)
      );
      const freqInfo = document.querySelector(".freq-info span");
      if (freqInfo) {
        freqInfo.textContent = `Your range: ${formatFrequency(minFreq)} - ${formatFrequency(maxFreq)}`;
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
        playBothTones();
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

export async function renderRelativeFrequency(): Promise<void> {
  initExercise();
  render();
  await playBothTones();
  state.inputEnabled = true;
}
