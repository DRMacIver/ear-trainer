/**
 * Frequency Range Exercise
 *
 * A sound plays between 128Hz and 1024Hz. The user places a range bar
 * on a log scale to estimate where the frequency is. After answering,
 * the true frequency is shown. Past frequencies fade over time.
 *
 * Difficulty adapts dynamically: the bar width is set so that 85% of
 * historical guesses (with exponential decay weighting) would have been
 * correct. First 5 rounds use a fixed 2:1 ratio (1 octave) to gather data.
 */

import { playFrequency } from "../audio.js";
import { loadDifficulty, saveDifficulty } from "../lib/storage.js";

const MIN_FREQ = 128;
const MAX_FREQ = 1024;
const LOG_MIN = Math.log2(MIN_FREQ); // 7
const LOG_MAX = Math.log2(MAX_FREQ); // 10
const LOG_RANGE = LOG_MAX - LOG_MIN; // 3

const NOTE_DURATION = 0.8;

// Adaptive difficulty parameters
const INITIAL_BAR_WIDTH = 1.0; // 1 octave = 2:1 ratio
const MIN_BAR_WIDTH = 0.1; // Minimum ~1.07:1 ratio (very hard)
const MAX_BAR_WIDTH = 1.0; // Maximum 2:1 ratio (1 octave)
const WARMUP_ROUNDS = 5; // Use fixed width for first N rounds
const TARGET_SUCCESS_RATE = 0.85; // Aim for 85% success
const DECAY_FACTOR = 0.97; // Weight decay per round (gradual)
const MAX_SHRINK_RATE = 0.9; // Can shrink by at most 10% per round
const MAX_GROW_RATE = 1.2; // Can grow by at most 20% per round

interface HistoryMarker {
  frequency: number;
  logPos: number; // 0-1 position on scale
  age: number; // How many rounds ago (0 = current)
  result: 'correct' | 'low' | 'high'; // Whether freq was within range, below it, or above it
  guessPosition: number; // Where the user's bar was centered (0-1)
}

interface ExerciseState {
  // Current frequency being tested
  currentFrequency: number;
  // User's selected position (center of bar, 0-1 on log scale)
  selectedPosition: number;
  // Whether user has answered
  hasAnswered: boolean;
  // Was the answer correct (frequency within bar)
  wasCorrect: boolean | null;
  // Current bar width in octaves (log2 units)
  barWidth: number;
  // Stats
  totalCorrect: number;
  totalAttempts: number;
  streak: number;
  // History of played frequencies (kept longer for adaptive difficulty)
  history: HistoryMarker[];
  // Whether input is enabled
  inputEnabled: boolean;
  // Whether currently dragging
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

function getBarWidth(): number {
  return state.barWidth;
}

function getBarWidthPercent(): number {
  return (getBarWidth() / LOG_RANGE) * 100;
}

function pickRandomFrequency(): number {
  // Random position on log scale, then convert to frequency
  const logPos = Math.random();
  return logPositionToFreq(logPos);
}

function initExercise(): void {
  // Load saved bar width, or use initial value
  const savedBarWidth = loadDifficulty("frequency-range", INITIAL_BAR_WIDTH);
  // Clamp to valid range
  const barWidth = Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, savedBarWidth));

  state = {
    currentFrequency: pickRandomFrequency(),
    selectedPosition: 0.5,
    hasAnswered: false,
    wasCorrect: null,
    barWidth,
    totalCorrect: 0,
    totalAttempts: 0,
    streak: 0,
    history: [], // Fresh history each session (adaptive calc restarts)
    inputEnabled: false,
    isDragging: false,
  };
}

const AUTO_ADVANCE_DELAY = 1000;

function getFrequencyResult(): 'correct' | 'low' | 'high' {
  const barHalfWidth = getBarWidth() / 2 / LOG_RANGE;
  const freqLogPos = freqToLogPosition(state.currentFrequency);
  const minPos = state.selectedPosition - barHalfWidth;
  const maxPos = state.selectedPosition + barHalfWidth;

  if (freqLogPos >= minPos && freqLogPos <= maxPos) {
    return 'correct';
  } else if (freqLogPos < minPos) {
    return 'low'; // Actual frequency was lower than the guess range
  } else {
    return 'high'; // Actual frequency was higher than the guess range
  }
}

/**
 * Calculate the optimal bar width based on historical performance.
 * Finds the width such that TARGET_SUCCESS_RATE of weighted historical
 * guesses would have been correct.
 */
function calculateAdaptiveBarWidth(): number {
  // Don't adapt during warmup period
  if (state.history.length < WARMUP_ROUNDS) {
    return INITIAL_BAR_WIDTH;
  }

  // Calculate error (distance from guess center to actual) for each historical entry
  // Error is in log position units (0-1 scale), convert to octaves
  const weightedErrors: { error: number; weight: number }[] = state.history.map((h, index) => ({
    // Error in octaves: how far the actual frequency was from the guess center
    error: Math.abs(h.guessPosition - h.logPos) * LOG_RANGE,
    // Exponential decay: older entries (higher index) get less weight
    weight: Math.pow(DECAY_FACTOR, index),
  }));

  // Sort by error (smallest first)
  weightedErrors.sort((a, b) => a.error - b.error);

  // Find the error at the target percentile (weighted)
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

  // The bar width needed is 2x the error (error is distance from center,
  // bar extends that distance in both directions)
  const targetWidth = 2 * percentileError;

  // Apply rate limits: can't shrink more than 10% or grow more than 20%
  const currentWidth = state.barWidth;
  const minNewWidth = currentWidth * MAX_SHRINK_RATE;
  const maxNewWidth = currentWidth * MAX_GROW_RATE;

  // Clamp to rate limits, then to absolute bounds
  let newWidth = Math.max(minNewWidth, Math.min(maxNewWidth, targetWidth));
  newWidth = Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, newWidth));

  return newWidth;
}

function handleSubmit(): void {
  if (state.hasAnswered || !state.inputEnabled) return;

  state.hasAnswered = true;
  const result = getFrequencyResult();
  state.wasCorrect = result === 'correct';
  state.totalAttempts++;

  // Add to history (newest first)
  state.history.unshift({
    frequency: state.currentFrequency,
    logPos: freqToLogPosition(state.currentFrequency),
    age: 0,
    result,
    guessPosition: state.selectedPosition,
  });

  // Age existing markers (new entry starts at 0, shown as "current" marker)
  state.history = state.history.map((m) => ({
    ...m,
    age: m.age + (m.age > 0 ? 1 : 0), // Don't age the newest entry yet
  }));

  if (state.wasCorrect) {
    state.totalCorrect++;
    state.streak++;
  } else {
    state.streak = 0;
  }

  // Apply adaptive difficulty adjustment
  state.barWidth = calculateAdaptiveBarWidth();
  saveDifficulty("frequency-range", state.barWidth);

  render();

  // Auto-advance after delay
  setTimeout(advanceToNext, AUTO_ADVANCE_DELAY);
}

function advanceToNext(): void {
  // Increment ages so the previous answer becomes visible as a history marker
  state.history = state.history.map((m) => ({
    ...m,
    age: m.age + 1,
  }));

  state.currentFrequency = pickRandomFrequency();
  state.hasAnswered = false;
  state.wasCorrect = null;
  state.inputEnabled = false;

  render();
  playCurrentFrequency();
}

async function playCurrentFrequency(): Promise<void> {
  await playFrequency(state.currentFrequency, { duration: NOTE_DURATION });
  state.inputEnabled = true;
}

function formatFrequency(freq: number): string {
  return freq >= 1000 ? `${(freq / 1000).toFixed(2)}kHz` : `${Math.round(freq)}Hz`;
}

function render(): void {
  const app = document.getElementById("app")!;

  const barWidthPct = getBarWidthPercent();
  const barLeft = (state.selectedPosition * 100) - (barWidthPct / 2);

  // Calculate selected range in Hz
  const barHalfWidth = getBarWidth() / 2 / LOG_RANGE;
  const minFreq = logPositionToFreq(Math.max(0, state.selectedPosition - barHalfWidth));
  const maxFreq = logPositionToFreq(Math.min(1, state.selectedPosition + barHalfWidth));

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Frequency Range</h1>
    <p>A tone plays. Drag the bar to where you think the frequency is. Press <strong>Space</strong> to check, <strong>R</strong> to replay.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
        ${!state.hasAnswered ? `<button class="check-button" id="submit-btn">Submit</button>` : ''}
      </div>

      <div class="freq-scale-container">
        <div class="freq-scale" id="freq-scale">
          <div class="freq-bar" id="freq-bar" style="left: ${barLeft}%; width: ${barWidthPct}%"></div>
          ${renderHistoryMarkers()}
          ${state.hasAnswered ? `<div class="freq-marker current" style="left: ${freqToLogPosition(state.currentFrequency) * 100}%"></div>` : ''}
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
    .filter((m) => m.age > 0 && m.age <= 10) // Show last 10, skip current
    .map((m) => {
      const opacity = Math.max(0.1, 1 - (m.age / 10));
      const colorClass = m.result === 'correct' ? 'correct' : m.result === 'low' ? 'low' : 'high';
      return `<div class="freq-marker history ${colorClass}" style="left: ${m.logPos * 100}%; opacity: ${opacity}"></div>`;
    })
    .join('');
}

function renderFeedback(): void {
  const feedback = document.getElementById("feedback")!;

  if (!state.hasAnswered) {
    feedback.className = "";
    feedback.textContent = "";
    return;
  }

  const freqStr = formatFrequency(state.currentFrequency);
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
      playCurrentFrequency();
    }
  });

  const submitBtn = document.getElementById("submit-btn");
  submitBtn?.addEventListener("click", handleSubmit);

  // Set up dragging on the scale
  const scale = document.getElementById("freq-scale");
  const bar = document.getElementById("freq-bar");

  if (scale && bar) {
    const updatePosition = (clientX: number) => {
      if (state.hasAnswered) return;
      const rect = scale.getBoundingClientRect();
      const x = clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));

      // Clamp so bar doesn't go off edges
      const barHalfWidth = getBarWidthPercent() / 200;
      state.selectedPosition = Math.max(barHalfWidth, Math.min(1 - barHalfWidth, pct));

      // Update bar position without full re-render
      const barWidthPct = getBarWidthPercent();
      bar.style.left = `${(state.selectedPosition * 100) - (barWidthPct / 2)}%`;

      // Update freq info
      const barHalfWidthLog = getBarWidth() / 2 / LOG_RANGE;
      const minFreq = logPositionToFreq(Math.max(0, state.selectedPosition - barHalfWidthLog));
      const maxFreq = logPositionToFreq(Math.min(1, state.selectedPosition + barHalfWidthLog));
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

    // Touch support
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

  // Keyboard handler
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
        playCurrentFrequency();
      }
    } else if (e.key === "ArrowLeft" && !state.hasAnswered) {
      e.preventDefault();
      const step = 0.02;
      const barHalfWidth = getBarWidthPercent() / 200;
      state.selectedPosition = Math.max(barHalfWidth, state.selectedPosition - step);
      render();
    } else if (e.key === "ArrowRight" && !state.hasAnswered) {
      e.preventDefault();
      const step = 0.02;
      const barHalfWidth = getBarWidthPercent() / 200;
      state.selectedPosition = Math.min(1 - barHalfWidth, state.selectedPosition + step);
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

export async function renderFrequencyRange(): Promise<void> {
  initExercise();
  render();
  await playCurrentFrequency();
  state.inputEnabled = true;
}
