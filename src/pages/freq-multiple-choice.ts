/**
 * What Frequency Is This? Exercise
 *
 * A tone plays and 2-5 frequencies are listed. The user must select which
 * frequency matches the played tone.
 *
 * Difficulty adapts based on:
 * - Number of choices (2-5)
 * - How close together the choices are
 */

import { playFrequency } from "../audio.js";
import { loadVersionedDifficulty, saveVersionedDifficulty } from "../lib/storage.js";

const MIN_FREQ = 128;
const MAX_FREQ = 1024;
const LOG_MIN = Math.log2(MIN_FREQ);
const LOG_MAX = Math.log2(MAX_FREQ);
const LOG_RANGE = LOG_MAX - LOG_MIN;

const NOTE_DURATION = 0.8;
const AUTO_ADVANCE_DELAY = 1000;

// Difficulty levels 1-8
// Level determines: number of choices, minimum separation
const MIN_LEVEL = 1;
const MAX_LEVEL = 8;

// Version: increment this when difficulty parameters change significantly
// This will reset saved difficulty for all users
const EXERCISE_VERSION = 2;

// Number of choices at each level
// Quick progression to 3 choices, stay there while tightening separation
const CHOICES_BY_LEVEL: Record<number, number> = {
  1: 2,
  2: 3,
  3: 3,
  4: 3,
  5: 3,
  6: 4,
  7: 4,
  8: 5,
};

// Minimum separation in octaves between choices at each level
// Start with reasonable separation, not too wide
const SEPARATION_BY_LEVEL: Record<number, number> = {
  1: 0.3, // ~3.6 semitones - easier start
  2: 0.35, // ~4 semitones - more choices but well separated
  3: 0.25, // 3 semitones
  4: 0.2, // ~2.4 semitones
  5: 0.15, // ~1.8 semitones - tight 3-choice
  6: 0.2, // ~2.4 semitones - 4 choices, moderate separation
  7: 0.15, // ~1.8 semitones
  8: 0.12, // ~1.4 semitones - hardest
};

// EMA-based difficulty adjustment
const INITIAL_EMA = 0.85;
const SMOOTHING_FACTOR = 0.05;
const PROMOTION_THRESHOLD = 0.92;
const DEMOTION_THRESHOLD = 0.7;

interface ExerciseState {
  playedFrequency: number;
  choices: number[];
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
 * Pick a random frequency uniform in log space.
 */
function pickRandomLogFrequency(): number {
  const logPos = Math.random();
  return Math.pow(2, logPos * LOG_RANGE + LOG_MIN);
}

/**
 * Generate multiple choice options.
 */
function generateChoices(
  numChoices: number,
  minSeparation: number
): { choices: number[]; correctIndex: number } {
  const choices: number[] = [];

  // Pick the correct frequency first
  const correct = pickRandomLogFrequency();
  const correctLogPos = Math.log2(correct);

  // Generate decoy frequencies that are well-separated
  const allLogPositions = [correctLogPos];

  while (choices.length < numChoices - 1) {
    let attempts = 0;
    let candidate: number;

    do {
      candidate = LOG_MIN + Math.random() * LOG_RANGE;
      attempts++;

      // Check separation from all existing positions
      const tooClose = allLogPositions.some(
        (pos) => Math.abs(candidate - pos) < minSeparation
      );

      if (!tooClose) {
        allLogPositions.push(candidate);
        choices.push(Math.pow(2, candidate));
        break;
      }
    } while (attempts < 100);

    // If we can't find a well-separated position, relax constraints
    if (attempts >= 100) {
      const relaxedCandidate = LOG_MIN + Math.random() * LOG_RANGE;
      allLogPositions.push(relaxedCandidate);
      choices.push(Math.pow(2, relaxedCandidate));
    }
  }

  // Add correct frequency
  choices.push(correct);

  // Shuffle choices
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }

  // Find where the correct answer ended up
  const correctIndex = choices.findIndex(
    (c) => Math.abs(c - correct) < 0.01
  );

  // Sort choices by frequency for display
  const sortedWithIndices = choices.map((c, i) => ({ freq: c, origIndex: i }));
  sortedWithIndices.sort((a, b) => a.freq - b.freq);

  const sortedChoices = sortedWithIndices.map((x) => x.freq);
  const newCorrectIndex = sortedWithIndices.findIndex(
    (x) => x.origIndex === correctIndex
  );

  return { choices: sortedChoices, correctIndex: newCorrectIndex };
}

function initExercise(): void {
  const savedLevel = loadVersionedDifficulty(
    "freq-multiple-choice",
    MIN_LEVEL,
    EXERCISE_VERSION
  );
  const level = Math.max(
    MIN_LEVEL,
    Math.min(MAX_LEVEL, Math.round(savedLevel))
  );

  state = {
    playedFrequency: 0,
    choices: [],
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
  const minSeparation = SEPARATION_BY_LEVEL[state.level] || 0.5;

  const { choices, correctIndex } = generateChoices(numChoices, minSeparation);

  state.playedFrequency = choices[correctIndex];
  state.choices = choices;
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
  saveVersionedDifficulty("freq-multiple-choice", state.level, EXERCISE_VERSION);
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
  await playCurrentFrequency();
  state.inputEnabled = true;
}

async function playCurrentFrequency(): Promise<void> {
  await playFrequency(state.playedFrequency, { duration: NOTE_DURATION });
  state.inputEnabled = true;
}

function formatFrequency(freq: number): string {
  return freq >= 1000
    ? `${(freq / 1000).toFixed(2)}kHz`
    : `${Math.round(freq)}Hz`;
}

function render(): void {
  const app = document.getElementById("app")!;

  const choiceButtons = state.choices
    .map((freq, i) => {
      let className = "choice-btn freq-choice";
      if (state.hasAnswered) {
        if (i === state.correctIndex) {
          className += " correct";
        } else if (i === state.chosenIndex) {
          className += " incorrect";
        }
      }
      return `<button class="${className}" data-index="${i}">${formatFrequency(freq)}</button>`;
    })
    .join("");

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>What Frequency Is This?</h1>
    <p>A tone plays. Select the matching frequency from the choices below.</p>
    <p>Use <strong>number keys (1-${state.choices.length})</strong> to select, <strong>R</strong> to replay.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
      </div>

      <div class="freq-choices" id="choice-buttons">
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

  const correctFreq = formatFrequency(state.choices[state.correctIndex]);

  if (state.wasCorrect) {
    feedback.className = "feedback success fade-out";
    feedback.textContent = `Correct! The frequency was ${correctFreq}.`;
  } else {
    feedback.className = "feedback error fade-out";
    feedback.textContent = `Wrong! The frequency was ${correctFreq}.`;
  }
}

function setupEventListeners(): void {
  const playBtn = document.getElementById("play-btn");
  playBtn?.addEventListener("click", () => {
    if (!state.hasAnswered) {
      playCurrentFrequency();
    }
  });

  const choiceButtons = document.querySelectorAll(".freq-choice");
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
        playCurrentFrequency();
      }
      return;
    }

    if (state.hasAnswered) return;

    // Number keys 1-5 for choices
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= state.choices.length) {
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

export async function renderFreqMultipleChoice(): Promise<void> {
  initExercise();
  render();
  await playCurrentFrequency();
  state.inputEnabled = true;
}
