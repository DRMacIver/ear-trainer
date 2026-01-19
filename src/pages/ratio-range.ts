/**
 * Interval Range Exercise
 *
 * Two tones play and the user places a range bar on a semitone scale to estimate
 * the interval between them (second tone relative to first).
 *
 * The scale shows semitones from -19 to +19 (about 1.5 octaves each direction).
 * Positive = second tone is higher, negative = second tone is lower.
 * Difficulty adapts by narrowing the bar width.
 */

import { playFrequency } from "../audio.js";
import { loadDifficulty, saveDifficulty } from "../lib/storage.js";

const MIN_FREQ = 128;
const MAX_FREQ = 1024;
const LOG_MIN = Math.log2(MIN_FREQ);
const LOG_MAX = Math.log2(MAX_FREQ);

const NOTE_DURATION = 0.6;
const NOTE_GAP = 0.3;
const AUTO_ADVANCE_DELAY = 1000;

// Semitone scale: -19 to +19 semitones
const MIN_SEMITONES = -19;
const MAX_SEMITONES = 19;
const SEMITONE_RANGE = MAX_SEMITONES - MIN_SEMITONES; // 38

// Adaptive difficulty parameters
const INITIAL_BAR_WIDTH = 6; // In semitones
const MIN_BAR_WIDTH = 1; // 1 semitone (very hard)
const MAX_BAR_WIDTH = 6; // 6 semitones
const WARMUP_ROUNDS = 5;
const TARGET_SUCCESS_RATE = 0.85;
const DECAY_FACTOR = 0.97;
const MAX_SHRINK_RATE = 0.9;
const MAX_GROW_RATE = 1.2;

interface HistoryMarker {
  semitones: number;
  position: number; // 0-1 position on scale
  age: number;
  result: "correct" | "low" | "high";
  guessPosition: number;
}

interface ExerciseState {
  frequencies: [number, number];
  currentSemitones: number; // Interval in semitones (positive = second higher)
  selectedPosition: number; // 0-1 on the scale
  hasAnswered: boolean;
  wasCorrect: boolean | null;
  barWidth: number; // In semitones
  totalCorrect: number;
  totalAttempts: number;
  streak: number;
  history: HistoryMarker[];
  inputEnabled: boolean;
  isDragging: boolean;
}

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

function semitonesToPosition(semitones: number): number {
  return (semitones - MIN_SEMITONES) / SEMITONE_RANGE;
}

function positionToSemitones(pos: number): number {
  return pos * SEMITONE_RANGE + MIN_SEMITONES;
}

function getBarWidthPercent(): number {
  return (state.barWidth / SEMITONE_RANGE) * 100;
}

/**
 * Generate a pair of frequencies with an interval in our range.
 */
function generateFrequencyPair(): {
  frequencies: [number, number];
  semitones: number;
} {
  // Pick a random interval in semitones
  const semitones =
    MIN_SEMITONES + Math.random() * SEMITONE_RANGE;

  // Pick a first frequency such that both fit in range
  const intervalOctaves = semitones / 12;

  // First frequency constraints:
  // first must be in [MIN_FREQ, MAX_FREQ]
  // second = first * 2^(semitones/12) must also be in [MIN_FREQ, MAX_FREQ]
  let minFirstLog = LOG_MIN;
  let maxFirstLog = LOG_MAX;

  if (semitones > 0) {
    // Second will be higher, so first can't be too high
    maxFirstLog = Math.min(maxFirstLog, LOG_MAX - intervalOctaves);
  } else {
    // Second will be lower, so first can't be too low
    minFirstLog = Math.max(minFirstLog, LOG_MIN - intervalOctaves);
  }

  if (minFirstLog > maxFirstLog) {
    // Fallback: just use middle of range
    minFirstLog = (LOG_MIN + LOG_MAX) / 2 - 0.5;
    maxFirstLog = (LOG_MIN + LOG_MAX) / 2 + 0.5;
  }

  const firstLog = minFirstLog + Math.random() * (maxFirstLog - minFirstLog);
  const firstFreq = Math.pow(2, firstLog);
  const secondFreq = firstFreq * Math.pow(2, semitones / 12);

  // Clamp to valid range
  const clampedFirst = Math.max(MIN_FREQ, Math.min(MAX_FREQ, firstFreq));
  const clampedSecond = Math.max(MIN_FREQ, Math.min(MAX_FREQ, secondFreq));

  // Recalculate actual semitones
  const actualSemitones = 12 * Math.log2(clampedSecond / clampedFirst);

  return {
    frequencies: [clampedFirst, clampedSecond],
    semitones: actualSemitones,
  };
}

function initExercise(): void {
  const savedBarWidth = loadDifficulty("ratio-range", INITIAL_BAR_WIDTH);
  const barWidth = Math.max(
    MIN_BAR_WIDTH,
    Math.min(MAX_BAR_WIDTH, savedBarWidth)
  );

  state = {
    frequencies: [0, 0],
    currentSemitones: 0,
    selectedPosition: 0.5, // Start at 0 semitones
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
  const { frequencies, semitones } = generateFrequencyPair();
  state.frequencies = frequencies;
  state.currentSemitones = semitones;
  state.hasAnswered = false;
  state.wasCorrect = null;
  state.inputEnabled = false;
}

function getResult(): "correct" | "low" | "high" {
  const barHalfWidth = state.barWidth / 2 / SEMITONE_RANGE;
  const actualPos = semitonesToPosition(state.currentSemitones);
  const minPos = state.selectedPosition - barHalfWidth;
  const maxPos = state.selectedPosition + barHalfWidth;

  if (actualPos >= minPos && actualPos <= maxPos) {
    return "correct";
  } else if (actualPos < minPos) {
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
      // Error in semitones
      error: Math.abs(h.guessPosition - h.position) * SEMITONE_RANGE,
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
    semitones: state.currentSemitones,
    position: semitonesToPosition(state.currentSemitones),
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

function formatSemitones(semitones: number): string {
  const sign = semitones >= 0 ? "+" : "";
  return `${sign}${semitones.toFixed(1)} st`;
}

function render(): void {
  const app = document.getElementById("app")!;

  const barWidthPct = getBarWidthPercent();
  const barLeft = state.selectedPosition * 100 - barWidthPct / 2;

  const barHalfWidth = state.barWidth / 2 / SEMITONE_RANGE;
  const minSemitones = positionToSemitones(
    Math.max(0, state.selectedPosition - barHalfWidth)
  );
  const maxSemitones = positionToSemitones(
    Math.min(1, state.selectedPosition + barHalfWidth)
  );

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Interval Range</h1>
    <p>Two tones play. Estimate the interval from first to second (in semitones).</p>
    <p>Press <strong>Space</strong> to check, <strong>R</strong> to replay.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
        ${!state.hasAnswered ? `<button class="check-button" id="submit-btn">Submit</button>` : ""}
      </div>

      <div class="freq-scale-container">
        <div class="freq-scale" id="interval-scale">
          <div class="freq-bar" id="interval-bar" style="left: ${barLeft}%; width: ${barWidthPct}%"></div>
          <div class="scale-zero-line" style="left: 50%"></div>
          ${renderHistoryMarkers()}
          ${state.hasAnswered ? `<div class="freq-marker current" style="left: ${semitonesToPosition(state.currentSemitones) * 100}%"></div>` : ""}
        </div>
        <div class="freq-labels interval-labels">
          <span>-19</span>
          <span>-12</span>
          <span>0</span>
          <span>+12</span>
          <span>+19</span>
        </div>
      </div>

      <div class="freq-info">
        <span>Your range: ${formatSemitones(minSemitones)} to ${formatSemitones(maxSemitones)}</span>
        <span class="freq-level">Width: ${state.barWidth.toFixed(1)} st</span>
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
      return `<div class="freq-marker history ${colorClass}" style="left: ${m.position * 100}%; opacity: ${opacity}"></div>`;
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

  const semitoneStr = formatSemitones(state.currentSemitones);
  if (state.wasCorrect) {
    feedback.className = "feedback success fade-out";
    feedback.textContent = `Correct! The interval was ${semitoneStr}.`;
  } else {
    feedback.className = "feedback error fade-out";
    feedback.textContent = `Wrong! The interval was ${semitoneStr}.`;
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

  const scale = document.getElementById("interval-scale");
  const bar = document.getElementById("interval-bar");

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

      const barHalfWidthSt = state.barWidth / 2 / SEMITONE_RANGE;
      const minSemitones = positionToSemitones(
        Math.max(0, state.selectedPosition - barHalfWidthSt)
      );
      const maxSemitones = positionToSemitones(
        Math.min(1, state.selectedPosition + barHalfWidthSt)
      );
      const freqInfo = document.querySelector(".freq-info span");
      if (freqInfo) {
        freqInfo.textContent = `Your range: ${formatSemitones(minSemitones)} to ${formatSemitones(maxSemitones)}`;
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
