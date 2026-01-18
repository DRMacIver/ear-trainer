/**
 * Frequency Ratio Exercise
 *
 * Two tones play and the user must pick the ratio from a list.
 * The ratio is rounded to 1 decimal place, and the tones are adjusted
 * slightly to make the ratio exact.
 *
 * Notes can play in either order (higher or lower first).
 *
 * Difficulty adapts based on:
 * - Number of choices (2-5)
 * - How close together the ratio choices are
 */

import { playFrequency } from "../audio.js";
import { loadDifficulty, saveDifficulty } from "../lib/storage.js";

const MIN_FREQ = 128;
const MAX_FREQ = 1024;
const LOG_MIN = Math.log2(MIN_FREQ);

const NOTE_DURATION = 0.6;
const NOTE_GAP = 0.3;
const AUTO_ADVANCE_DELAY = 1000;

// Difficulty levels 1-8
const MIN_LEVEL = 1;
const MAX_LEVEL = 8;

// Number of choices at each level
const CHOICES_BY_LEVEL: Record<number, number> = {
  1: 2,
  2: 2,
  3: 3,
  4: 3,
  5: 4,
  6: 4,
  7: 5,
  8: 5,
};

// Minimum ratio difference between choices at each level
const RATIO_SEPARATION_BY_LEVEL: Record<number, number> = {
  1: 0.5, // Very different ratios (e.g., 1.5 vs 2.0)
  2: 0.4,
  3: 0.3,
  4: 0.25,
  5: 0.2,
  6: 0.15,
  7: 0.12,
  8: 0.1, // Close ratios (e.g., 1.5 vs 1.6)
};

// EMA-based difficulty adjustment
const INITIAL_EMA = 0.85;
const SMOOTHING_FACTOR = 0.05;
const PROMOTION_THRESHOLD = 0.92;
const DEMOTION_THRESHOLD = 0.7;

// Reasonable ratio range (avoiding very small or very large)
const MIN_RATIO = 1.1; // Just above unison
const MAX_RATIO = 2.5; // About 1.3 octaves

interface ExerciseState {
  frequencies: [number, number]; // [first played, second played]
  correctRatio: number;
  ratioChoices: number[];
  correctIndex: number;
  hasAnswered: boolean;
  wasCorrect: boolean | null;
  chosenIndex: number | null;
  level: number;
  ema: number;
  totalCorrect: number;
  totalAttempts: number;
  streak: number;
  inputEnabled: boolean;
}

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

/**
 * Round a ratio to 1 decimal place.
 */
function roundRatio(ratio: number): number {
  return Math.round(ratio * 10) / 10;
}

/**
 * Generate a pair of frequencies with an exact ratio (rounded to 1 decimal).
 * Returns frequencies in random order (higher or lower first).
 */
function generateFrequencyPair(): {
  frequencies: [number, number];
  ratio: number;
} {
  // Pick a random ratio between MIN_RATIO and MAX_RATIO
  const rawRatio = MIN_RATIO + Math.random() * (MAX_RATIO - MIN_RATIO);
  const ratio = roundRatio(rawRatio);

  // Pick a base frequency such that both frequencies fit in range
  // Lower freq must be >= MIN_FREQ
  // Higher freq = lower * ratio must be <= MAX_FREQ
  // So: MIN_FREQ <= lower <= MAX_FREQ / ratio
  const maxLower = MAX_FREQ / ratio;
  const logMinLower = LOG_MIN;
  const logMaxLower = Math.log2(maxLower);

  const logLower = logMinLower + Math.random() * (logMaxLower - logMinLower);
  const lowerFreq = Math.pow(2, logLower);
  const higherFreq = lowerFreq * ratio;

  // Randomly decide order (higher first or lower first)
  const higherFirst = Math.random() < 0.5;
  const frequencies: [number, number] = higherFirst
    ? [higherFreq, lowerFreq]
    : [lowerFreq, higherFreq];

  return { frequencies, ratio };
}

/**
 * Generate ratio choices with good separation.
 */
function generateRatioChoices(
  correctRatio: number,
  numChoices: number,
  minSeparation: number
): { choices: number[]; correctIndex: number } {
  const choices: number[] = [correctRatio];

  // Generate decoy ratios
  while (choices.length < numChoices) {
    let attempts = 0;
    let candidate: number;

    do {
      // Pick a random ratio in the valid range
      candidate = roundRatio(
        MIN_RATIO + Math.random() * (MAX_RATIO - MIN_RATIO)
      );
      attempts++;

      // Check separation from all existing choices
      const tooClose = choices.some(
        (r) => Math.abs(candidate - r) < minSeparation
      );

      if (!tooClose && candidate !== correctRatio) {
        choices.push(candidate);
        break;
      }
    } while (attempts < 100);

    // If we can't find a well-separated ratio, just add something different
    if (attempts >= 100) {
      const fallback = roundRatio(
        MIN_RATIO + Math.random() * (MAX_RATIO - MIN_RATIO)
      );
      if (fallback !== correctRatio && !choices.includes(fallback)) {
        choices.push(fallback);
      } else {
        // Last resort: add a slightly modified ratio
        choices.push(roundRatio(correctRatio + (choices.length * 0.2)));
      }
    }
  }

  // Sort choices
  choices.sort((a, b) => a - b);

  // Find correct index
  const correctIndex = choices.indexOf(correctRatio);

  return { choices, correctIndex };
}

function initExercise(): void {
  const savedLevel = loadDifficulty("frequency-ratio", MIN_LEVEL);
  const level = Math.max(
    MIN_LEVEL,
    Math.min(MAX_LEVEL, Math.round(savedLevel))
  );

  state = {
    frequencies: [0, 0],
    correctRatio: 1,
    ratioChoices: [],
    correctIndex: 0,
    hasAnswered: false,
    wasCorrect: null,
    chosenIndex: null,
    level,
    ema: INITIAL_EMA,
    totalCorrect: 0,
    totalAttempts: 0,
    streak: 0,
    inputEnabled: false,
  };

  setupNextRound();
}

function setupNextRound(): void {
  const numChoices = CHOICES_BY_LEVEL[state.level] || 2;
  const minSeparation = RATIO_SEPARATION_BY_LEVEL[state.level] || 0.5;

  const { frequencies, ratio } = generateFrequencyPair();
  const { choices, correctIndex } = generateRatioChoices(
    ratio,
    numChoices,
    minSeparation
  );

  state.frequencies = frequencies;
  state.correctRatio = ratio;
  state.ratioChoices = choices;
  state.correctIndex = correctIndex;
  state.hasAnswered = false;
  state.wasCorrect = null;
  state.chosenIndex = null;
  state.inputEnabled = false;
}

function applyDifficultyAdjustment(wasCorrect: boolean): void {
  const score = wasCorrect ? 1 : 0;
  state.ema = SMOOTHING_FACTOR * score + (1 - SMOOTHING_FACTOR) * state.ema;

  let newLevel = state.level;

  if (state.ema > PROMOTION_THRESHOLD && state.level < MAX_LEVEL) {
    newLevel = state.level + 1;
    state.ema = INITIAL_EMA;
  } else if (state.ema < DEMOTION_THRESHOLD && state.level > MIN_LEVEL) {
    newLevel = state.level - 1;
    state.ema = INITIAL_EMA;
  }

  state.level = newLevel;
  saveDifficulty("frequency-ratio", state.level);
}

function handleAnswer(chosenIndex: number): void {
  if (state.hasAnswered || !state.inputEnabled) return;

  state.hasAnswered = true;
  state.chosenIndex = chosenIndex;
  state.wasCorrect = chosenIndex === state.correctIndex;
  state.totalAttempts++;

  if (state.wasCorrect) {
    state.totalCorrect++;
    state.streak++;
  } else {
    state.streak = 0;
  }

  applyDifficultyAdjustment(state.wasCorrect);

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

function formatFrequency(freq: number): string {
  return freq >= 1000
    ? `${(freq / 1000).toFixed(2)}kHz`
    : `${Math.round(freq)}Hz`;
}

function formatRatio(ratio: number): string {
  return ratio.toFixed(1) + ":1";
}

function render(): void {
  const app = document.getElementById("app")!;

  const choiceButtons = state.ratioChoices
    .map((ratio, i) => {
      let className = "choice-btn ratio-choice";
      if (state.hasAnswered) {
        if (i === state.correctIndex) {
          className += " correct";
        } else if (i === state.chosenIndex) {
          className += " incorrect";
        }
      }
      return `<button class="${className}" data-index="${i}">${formatRatio(ratio)}</button>`;
    })
    .join("");

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Frequency Ratio</h1>
    <p>Two tones play. Select the ratio between them (higher ÷ lower).</p>
    <p>Use <strong>number keys (1-${state.ratioChoices.length})</strong> to select, <strong>R</strong> to replay.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
      </div>

      <div class="ratio-choices" id="choice-buttons">
        ${choiceButtons}
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
        <div class="stats">
          <span class="stats-label">Level:</span>
          <span>${state.level}</span>
        </div>
      </div>
    </div>
  `;

  renderFeedback();
  setupEventListeners();
}

function renderFeedback(): void {
  const feedback = document.getElementById("feedback")!;

  if (!state.hasAnswered) {
    feedback.className = "";
    feedback.textContent = "";
    return;
  }

  const [f1, f2] = state.frequencies;
  const higher = Math.max(f1, f2);
  const lower = Math.min(f1, f2);

  if (state.wasCorrect) {
    feedback.className = "feedback success fade-out";
    feedback.textContent = `Correct! ${formatFrequency(higher)} ÷ ${formatFrequency(lower)} = ${formatRatio(state.correctRatio)}`;
  } else {
    feedback.className = "feedback error fade-out";
    feedback.textContent = `Wrong! The ratio was ${formatRatio(state.correctRatio)} (${formatFrequency(higher)} ÷ ${formatFrequency(lower)})`;
  }
}

function setupEventListeners(): void {
  const playBtn = document.getElementById("play-btn");
  playBtn?.addEventListener("click", () => {
    if (!state.hasAnswered) {
      playBothFrequencies();
    }
  });

  const choiceButtons = document.querySelectorAll(".ratio-choice");
  choiceButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = parseInt((btn as HTMLElement).dataset.index || "0", 10);
      handleAnswer(index);
    });
  });

  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
  }

  keyboardHandler = (e: KeyboardEvent) => {
    if (e.repeat) return;

    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      if (!state.hasAnswered) {
        playBothFrequencies();
      }
      return;
    }

    if (state.hasAnswered) return;

    // Number keys 1-5 for choices
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= state.ratioChoices.length) {
      e.preventDefault();
      handleAnswer(num - 1);
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

export async function renderFrequencyRatio(): Promise<void> {
  initExercise();
  render();
  await playBothFrequencies();
  state.inputEnabled = true;
}
