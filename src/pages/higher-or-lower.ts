/**
 * Higher or Lower Exercise
 *
 * A tone plays and a frequency is displayed. The user must determine if the
 * played tone is higher, lower, or about the same as the displayed frequency.
 * "About the same" is valid when within a semitone (ratio < 2^(1/12)).
 *
 * Difficulty adapts based on how close the frequencies are, while keeping
 * "about the same" answers to roughly 10% of rounds.
 */

import { playFrequency } from "../audio.js";
import { loadDifficulty, saveDifficulty } from "../lib/storage.js";

const MIN_FREQ = 128;
const MAX_FREQ = 1024;

const NOTE_DURATION = 0.8;
const AUTO_ADVANCE_DELAY = 1000;

// A semitone is 2^(1/12) ≈ 1.0595
const SEMITONE_LOG = 1 / 12; // In log2 units (octaves)

// Difficulty parameters
// Difficulty is measured as minimum ratio between played and displayed
// Higher difficulty = closer frequencies = harder to distinguish
const INITIAL_DIFFICULTY = 0.15; // ~2.6 semitones apart minimum
const MIN_DIFFICULTY = 0.05; // ~0.9 semitones (very easy, always distinguishable)
const MAX_DIFFICULTY = 0.08; // ~1.4 semitones (hard, close to "same" threshold)
const WARMUP_ROUNDS = 5;
const TARGET_SUCCESS_RATE = 0.85;
const DECAY_FACTOR = 0.97;
const MAX_SHRINK_RATE = 0.9;
const MAX_GROW_RATE = 1.2;

// Probability of "about the same" being the correct answer
const SAME_PROBABILITY = 0.10;

// Musical note frequencies (A4 = 440Hz, using equal temperament)
const A4_FREQ = 440;

interface HistoryEntry {
  playedFreq: number;
  displayedFreq: number;
  correctAnswer: "higher" | "lower" | "same";
  userAnswer: "higher" | "lower" | "same";
  correct: boolean;
  difficulty: number; // The ratio at the time
}

interface ExerciseState {
  playedFrequency: number;
  displayedFrequency: number;
  correctAnswer: "higher" | "lower" | "same";
  hasAnswered: boolean;
  wasCorrect: boolean | null;
  userAnswer: "higher" | "lower" | "same" | null;
  // Difficulty: minimum log ratio (smaller = harder)
  minLogRatio: number;
  totalCorrect: number;
  totalAttempts: number;
  streak: number;
  history: HistoryEntry[];
  inputEnabled: boolean;
}

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

/**
 * Get a frequency near a musical note.
 * Returns a frequency that's close to an equal temperament note.
 */
function getFrequencyNearMusicalNote(): number {
  // Pick a random note within our frequency range
  // Notes are A4 * 2^(n/12) for integer n
  // Find n range: 128 = 440 * 2^(n/12) => n = 12 * log2(128/440) ≈ -21
  //               1024 = 440 * 2^(n/12) => n = 12 * log2(1024/440) ≈ 14
  const minN = Math.ceil(12 * Math.log2(MIN_FREQ / A4_FREQ));
  const maxN = Math.floor(12 * Math.log2(MAX_FREQ / A4_FREQ));

  const n = minN + Math.floor(Math.random() * (maxN - minN + 1));
  const exactNoteFreq = A4_FREQ * Math.pow(2, n / 12);

  // Add small random offset (up to 10 cents = 1/10 semitone)
  const maxOffset = SEMITONE_LOG / 10;
  const offset = (Math.random() - 0.5) * 2 * maxOffset;
  const freq = exactNoteFreq * Math.pow(2, offset);

  return Math.max(MIN_FREQ, Math.min(MAX_FREQ, freq));
}

/**
 * Generate a round with played and displayed frequencies.
 */
function generateRound(): {
  played: number;
  displayed: number;
  answer: "higher" | "lower" | "same";
} {
  // Decide if this will be a "same" round (~10% of the time)
  const isSameRound = Math.random() < SAME_PROBABILITY;

  // Pick played frequency (biased towards musical notes)
  const played = getFrequencyNearMusicalNote();

  let displayed: number;
  let answer: "higher" | "lower" | "same";

  if (isSameRound) {
    // Pick displayed within a semitone, but not identical
    // Random offset between 1Hz and just under a semitone
    const maxLogOffset = SEMITONE_LOG * 0.95; // Stay safely within semitone
    const minLogOffset = Math.log2(1 + 1 / played); // At least 1Hz different

    const logOffset =
      minLogOffset + Math.random() * (maxLogOffset - minLogOffset);
    const direction = Math.random() < 0.5 ? 1 : -1;

    displayed = played * Math.pow(2, direction * logOffset);

    // Even though they're "about the same", one is still technically higher/lower
    // The user can answer either "same" or the technically correct direction
    answer = "same";
  } else {
    // Pick displayed at least minLogRatio away from played
    const minOffset = state.minLogRatio;
    const maxOffset = 0.5; // Half an octave max

    // Ensure we stay outside the semitone range
    const actualMinOffset = Math.max(minOffset, SEMITONE_LOG * 1.1);

    const logOffset =
      actualMinOffset + Math.random() * (maxOffset - actualMinOffset);
    const direction = Math.random() < 0.5 ? 1 : -1;

    displayed = played * Math.pow(2, direction * logOffset);

    // Clamp to valid range
    if (displayed < MIN_FREQ) {
      displayed = played * Math.pow(2, logOffset); // Force higher
    } else if (displayed > MAX_FREQ) {
      displayed = played * Math.pow(2, -logOffset); // Force lower
    }

    // Played is higher than displayed => answer is "higher"
    // Played is lower than displayed => answer is "lower"
    answer = played > displayed ? "higher" : "lower";
  }

  // Ensure at least 1Hz difference
  if (Math.abs(played - displayed) < 1) {
    displayed = played + (displayed > played ? 1 : -1);
  }

  return { played, displayed, answer };
}

function initExercise(): void {
  const savedDifficulty = loadDifficulty("higher-or-lower", INITIAL_DIFFICULTY);
  const minLogRatio = Math.max(
    MIN_DIFFICULTY,
    Math.min(MAX_DIFFICULTY, savedDifficulty)
  );

  state = {
    playedFrequency: 0,
    displayedFrequency: 0,
    correctAnswer: "higher",
    hasAnswered: false,
    wasCorrect: null,
    userAnswer: null,
    minLogRatio,
    totalCorrect: 0,
    totalAttempts: 0,
    streak: 0,
    history: [],
    inputEnabled: false,
  };

  setupNextRound();
}

function setupNextRound(): void {
  const round = generateRound();
  state.playedFrequency = round.played;
  state.displayedFrequency = round.displayed;
  state.correctAnswer = round.answer;
  state.hasAnswered = false;
  state.wasCorrect = null;
  state.userAnswer = null;
  state.inputEnabled = false;
}

/**
 * Calculate adaptive difficulty based on history.
 */
function calculateAdaptiveDifficulty(): number {
  if (state.history.length < WARMUP_ROUNDS) {
    return INITIAL_DIFFICULTY;
  }

  // Only consider non-"same" rounds for difficulty calculation
  const nonSameHistory = state.history.filter(
    (h) => h.correctAnswer !== "same"
  );
  if (nonSameHistory.length < 3) {
    return state.minLogRatio;
  }

  // Calculate weighted success rate
  const weightedResults = nonSameHistory.map((h, index) => ({
    correct: h.correct ? 1 : 0,
    weight: Math.pow(DECAY_FACTOR, index),
  }));

  const totalWeight = weightedResults.reduce((sum, r) => sum + r.weight, 0);
  const weightedSuccess =
    weightedResults.reduce((sum, r) => sum + r.correct * r.weight, 0) /
    totalWeight;

  // Adjust difficulty based on success rate
  // If doing well (>85%), make it harder (decrease minLogRatio)
  // If struggling (<70%), make it easier (increase minLogRatio)
  let targetDifficulty = state.minLogRatio;

  if (weightedSuccess > TARGET_SUCCESS_RATE) {
    targetDifficulty = state.minLogRatio * 0.95; // Get closer
  } else if (weightedSuccess < 0.7) {
    targetDifficulty = state.minLogRatio * 1.1; // Get further apart
  }

  // Apply rate limits
  const minNew = state.minLogRatio * MAX_SHRINK_RATE;
  const maxNew = state.minLogRatio * MAX_GROW_RATE;
  targetDifficulty = Math.max(minNew, Math.min(maxNew, targetDifficulty));

  // Clamp to bounds
  return Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, targetDifficulty));
}

function handleAnswer(answer: "higher" | "lower" | "same"): void {
  if (state.hasAnswered || !state.inputEnabled) return;

  state.hasAnswered = true;
  state.userAnswer = answer;

  // For "same" rounds, accept either "same" or the technically correct direction
  if (state.correctAnswer === "same") {
    const technicallyCorrect =
      state.playedFrequency > state.displayedFrequency ? "higher" : "lower";
    state.wasCorrect = answer === "same" || answer === technicallyCorrect;
  } else {
    state.wasCorrect = answer === state.correctAnswer;
  }

  state.totalAttempts++;

  // Record history
  state.history.unshift({
    playedFreq: state.playedFrequency,
    displayedFreq: state.displayedFrequency,
    correctAnswer: state.correctAnswer,
    userAnswer: answer,
    correct: state.wasCorrect,
    difficulty: state.minLogRatio,
  });

  if (state.wasCorrect) {
    state.totalCorrect++;
    state.streak++;
  } else {
    state.streak = 0;
  }

  // Update difficulty
  state.minLogRatio = calculateAdaptiveDifficulty();
  saveDifficulty("higher-or-lower", state.minLogRatio);

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

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Higher or Lower</h1>
    <p>A tone plays. Is it <strong>higher</strong>, <strong>lower</strong>, or <strong>about the same</strong> as the displayed frequency?</p>
    <p>Use <strong>H/Right</strong> for Higher, <strong>L/Left</strong> for Lower, <strong>S/Down</strong> for Same. <strong>R</strong> to replay.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
      </div>

      <div class="freq-display">
        <span class="displayed-freq">${formatFrequency(state.displayedFrequency)}</span>
      </div>

      <div class="choice-buttons" id="choice-buttons">
        <button class="choice-btn${state.hasAnswered && state.userAnswer === "lower" ? (state.wasCorrect || state.correctAnswer === "lower" ? " correct" : " incorrect") : ""}${state.hasAnswered && state.correctAnswer === "lower" && state.userAnswer !== "lower" ? " correct" : ""}" data-answer="lower">
          Lower
        </button>
        <button class="choice-btn${state.hasAnswered && state.userAnswer === "same" ? (state.wasCorrect ? " correct" : " incorrect") : ""}${state.hasAnswered && state.correctAnswer === "same" && state.userAnswer !== "same" ? " correct" : ""}" data-answer="same">
          Same
        </button>
        <button class="choice-btn${state.hasAnswered && state.userAnswer === "higher" ? (state.wasCorrect || state.correctAnswer === "higher" ? " correct" : " incorrect") : ""}${state.hasAnswered && state.correctAnswer === "higher" && state.userAnswer !== "higher" ? " correct" : ""}" data-answer="higher">
          Higher
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
          <span>${(state.minLogRatio * 12).toFixed(1)} st</span>
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

  const playedStr = formatFrequency(state.playedFrequency);
  const ratio = state.playedFrequency / state.displayedFrequency;
  const semitones = Math.abs(12 * Math.log2(ratio)).toFixed(1);

  if (state.wasCorrect) {
    feedback.className = "feedback success fade-out";
    feedback.textContent = `Correct! The tone was ${playedStr} (${semitones} semitones ${state.playedFrequency > state.displayedFrequency ? "higher" : "lower"}).`;
  } else {
    const correctDesc =
      state.correctAnswer === "same"
        ? "about the same"
        : state.correctAnswer;
    feedback.className = "feedback error fade-out";
    feedback.textContent = `Wrong! The tone was ${playedStr} (${correctDesc}, ${semitones} semitones apart).`;
  }
}

function setupEventListeners(): void {
  const playBtn = document.getElementById("play-btn");
  playBtn?.addEventListener("click", () => {
    if (!state.hasAnswered) {
      playCurrentFrequency();
    }
  });

  const choiceButtons = document.querySelectorAll(".choice-btn");
  choiceButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const answer = (btn as HTMLElement).dataset.answer as
        | "higher"
        | "lower"
        | "same";
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
        playCurrentFrequency();
      }
      return;
    }

    if (state.hasAnswered) return;

    if (
      e.key === "h" ||
      e.key === "H" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp"
    ) {
      e.preventDefault();
      handleAnswer("higher");
    } else if (e.key === "l" || e.key === "L" || e.key === "ArrowLeft") {
      e.preventDefault();
      handleAnswer("lower");
    } else if (e.key === "s" || e.key === "S" || e.key === "ArrowDown") {
      e.preventDefault();
      handleAnswer("same");
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

export async function renderHigherOrLower(): Promise<void> {
  initExercise();
  render();
  await playCurrentFrequency();
  state.inputEnabled = true;
}
