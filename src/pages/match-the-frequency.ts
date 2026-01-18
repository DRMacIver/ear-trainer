/**
 * Match the Frequency Exercise
 *
 * A frequency is displayed. Two tones play. The user must identify which
 * tone matches the displayed frequency.
 *
 * Difficulty adapts based on how close the two tones are together.
 */

import { playFrequency } from "../audio.js";
import {
  loadVersionedDifficulty,
  saveVersionedDifficulty,
} from "../lib/storage.js";

const MIN_FREQ = 128;
const MAX_FREQ = 1024;
const LOG_MIN = Math.log2(MIN_FREQ);
const LOG_MAX = Math.log2(MAX_FREQ);
const LOG_RANGE = LOG_MAX - LOG_MIN;

const NOTE_DURATION = 0.6;
const NOTE_GAP = 0.4;
const AUTO_ADVANCE_DELAY = 1000;

// Version for difficulty reset
const EXERCISE_VERSION = 2;

// Difficulty is measured as separation between tones in octaves
// Smaller = harder
const INITIAL_SEPARATION = 2.0; // 2 octaves
const MIN_SEPARATION = 0.08; // ~1 semitone (very hard)
const MAX_SEPARATION = 2.0; // 2 octaves (easy)
const WARMUP_ROUNDS = 5;
const TARGET_SUCCESS_RATE = 0.85;
const DECAY_FACTOR = 0.97;
const MAX_SHRINK_RATE = 0.92; // Can get 8% closer per round
const MAX_GROW_RATE = 1.15; // Can get 15% further per round

interface HistoryEntry {
  targetFreq: number;
  otherFreq: number;
  correctAnswer: 1 | 2;
  userAnswer: 1 | 2;
  correct: boolean;
  separation: number;
}

interface ExerciseState {
  displayedFrequency: number;
  toneFrequencies: [number, number]; // [first tone, second tone]
  correctAnswer: 1 | 2; // Which tone is correct
  hasAnswered: boolean;
  wasCorrect: boolean | null;
  userAnswer: 1 | 2 | null;
  separation: number; // Current difficulty (separation in octaves)
  totalCorrect: number;
  totalAttempts: number;
  streak: number;
  history: HistoryEntry[];
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
 * Generate a round with target frequency and two tones.
 */
function generateRound(separation: number): {
  displayed: number;
  tones: [number, number];
  correct: 1 | 2;
} {
  // Pick the target frequency
  const target = pickRandomLogFrequency();
  const targetLog = Math.log2(target);

  // Generate decoy frequency at the specified separation
  // Randomly higher or lower
  const direction = Math.random() < 0.5 ? 1 : -1;
  let decoyLog = targetLog + direction * separation;

  // Clamp to valid range
  if (decoyLog < LOG_MIN) {
    decoyLog = targetLog + separation; // Force higher
  } else if (decoyLog > LOG_MAX) {
    decoyLog = targetLog - separation; // Force lower
  }

  const decoy = Math.pow(2, decoyLog);

  // Randomly assign to first or second position
  const targetFirst = Math.random() < 0.5;
  const tones: [number, number] = targetFirst
    ? [target, decoy]
    : [decoy, target];
  const correct: 1 | 2 = targetFirst ? 1 : 2;

  return { displayed: target, tones, correct };
}

function initExercise(): void {
  const savedSeparation = loadVersionedDifficulty(
    "match-the-frequency",
    INITIAL_SEPARATION,
    EXERCISE_VERSION
  );
  const separation = Math.max(
    MIN_SEPARATION,
    Math.min(MAX_SEPARATION, savedSeparation)
  );

  state = {
    displayedFrequency: 0,
    toneFrequencies: [0, 0],
    correctAnswer: 1,
    hasAnswered: false,
    wasCorrect: null,
    userAnswer: null,
    separation,
    totalCorrect: 0,
    totalAttempts: 0,
    streak: 0,
    history: [],
    inputEnabled: false,
  };

  setupNextRound();
}

function setupNextRound(): void {
  const round = generateRound(state.separation);
  state.displayedFrequency = round.displayed;
  state.toneFrequencies = round.tones;
  state.correctAnswer = round.correct;
  state.hasAnswered = false;
  state.wasCorrect = null;
  state.userAnswer = null;
  state.inputEnabled = false;
}

/**
 * Calculate adaptive separation based on history.
 */
function calculateAdaptiveSeparation(): number {
  if (state.history.length < WARMUP_ROUNDS) {
    return INITIAL_SEPARATION;
  }

  // Calculate weighted success rate
  const weightedResults = state.history.map((h, index) => ({
    correct: h.correct ? 1 : 0,
    weight: Math.pow(DECAY_FACTOR, index),
  }));

  const totalWeight = weightedResults.reduce((sum, r) => sum + r.weight, 0);
  const weightedSuccess =
    weightedResults.reduce((sum, r) => sum + r.correct * r.weight, 0) /
    totalWeight;

  // Adjust separation based on success rate
  let targetSeparation = state.separation;

  if (weightedSuccess > TARGET_SUCCESS_RATE) {
    // Doing well - make it harder (decrease separation)
    targetSeparation = state.separation * 0.95;
  } else if (weightedSuccess < 0.7) {
    // Struggling - make it easier (increase separation)
    targetSeparation = state.separation * 1.08;
  }

  // Apply rate limits
  const minNew = state.separation * MAX_SHRINK_RATE;
  const maxNew = state.separation * MAX_GROW_RATE;
  targetSeparation = Math.max(minNew, Math.min(maxNew, targetSeparation));

  // Clamp to bounds
  return Math.max(MIN_SEPARATION, Math.min(MAX_SEPARATION, targetSeparation));
}

function handleAnswer(answer: 1 | 2): void {
  if (state.hasAnswered || !state.inputEnabled) return;

  state.hasAnswered = true;
  state.userAnswer = answer;
  state.wasCorrect = answer === state.correctAnswer;
  state.totalAttempts++;

  // Record history
  state.history.unshift({
    targetFreq: state.displayedFrequency,
    otherFreq:
      state.correctAnswer === 1
        ? state.toneFrequencies[1]
        : state.toneFrequencies[0],
    correctAnswer: state.correctAnswer,
    userAnswer: answer,
    correct: state.wasCorrect,
    separation: state.separation,
  });

  if (state.wasCorrect) {
    state.totalCorrect++;
    state.streak++;
  } else {
    state.streak = 0;
  }

  // Update difficulty
  state.separation = calculateAdaptiveSeparation();
  saveVersionedDifficulty(
    "match-the-frequency",
    state.separation,
    EXERCISE_VERSION
  );

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
  await playFrequency(state.toneFrequencies[0], { duration: NOTE_DURATION });
  await sleep(NOTE_GAP * 1000);
  await playFrequency(state.toneFrequencies[1], { duration: NOTE_DURATION });
  state.inputEnabled = true;
}

function formatFrequency(freq: number): string {
  return freq >= 1000
    ? `${(freq / 1000).toFixed(2)}kHz`
    : `${Math.round(freq)}Hz`;
}

function render(): void {
  const app = document.getElementById("app")!;

  const separationSemitones = (state.separation * 12).toFixed(1);

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Match the Frequency</h1>
    <p>Two tones play. Which one is <strong>${formatFrequency(state.displayedFrequency)}</strong>?</p>
    <p>Use <strong>1/Left</strong> for First, <strong>2/Right</strong> for Second. <strong>R</strong> to replay.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
      </div>

      <div class="freq-display">
        <span class="displayed-freq">${formatFrequency(state.displayedFrequency)}</span>
      </div>

      <div class="choice-buttons" id="choice-buttons">
        <button class="choice-btn tone-choice${state.hasAnswered && state.userAnswer === 1 ? (state.wasCorrect ? " correct" : " incorrect") : ""}${state.hasAnswered && state.correctAnswer === 1 && state.userAnswer !== 1 ? " correct" : ""}" data-answer="1">
          First
        </button>
        <button class="choice-btn tone-choice${state.hasAnswered && state.userAnswer === 2 ? (state.wasCorrect ? " correct" : " incorrect") : ""}${state.hasAnswered && state.correctAnswer === 2 && state.userAnswer !== 2 ? " correct" : ""}" data-answer="2">
          Second
        </button>
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
          <span class="stats-label">Gap:</span>
          <span>${separationSemitones} st</span>
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

  const correctTone = state.correctAnswer === 1 ? "first" : "second";
  const [freq1, freq2] = state.toneFrequencies;

  if (state.wasCorrect) {
    feedback.className = "feedback success fade-out";
    feedback.textContent = `Correct! The ${correctTone} tone was ${formatFrequency(state.displayedFrequency)}.`;
  } else {
    feedback.className = "feedback error fade-out";
    feedback.textContent = `Wrong! The ${correctTone} tone was ${formatFrequency(state.displayedFrequency)}. (Tones: ${formatFrequency(freq1)}, ${formatFrequency(freq2)})`;
  }
}

function setupEventListeners(): void {
  const playBtn = document.getElementById("play-btn");
  playBtn?.addEventListener("click", () => {
    if (!state.hasAnswered) {
      playBothTones();
    }
  });

  const choiceButtons = document.querySelectorAll(".tone-choice");
  choiceButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const answer = parseInt((btn as HTMLElement).dataset.answer || "1", 10) as
        | 1
        | 2;
      handleAnswer(answer);
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
        playBothTones();
      }
      return;
    }

    if (state.hasAnswered) return;

    if (e.key === "1" || e.key === "ArrowLeft") {
      e.preventDefault();
      handleAnswer(1);
    } else if (e.key === "2" || e.key === "ArrowRight") {
      e.preventDefault();
      handleAnswer(2);
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

export async function renderMatchTheFrequency(): Promise<void> {
  initExercise();
  render();
  await playBothTones();
  state.inputEnabled = true;
}
