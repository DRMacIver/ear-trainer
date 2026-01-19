/**
 * Higher or Lower Exercise
 *
 * A tone plays and a frequency is displayed. The user must determine if the
 * played tone is higher, lower, or about the same as the displayed frequency.
 * "About the same" is valid when within half a semitone.
 *
 * The same tone continues until you get it wrong or correctly identify "same".
 * Each correct answer narrows the known bounds, with the next displayed
 * frequency chosen uniformly in log-space within those bounds.
 */

import { playFrequency } from "../audio.js";

const MIN_FREQ = 128;
const MAX_FREQ = 1024;
const LOG_MIN = Math.log2(MIN_FREQ);
const LOG_MAX = Math.log2(MAX_FREQ);

const NOTE_DURATION = 0.8;
const AUTO_ADVANCE_DELAY = 1000;

// Half a semitone threshold for "about the same"
const SAME_THRESHOLD_LOG = 1 / 24; // Half semitone in log2 units (octaves)

// If range is narrower than 2x the "same" threshold, wrong answers don't count as losses
// (you've already demonstrated good discrimination by narrowing to this resolution)
const TIGHT_RANGE_MULTIPLIER = 2;

interface ExerciseState {
  // The frequency being played (stays same until sequence ends)
  playedFrequency: number;
  playedFrequencyLog: number;
  // Current displayed frequency for this round
  displayedFrequency: number;
  // Known bounds for the played frequency (in log2 space)
  lowerBoundLog: number;
  upperBoundLog: number;
  // Current round state
  correctAnswer: "higher" | "lower" | "same";
  hasAnswered: boolean;
  wasCorrect: boolean | null;
  wasTightRange: boolean; // Range was tight enough that wrong doesn't count as loss
  userAnswer: "higher" | "lower" | "same" | null;
  // Stats
  totalCorrect: number;
  totalAttempts: number;
  streak: number;
  sequenceLength: number; // How many correct in current sequence
  bestSequence: number;
  inputEnabled: boolean;
}

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

/**
 * Pick a random frequency uniform in log space.
 */
function pickRandomLogFrequency(): number {
  const logPos = LOG_MIN + Math.random() * (LOG_MAX - LOG_MIN);
  return Math.pow(2, logPos);
}

/**
 * Start a new sequence with a fresh played frequency.
 */
function startNewSequence(): void {
  state.playedFrequency = pickRandomLogFrequency();
  state.playedFrequencyLog = Math.log2(state.playedFrequency);
  state.lowerBoundLog = LOG_MIN;
  state.upperBoundLog = LOG_MAX;
  state.sequenceLength = 0;
}

/**
 * Generate the next round within the current sequence.
 * Picks displayed frequency uniformly in log space within current bounds.
 */
function generateRound(): void {
  // Pick displayed frequency uniformly in log space within bounds
  const displayedLog =
    state.lowerBoundLog +
    Math.random() * (state.upperBoundLog - state.lowerBoundLog);
  state.displayedFrequency = Math.pow(2, displayedLog);

  // Determine correct answer based on distance
  const diff = state.playedFrequencyLog - displayedLog;

  if (Math.abs(diff) <= SAME_THRESHOLD_LOG) {
    state.correctAnswer = "same";
  } else if (diff > 0) {
    state.correctAnswer = "higher";
  } else {
    state.correctAnswer = "lower";
  }

  // Check if range is tight enough that wrong answers shouldn't penalize
  const currentRange = state.upperBoundLog - state.lowerBoundLog;
  const tightRangeThreshold = SAME_THRESHOLD_LOG * TIGHT_RANGE_MULTIPLIER;
  state.wasTightRange = currentRange <= tightRangeThreshold;

  state.hasAnswered = false;
  state.wasCorrect = null;
  state.userAnswer = null;
  state.inputEnabled = false;
}

function initExercise(): void {
  state = {
    playedFrequency: 0,
    playedFrequencyLog: 0,
    displayedFrequency: 0,
    lowerBoundLog: LOG_MIN,
    upperBoundLog: LOG_MAX,
    correctAnswer: "higher",
    hasAnswered: false,
    wasCorrect: null,
    wasTightRange: false,
    userAnswer: null,
    totalCorrect: 0,
    totalAttempts: 0,
    streak: 0,
    sequenceLength: 0,
    bestSequence: 0,
    inputEnabled: false,
  };

  startNewSequence();
  generateRound();
}

function handleAnswer(answer: "higher" | "lower" | "same"): void {
  if (state.hasAnswered || !state.inputEnabled) return;

  state.hasAnswered = true;
  state.userAnswer = answer;
  state.totalAttempts++;

  // Check if correct
  // For "same" rounds, only "same" is correct
  // For higher/lower rounds, only the exact answer is correct
  state.wasCorrect = answer === state.correctAnswer;

  // If range was tight enough, wrong answers don't count as losses
  // (you've already demonstrated good discrimination by narrowing this far)
  const countsAsSuccess = state.wasCorrect || state.wasTightRange;

  if (countsAsSuccess) {
    state.totalCorrect++;
    state.streak++;
    state.sequenceLength++;

    if (state.sequenceLength > state.bestSequence) {
      state.bestSequence = state.sequenceLength;
    }
  } else {
    state.streak = 0;
  }

  render();
  setTimeout(advanceToNext, AUTO_ADVANCE_DELAY);
}

async function advanceToNext(): Promise<void> {
  // Decide whether to continue sequence or start fresh
  // Sequence ends on: wrong answer, correct "same", or tight range (even if wrong)
  const sequenceEnds =
    !state.wasCorrect ||
    state.correctAnswer === "same" ||
    state.wasTightRange;

  if (sequenceEnds) {
    // Start a completely new sequence
    startNewSequence();
  } else {
    // Continue sequence: narrow bounds based on answer
    const displayedLog = Math.log2(state.displayedFrequency);

    if (state.userAnswer === "higher") {
      // Played is higher than displayed, so displayed is new lower bound
      state.lowerBoundLog = displayedLog;
    } else if (state.userAnswer === "lower") {
      // Played is lower than displayed, so displayed is new upper bound
      state.upperBoundLog = displayedLog;
    }
  }

  generateRound();
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

function getButtonClass(answer: "higher" | "lower" | "same"): string {
  if (!state.hasAnswered) return "choice-btn";

  const isUserAnswer = state.userAnswer === answer;
  const isCorrectAnswer = state.correctAnswer === answer;

  // If tight range and wrong, treat user's answer as correct (don't reveal actual answer)
  if (state.wasTightRange && !state.wasCorrect) {
    if (isUserAnswer) return "choice-btn correct";
    return "choice-btn";
  }

  // Normal case
  if (isUserAnswer) {
    return state.wasCorrect ? "choice-btn correct" : "choice-btn incorrect";
  }
  if (isCorrectAnswer && !state.wasCorrect) {
    return "choice-btn correct";
  }
  return "choice-btn";
}

function render(): void {
  const app = document.getElementById("app")!;

  // Show current narrowed range
  const rangeLow = Math.pow(2, state.lowerBoundLog);
  const rangeHigh = Math.pow(2, state.upperBoundLog);
  const rangeRatio = rangeHigh / rangeLow;

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
        <button class="${getButtonClass("lower")}" data-answer="lower">
          Lower
        </button>
        <button class="${getButtonClass("same")}" data-answer="same">
          Same
        </button>
        <button class="${getButtonClass("higher")}" data-answer="higher">
          Higher
        </button>
      </div>

      <div class="range-info">
        <span>Known range: ${formatFrequency(rangeLow)} - ${formatFrequency(rangeHigh)} (${rangeRatio.toFixed(1)}x)</span>
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
          <span class="stats-label">Run:</span>
          <span>${state.sequenceLength}</span>
        </div>
        <div class="stats">
          <span class="stats-label">Best:</span>
          <span>${state.bestSequence}</span>
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
  const direction =
    state.playedFrequency > state.displayedFrequency ? "higher" : "lower";

  if (state.wasCorrect) {
    feedback.className = "feedback success fade-out";
    if (state.correctAnswer === "same") {
      feedback.textContent = `Correct! The tone was ${playedStr} (${semitones} semitones ${direction}). New tone!`;
    } else {
      feedback.textContent = `Correct! The tone was ${playedStr} (${semitones} semitones ${direction}).`;
    }
  } else if (state.wasTightRange) {
    // Wrong but range was tight - counts as success
    feedback.className = "feedback success fade-out";
    feedback.textContent = `Close enough! The tone was ${playedStr} (${semitones} semitones ${direction}). New tone!`;
  } else {
    const correctDesc =
      state.correctAnswer === "same" ? "about the same" : state.correctAnswer;
    feedback.className = "feedback error fade-out";
    feedback.textContent = `Wrong! The tone was ${playedStr} (${correctDesc}, ${semitones} semitones ${direction}). New tone!`;
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
