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
  currentQueue: number[]; // Frequencies to practice this session
  currentIndex: number;
  currentFrequency: number;
  hasAnswered: boolean;
  wasCorrect: boolean | null;
  userAnswer: number | null;
  sessionCorrect: number;
  sessionTotal: number;
  inputEnabled: boolean;
  isNewCard: boolean;
}

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

function initExercise(): void {
  const memoryState = loadState();
  const sessionCards = selectSessionCards(memoryState);

  // Build queue: new cards first (interleaved), then reviews
  const queue: number[] = [];

  // Interleave new cards with reviews for better learning
  if (sessionCards.isFirstSession) {
    // First session: just the three initial cards
    queue.push(...sessionCards.newCards);
  } else {
    // Mix: splitting review, new card, review, new card, review
    if (sessionCards.splittingCard) {
      queue.push(sessionCards.splittingCard);
    }
    if (sessionCards.newCards[0]) queue.push(sessionCards.newCards[0]);
    if (sessionCards.reviewCards[1]) queue.push(sessionCards.reviewCards[1]);
    if (sessionCards.newCards[1]) queue.push(sessionCards.newCards[1]);
    if (sessionCards.reviewCards[2]) queue.push(sessionCards.reviewCards[2]);

    // Add any remaining reviews
    for (const freq of sessionCards.reviewCards) {
      if (!queue.includes(freq)) queue.push(freq);
    }
  }

  state = {
    memoryState,
    sessionCards,
    currentQueue: queue,
    currentIndex: 0,
    currentFrequency: queue[0] || 0,
    hasAnswered: false,
    wasCorrect: null,
    userAnswer: null,
    sessionCorrect: 0,
    sessionTotal: 0,
    inputEnabled: false,
    isNewCard: sessionCards.newCards.includes(queue[0]),
  };
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

  // Shuffle final choices
  return choices.sort(() => Math.random() - 0.5);
}

function handleAnswer(answer: number): void {
  if (state.hasAnswered || !state.inputEnabled) return;

  state.hasAnswered = true;
  state.userAnswer = answer;
  state.wasCorrect = answer === state.currentFrequency;
  state.sessionTotal++;

  if (state.wasCorrect) {
    state.sessionCorrect++;
  }

  render();
}

function handleGrade(grade: Grade): void {
  // Record the review
  state.memoryState = recordReview(
    state.memoryState,
    state.currentFrequency,
    grade
  );
  saveState(state.memoryState);

  // Move to next card
  state.currentIndex++;

  if (state.currentIndex >= state.currentQueue.length) {
    // Session complete
    state.memoryState = incrementSessionCount(state.memoryState);
    saveState(state.memoryState);
    renderSessionComplete();
  } else {
    advanceToNext();
  }
}

function advanceToNext(): void {
  const nextFreq = state.currentQueue[state.currentIndex];
  state.currentFrequency = nextFreq;
  state.hasAnswered = false;
  state.wasCorrect = null;
  state.userAnswer = null;
  state.isNewCard = state.sessionCards.newCards.includes(nextFreq);
  state.inputEnabled = false;

  render();
  playCurrentFrequency();
}

async function playCurrentFrequency(): Promise<void> {
  await playFrequency(state.currentFrequency, { duration: NOTE_DURATION });
  state.inputEnabled = true;
}

function formatFrequency(freq: number): string {
  return `${freq}Hz`;
}

function render(): void {
  const app = document.getElementById("app")!;
  const stats = getStats(state.memoryState);
  const choices = getChoices(state.currentFrequency);

  const progress = `${state.currentIndex + 1}/${state.currentQueue.length}`;
  const cardType = state.isNewCard ? "NEW" : "Review";

  const choiceButtons = choices
    .map((freq) => {
      let className = "choice-btn freq-choice";
      if (state.hasAnswered) {
        if (freq === state.currentFrequency) {
          className += " correct";
        } else if (freq === state.userAnswer) {
          className += " incorrect";
        }
      }
      return `<button class="${className}" data-freq="${freq}">${formatFrequency(freq)}</button>`;
    })
    .join("");

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Frequency Memorization</h1>
    <p>Listen and identify the frequency. Card ${progress} (${cardType})</p>
    <p>Use <strong>number keys 1-4</strong> to select, <strong>R</strong> to replay.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
      </div>

      <div class="freq-choices" id="choice-buttons">
        ${choiceButtons}
      </div>

      ${state.hasAnswered ? renderGradeButtons() : ""}

      <div id="feedback"></div>

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

  renderFeedback();
  setupEventListeners(choices);
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

function renderFeedback(): void {
  const feedback = document.getElementById("feedback");
  if (!feedback) return;

  if (!state.hasAnswered) {
    feedback.className = "";
    feedback.textContent = "";
    return;
  }

  if (state.wasCorrect) {
    feedback.className = "feedback success";
    feedback.textContent = `Correct! The frequency was ${formatFrequency(state.currentFrequency)}.`;
  } else {
    feedback.className = "feedback error";
    feedback.textContent = `Wrong! The frequency was ${formatFrequency(state.currentFrequency)}, not ${formatFrequency(state.userAnswer!)}.`;
  }
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

  // Clean up keyboard handler
  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
    keyboardHandler = null;
  }
}

function setupEventListeners(choices: number[]): void {
  const playBtn = document.getElementById("play-btn");
  playBtn?.addEventListener("click", () => {
    playCurrentFrequency();
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

  // Grade buttons
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
      playCurrentFrequency();
      return;
    }

    if (!state.hasAnswered) {
      // Number keys 1-4 for choices
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 4 && num <= choices.length) {
        e.preventDefault();
        handleAnswer(choices[num - 1]);
      }
    } else {
      // After answering, 1-4 for grades
      const num = parseInt(e.key, 10);
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
