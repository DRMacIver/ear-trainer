/**
 * Frequency Memorization Exercise
 *
 * Spaced repetition training to memorize frequencies from 100Hz to 1100Hz
 * in 50Hz intervals. Uses FSRS algorithm for scheduling.
 *
 * Session structure:
 * - First session: introduces 100Hz, 550Hz, 1100Hz
 * - Later sessions: 2 new cards + 3 reviews (one "splitting" card between new ones)
 */

import { playFrequency } from "../audio.js";
import { Grade } from "../lib/fsrs.js";
import {
  loadState,
  saveState,
  selectSessionCards,
  recordReview,
  incrementSessionCount,
  getStats,
  clearAllProgress,
  FreqMemoryState,
  SessionCards,
  ALL_FREQUENCIES,
} from "../lib/freq-memory.js";

const NOTE_DURATION = 0.8;

interface ExerciseState {
  memoryState: FreqMemoryState;
  sessionCards: SessionCards;
  allFrequencies: number[]; // All frequencies in this session
  correctCounts: Map<number, number>; // Correct answers per frequency this session
  currentFrequency: number;
  currentChoices: number[]; // Fixed choices for current question (sorted low to high)
  eliminatedChoices: Set<number>; // Choices that have been greyed out
  guessHistory: number[]; // Wrong guesses made on current card
  hasAnswered: boolean; // True only when answered correctly
  wasCorrect: boolean | null;
  userAnswer: number | null;
  lastFeedback: "too-high" | "too-low" | null; // Feedback for wrong answers
  sessionCorrect: number;
  sessionTotal: number;
  inputEnabled: boolean;
  isNewCard: boolean;
  // Timing (pauses when tabbed away)
  startTime: number; // When current card started (performance.now())
  elapsedBeforePause: number; // Accumulated time before current pause
  pausedAt: number | null; // When we paused (null if not paused)
  replayTimesMs: number[]; // When replay was pressed (relative to start)
}

const REQUIRED_CORRECT = 2; // Each card needs this many correct answers

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
let visibilityHandler: (() => void) | null = null;

/**
 * Get elapsed time for current card, excluding time when tabbed away.
 */
function getElapsedTime(): number {
  if (state.pausedAt !== null) {
    // Currently paused, return accumulated time
    return state.elapsedBeforePause;
  }
  return state.elapsedBeforePause + (performance.now() - state.startTime);
}

/**
 * Set up visibility change handler to pause timing when tabbed away.
 */
function setupVisibilityHandler(): void {
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
  }

  visibilityHandler = () => {
    if (document.hidden) {
      // Pausing - save elapsed time
      if (state.pausedAt === null) {
        state.elapsedBeforePause += performance.now() - state.startTime;
        state.pausedAt = performance.now();
      }
    } else {
      // Resuming - reset start time
      if (state.pausedAt !== null) {
        state.startTime = performance.now();
        state.pausedAt = null;
      }
    }
  };

  document.addEventListener("visibilitychange", visibilityHandler);
}

function initExercise(): void {
  const memoryState = loadState();
  const sessionCards = selectSessionCards(memoryState);

  // Collect all frequencies for this session
  const allFrequencies = [
    ...sessionCards.newCards,
    ...sessionCards.reviewCards,
  ].filter((f, i, arr) => arr.indexOf(f) === i); // Dedupe

  // Initialize correct counts to 0
  const correctCounts = new Map<number, number>();
  for (const freq of allFrequencies) {
    correctCounts.set(freq, 0);
  }

  const firstFreq = pickNextFrequency(allFrequencies, correctCounts);
  state = {
    memoryState,
    sessionCards,
    allFrequencies,
    correctCounts,
    currentFrequency: firstFreq,
    currentChoices: getChoices(firstFreq),
    eliminatedChoices: new Set(),
    guessHistory: [],
    hasAnswered: false,
    wasCorrect: null,
    userAnswer: null,
    lastFeedback: null,
    sessionCorrect: 0,
    sessionTotal: 0,
    inputEnabled: false,
    isNewCard: sessionCards.newCards.includes(firstFreq),
    startTime: performance.now(),
    elapsedBeforePause: 0,
    pausedAt: document.hidden ? performance.now() : null,
    replayTimesMs: [],
  };

  setupVisibilityHandler();
}

/**
 * Pick the next frequency to practice.
 * Prioritizes cards with fewer correct answers, with some randomization.
 */
function pickNextFrequency(
  allFrequencies: number[],
  correctCounts: Map<number, number>,
  excludeFreq?: number
): number {
  // Get frequencies that still need work (< REQUIRED_CORRECT)
  const needsWork = allFrequencies.filter(
    (f) => (correctCounts.get(f) ?? 0) < REQUIRED_CORRECT && f !== excludeFreq
  );

  if (needsWork.length === 0) {
    // All done, but we shouldn't get here
    return allFrequencies[0];
  }

  // Sort by correct count (fewest first), then randomize among ties
  needsWork.sort((a, b) => {
    const countA = correctCounts.get(a) ?? 0;
    const countB = correctCounts.get(b) ?? 0;
    if (countA !== countB) return countA - countB;
    return Math.random() - 0.5;
  });

  return needsWork[0];
}

function getChoices(correctFreq: number): number[] {
  // Generate plausible wrong answers nearby
  const choices = [correctFreq];
  const nearby = ALL_FREQUENCIES.filter(
    (f) => Math.abs(f - correctFreq) <= 200 && f !== correctFreq
  );

  // Shuffle nearby and pick 3
  const shuffled = nearby.sort(() => Math.random() - 0.5);
  choices.push(...shuffled.slice(0, 3));

  // If not enough nearby, add random ones
  while (choices.length < 4) {
    const random =
      ALL_FREQUENCIES[Math.floor(Math.random() * ALL_FREQUENCIES.length)];
    if (!choices.includes(random)) choices.push(random);
  }

  // Sort from low to high
  return choices.sort((a, b) => a - b);
}

function handleAnswer(answer: number): void {
  if (state.hasAnswered || !state.inputEnabled) return;
  if (state.eliminatedChoices.has(answer)) return; // Can't click eliminated choices

  state.userAnswer = answer;

  if (answer === state.currentFrequency) {
    // Correct!
    state.hasAnswered = true;
    state.wasCorrect = true;
    state.lastFeedback = null;
    state.sessionTotal++;

    // Only count as "correct" for session stats if first try
    if (state.guessHistory.length === 0) {
      state.sessionCorrect++;
    }

    // If they needed retries, auto-grade as Again and move on
    if (state.guessHistory.length > 0) {
      render(); // Show correct feedback briefly
      setTimeout(() => {
        handleGrade(Grade.AGAIN);
      }, 800);
    } else {
      render(); // Show grade buttons for first-try correct
    }
  } else {
    // Wrong - record guess, give feedback, eliminate choices
    state.guessHistory.push(answer);
    state.wasCorrect = false;
    const isTooHigh = answer > state.currentFrequency;
    state.lastFeedback = isTooHigh ? "too-high" : "too-low";

    // Eliminate this choice and all choices in the wrong direction
    for (const choice of state.currentChoices) {
      if (isTooHigh && choice >= answer) {
        state.eliminatedChoices.add(choice);
      } else if (!isTooHigh && choice <= answer) {
        state.eliminatedChoices.add(choice);
      }
    }

    render();
  }
}

function handleGrade(grade: Grade): void {
  // Record the review in FSRS (include timing and guess history for analysis)
  const timeMs = Math.round(getElapsedTime());
  state.memoryState = recordReview(
    state.memoryState,
    state.currentFrequency,
    grade,
    {
      guessHistory: state.guessHistory,
      timeMs,
      replayTimesMs: state.replayTimesMs,
    }
  );
  saveState(state.memoryState);

  // Track correct answers for session completion
  if (state.wasCorrect) {
    const current = state.correctCounts.get(state.currentFrequency) ?? 0;
    state.correctCounts.set(state.currentFrequency, current + 1);
  }

  // Check if all cards have enough correct answers
  const allComplete = state.allFrequencies.every(
    (f) => (state.correctCounts.get(f) ?? 0) >= REQUIRED_CORRECT
  );

  if (allComplete) {
    // Session complete
    state.memoryState = incrementSessionCount(state.memoryState);
    saveState(state.memoryState);
    renderSessionComplete();
  } else {
    advanceToNext();
  }
}

function advanceToNext(): void {
  // Pick next frequency, avoiding the one we just did if possible
  const nextFreq = pickNextFrequency(
    state.allFrequencies,
    state.correctCounts,
    state.currentFrequency
  );
  state.currentFrequency = nextFreq;
  state.currentChoices = getChoices(nextFreq);
  state.eliminatedChoices = new Set();
  state.guessHistory = [];
  state.hasAnswered = false;
  state.wasCorrect = null;
  state.userAnswer = null;
  state.lastFeedback = null;
  state.isNewCard = state.sessionCards.newCards.includes(nextFreq);
  state.inputEnabled = false;
  // Reset timing for new card
  state.startTime = performance.now();
  state.elapsedBeforePause = 0;
  state.pausedAt = document.hidden ? performance.now() : null;
  state.replayTimesMs = [];

  render();
  playCurrentFrequency();
}

async function playCurrentFrequency(): Promise<void> {
  await playFrequency(state.currentFrequency, { duration: NOTE_DURATION });
  state.inputEnabled = true;
}

/**
 * Record a replay and play the frequency again.
 */
async function handleReplay(): Promise<void> {
  // Record replay time (relative to start, excluding paused time)
  state.replayTimesMs.push(Math.round(getElapsedTime()));
  await playCurrentFrequency();
}

function formatFrequency(freq: number): string {
  return `${freq}Hz`;
}

function render(): void {
  const app = document.getElementById("app")!;
  const stats = getStats(state.memoryState);
  const choices = state.currentChoices;

  const choiceButtons = choices
    .map((freq) => {
      let className = "choice-btn freq-choice";
      const isEliminated = state.eliminatedChoices.has(freq);

      if (state.hasAnswered && freq === state.currentFrequency) {
        className += " correct";
      } else if (isEliminated) {
        className += " eliminated";
      }

      return `<button class="${className}" data-freq="${freq}" ${isEliminated ? "disabled" : ""}>${formatFrequency(freq)}</button>`;
    })
    .join("");

  // Show feedback
  let feedbackHtml = "";
  if (state.hasAnswered) {
    feedbackHtml = `<div class="feedback success">Correct! ${formatFrequency(state.currentFrequency)}</div>`;
  } else if (state.lastFeedback) {
    const feedbackText =
      state.lastFeedback === "too-high" ? "Too high!" : "Too low!";
    feedbackHtml = `<div class="feedback error">${feedbackText}</div>`;
  }

  // Only show grade buttons for first-try correct (no retries)
  const showGradeButtons = state.hasAnswered && state.guessHistory.length === 0;
  const afterAnswer = showGradeButtons ? renderGradeButtons() : "";

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Frequency Memorization</h1>
    <p>Listen and identify the frequency.</p>
    <p>Use <strong>number keys 1-4</strong> to select, <strong>R</strong> to replay.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
      </div>

      <div class="freq-choices" id="choice-buttons">
        ${choiceButtons}
      </div>

      ${afterAnswer}

      ${feedbackHtml}

      <div class="stats-row">
        <div class="stats correct-stat">
          <span class="stats-label">Session:</span>
          <span>${state.sessionCorrect}/${state.sessionTotal}</span>
        </div>
        <div class="stats">
          <span class="stats-label">Learned:</span>
          <span>${stats.introduced}/${stats.total}</span>
        </div>
        <div class="stats">
          <span class="stats-label">Sessions:</span>
          <span>${stats.sessionsCompleted}</span>
        </div>
      </div>
    </div>

    <div class="danger-zone">
      <button class="danger-btn" id="clear-history-btn">Clear Progress</button>
      <p class="danger-warning">Reset all learning history</p>
    </div>
  `;

  setupEventListeners();
}

function renderGradeButtons(): string {
  return `
    <div class="grade-buttons">
      <p class="grade-prompt">How well did you know it?</p>
      <div class="grade-btn-row">
        <button class="grade-btn again" data-grade="1">Again</button>
        <button class="grade-btn hard" data-grade="2">Hard</button>
        <button class="grade-btn good" data-grade="3">Good</button>
        <button class="grade-btn easy" data-grade="4">Easy</button>
      </div>
    </div>
  `;
}

function renderSessionComplete(): void {
  const app = document.getElementById("app")!;
  const stats = getStats(state.memoryState);

  const accuracy =
    state.sessionTotal > 0
      ? Math.round((state.sessionCorrect / state.sessionTotal) * 100)
      : 0;

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Session Complete!</h1>

    <div class="exercise-container">
      <div class="session-summary">
        <h2>Results</h2>
        <p>Accuracy: ${state.sessionCorrect}/${state.sessionTotal} (${accuracy}%)</p>
        <p>Frequencies learned: ${stats.introduced}/${stats.total}</p>
        <p>Total sessions: ${stats.sessionsCompleted}</p>
        <p>Total reviews: ${stats.totalReviews}</p>
      </div>

      <div class="session-actions">
        <button class="play-again-btn" id="new-session-btn">Start New Session</button>
        <a href="#/" class="back-link">Return to Exercises</a>
      </div>
    </div>
  `;

  const newSessionBtn = document.getElementById("new-session-btn");
  newSessionBtn?.addEventListener("click", () => {
    initExercise();
    render();
    playCurrentFrequency();
  });

  // Clean up handlers
  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
    keyboardHandler = null;
  }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

function setupEventListeners(): void {
  const choices = state.currentChoices;
  const playBtn = document.getElementById("play-btn");
  playBtn?.addEventListener("click", () => {
    handleReplay();
  });

  const choiceButtons = document.querySelectorAll(".freq-choice");
  choiceButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.hasAnswered) {
        const freq = parseInt((btn as HTMLElement).dataset.freq || "0", 10);
        handleAnswer(freq);
      }
    });
  });

  // Grade buttons (only shown when correct)
  const gradeButtons = document.querySelectorAll(".grade-btn");
  gradeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const grade = parseInt(
        (btn as HTMLElement).dataset.grade || "3",
        10
      ) as Grade;
      handleGrade(grade);
    });
  });

  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
  }

  keyboardHandler = (e: KeyboardEvent) => {
    if (e.repeat) return;

    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      handleReplay();
      return;
    }

    const num = parseInt(e.key, 10);

    if (!state.hasAnswered) {
      // Number keys 1-4 for choices (handleAnswer checks if eliminated)
      if (num >= 1 && num <= 4 && num <= choices.length) {
        e.preventDefault();
        handleAnswer(choices[num - 1]);
      }
    } else {
      // After correct answer, 1-4 for grades
      if (num >= 1 && num <= 4) {
        e.preventDefault();
        handleGrade(num as Grade);
      }
    }
  };

  document.addEventListener("keydown", keyboardHandler);

  const cleanupOnNavigate = () => {
    if (keyboardHandler) {
      document.removeEventListener("keydown", keyboardHandler);
      keyboardHandler = null;
    }
    if (visibilityHandler) {
      document.removeEventListener("visibilitychange", visibilityHandler);
      visibilityHandler = null;
    }
    window.removeEventListener("hashchange", cleanupOnNavigate);
  };
  window.addEventListener("hashchange", cleanupOnNavigate);

  // Clear history button
  const clearHistoryBtn = document.getElementById("clear-history-btn");
  clearHistoryBtn?.addEventListener("click", () => {
    if (
      confirm(
        "Are you sure you want to clear ALL progress? This cannot be undone."
      )
    ) {
      clearAllProgress();
      initExercise();
      render();
      playCurrentFrequency();
    }
  });
}

export async function renderFreqMemorize(): Promise<void> {
  initExercise();
  render();
  await playCurrentFrequency();
  state.inputEnabled = true;
}
