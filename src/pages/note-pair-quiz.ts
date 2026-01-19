/**
 * Note Pair Ordering Quiz Exercise
 *
 * Two notes play in sequence and the user identifies which note came first.
 * Standard FSRS grading for spaced repetition.
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
  getFrequencyForNote,
  getNoteFamily,
  NotePairMemoryState,
  SessionCards,
  NotePairCard,
} from "../lib/note-pair-memory.js";

const NOTE_DURATION = 0.8;
const SEQUENCE_GAP_MS = 400;

interface CurrentQuestion {
  card: NotePairCard;
  isNew: boolean;
}

interface ExerciseState {
  memoryState: NotePairMemoryState;
  sessionCards: SessionCards;
  allQuestions: CurrentQuestion[];
  correctCounts: Map<string, number>;
  currentQuestion: CurrentQuestion;
  currentChoices: [string, string]; // [familyA, familyB]
  guessHistory: string[];
  hasAnswered: boolean;
  wasCorrect: boolean | null;
  userAnswer: string | null;
  sessionCorrect: number;
  sessionTotal: number;
  inputEnabled: boolean;
  startTime: number;
  elapsedBeforePause: number;
  pausedAt: number | null;
  replayTimesMs: number[];
  playingSequence: boolean;
  playingLearning: boolean;
  highlightedChoice: string | null;
}

const REQUIRED_CORRECT = 2;

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
let visibilityHandler: (() => void) | null = null;

function getElapsedTime(): number {
  if (state.pausedAt !== null) {
    return state.elapsedBeforePause;
  }
  return state.elapsedBeforePause + (performance.now() - state.startTime);
}

function setupVisibilityHandler(): void {
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
  }

  visibilityHandler = () => {
    if (document.hidden) {
      if (state.pausedAt === null) {
        state.elapsedBeforePause += performance.now() - state.startTime;
        state.pausedAt = performance.now();
      }
    } else {
      if (state.pausedAt !== null) {
        state.startTime = performance.now();
        state.pausedAt = null;
      }
    }
  };

  document.addEventListener("visibilitychange", visibilityHandler);
}

function buildSessionQuestions(sessionCards: SessionCards): CurrentQuestion[] {
  const questions: CurrentQuestion[] = [];

  for (const card of sessionCards.newCards) {
    questions.push({ card, isNew: true });
  }

  for (const card of sessionCards.reviewCards) {
    questions.push({ card, isNew: false });
  }

  return questions;
}

function pickNextQuestion(
  allQuestions: CurrentQuestion[],
  correctCounts: Map<string, number>,
  excludeId?: string
): CurrentQuestion {
  const needsWork = allQuestions.filter((q) => {
    const key = q.card.id;
    return (
      (correctCounts.get(key) ?? 0) < REQUIRED_CORRECT && key !== excludeId
    );
  });

  if (needsWork.length === 0) {
    return allQuestions[0];
  }

  needsWork.sort((a, b) => {
    const countA = correctCounts.get(a.card.id) ?? 0;
    const countB = correctCounts.get(b.card.id) ?? 0;
    if (countA !== countB) return countA - countB;
    return Math.random() - 0.5;
  });

  return needsWork[0];
}

function getChoices(card: NotePairCard): [string, string] {
  const familyA = getNoteFamily(card.noteA);
  const familyB = getNoteFamily(card.noteB);
  // Randomize the order of presentation
  if (Math.random() < 0.5) {
    return [familyA, familyB];
  }
  return [familyB, familyA];
}

function getCorrectAnswer(card: NotePairCard): string {
  return getNoteFamily(card.noteA);
}

function initExercise(): void {
  const memoryState = loadState();
  const sessionCards = selectSessionCards(memoryState);
  const allQuestions = buildSessionQuestions(sessionCards);

  const correctCounts = new Map<string, number>();
  for (const question of allQuestions) {
    correctCounts.set(question.card.id, 0);
  }

  const firstQuestion = pickNextQuestion(allQuestions, correctCounts);
  state = {
    memoryState,
    sessionCards,
    allQuestions,
    correctCounts,
    currentQuestion: firstQuestion,
    currentChoices: getChoices(firstQuestion.card),
    guessHistory: [],
    hasAnswered: false,
    wasCorrect: null,
    userAnswer: null,
    sessionCorrect: 0,
    sessionTotal: 0,
    inputEnabled: false,
    startTime: performance.now(),
    elapsedBeforePause: 0,
    pausedAt: document.hidden ? performance.now() : null,
    replayTimesMs: [],
    playingSequence: false,
    playingLearning: false,
    highlightedChoice: null,
  };

  setupVisibilityHandler();
}

function isCorrectAnswer(answer: string): boolean {
  return answer === getCorrectAnswer(state.currentQuestion.card);
}

function handleAnswer(answer: string): void {
  if (state.hasAnswered || !state.inputEnabled) return;

  state.userAnswer = answer;

  if (isCorrectAnswer(answer)) {
    state.hasAnswered = true;
    state.wasCorrect = true;
    state.sessionTotal++;

    if (state.guessHistory.length === 0) {
      state.sessionCorrect++;
    }

    if (state.guessHistory.length > 0) {
      // Play learning sequence after mistakes
      render();
      setTimeout(() => {
        playLearningSequence();
      }, 500);
    } else {
      render();
    }
  } else {
    state.guessHistory.push(answer);
    state.wasCorrect = false;
    state.hasAnswered = true;
    state.sessionTotal++;

    render();

    // Play learning sequence to teach the difference
    setTimeout(() => {
      playLearningSequence();
    }, 500);
  }
}

function handleGrade(grade: Grade): void {
  const timeMs = Math.round(getElapsedTime());

  state.memoryState = recordReview(
    state.memoryState,
    state.currentQuestion.card.id,
    grade,
    {
      guessHistory: state.guessHistory,
      timeMs,
      replayTimesMs: state.replayTimesMs,
    }
  );

  saveState(state.memoryState);

  if (state.wasCorrect && state.guessHistory.length === 0) {
    const key = state.currentQuestion.card.id;
    const current = state.correctCounts.get(key) ?? 0;
    state.correctCounts.set(key, current + 1);
  }

  const allComplete = state.allQuestions.every((q) => {
    const key = q.card.id;
    return (state.correctCounts.get(key) ?? 0) >= REQUIRED_CORRECT;
  });

  if (allComplete) {
    state.memoryState = incrementSessionCount(state.memoryState);
    saveState(state.memoryState);
    renderSessionComplete();
  } else {
    advanceToNext();
  }
}

function advanceToNext(): void {
  const currentId = state.currentQuestion.card.id;
  const nextQuestion = pickNextQuestion(
    state.allQuestions,
    state.correctCounts,
    currentId
  );

  state.currentQuestion = nextQuestion;
  state.currentChoices = getChoices(nextQuestion.card);
  state.guessHistory = [];
  state.hasAnswered = false;
  state.wasCorrect = null;
  state.userAnswer = null;
  state.inputEnabled = false;
  state.startTime = performance.now();
  state.elapsedBeforePause = 0;
  state.pausedAt = document.hidden ? performance.now() : null;
  state.replayTimesMs = [];
  state.playingSequence = false;
  state.playingLearning = false;
  state.highlightedChoice = null;

  render();
  playCurrentSound();
}

async function playCurrentSound(): Promise<void> {
  const card = state.currentQuestion.card;

  state.playingSequence = true;
  render();

  // Play first note
  const freqA = getFrequencyForNote(card.noteA);
  await playFrequency(freqA, { duration: NOTE_DURATION });

  // Gap
  await new Promise((r) => setTimeout(r, SEQUENCE_GAP_MS));

  // Play second note
  const freqB = getFrequencyForNote(card.noteB);
  await playFrequency(freqB, { duration: NOTE_DURATION });

  state.playingSequence = false;
  state.inputEnabled = true;
  render();
}

async function handleReplay(): Promise<void> {
  state.replayTimesMs.push(Math.round(getElapsedTime()));
  await playCurrentSound();
}

/**
 * Play learning sequence: wrong note, then correct note, then both in order.
 */
async function playLearningSequence(): Promise<void> {
  state.playingLearning = true;
  state.inputEnabled = false;
  render();

  const card = state.currentQuestion.card;
  const correctFamily = getNoteFamily(card.noteA);
  const wrongFamily = getNoteFamily(card.noteB);

  // Play the wrong note (what they might have chosen)
  state.highlightedChoice = wrongFamily;
  render();
  const wrongFreq = getFrequencyForNote(card.noteB);
  await playFrequency(wrongFreq, { duration: NOTE_DURATION });
  await new Promise((r) => setTimeout(r, SEQUENCE_GAP_MS));

  // Play the correct note (what actually played first)
  state.highlightedChoice = correctFamily;
  render();
  const correctFreq = getFrequencyForNote(card.noteA);
  await playFrequency(correctFreq, { duration: NOTE_DURATION });
  await new Promise((r) => setTimeout(r, SEQUENCE_GAP_MS * 2));

  // Play both in order
  state.highlightedChoice = null;
  render();
  await playFrequency(correctFreq, { duration: NOTE_DURATION });
  await new Promise((r) => setTimeout(r, SEQUENCE_GAP_MS));
  await playFrequency(wrongFreq, { duration: NOTE_DURATION });

  state.playingLearning = false;
  render();
}

/**
 * Play a single note (for exploration after answering).
 */
async function playNoteChoice(family: string): Promise<void> {
  const card = state.currentQuestion.card;
  const familyA = getNoteFamily(card.noteA);
  const note = family === familyA ? card.noteA : card.noteB;

  state.highlightedChoice = family;
  render();

  const freq = getFrequencyForNote(note);
  await playFrequency(freq, { duration: NOTE_DURATION });

  state.highlightedChoice = null;
  render();
}

function render(): void {
  const app = document.getElementById("app")!;
  const stats = getStats(state.memoryState);
  const card = state.currentQuestion.card;
  const choices = state.currentChoices;
  const correctAnswer = getCorrectAnswer(card);

  const choiceButtons = choices
    .map((choice, idx) => {
      let className = "choice-btn nf-choice";
      const isCorrect = state.hasAnswered && choice === correctAnswer;
      const isWrong =
        state.hasAnswered &&
        choice !== correctAnswer &&
        state.guessHistory.includes(choice);

      const isDisabled =
        state.playingSequence || state.playingLearning || !state.inputEnabled;

      if (state.highlightedChoice === choice) {
        className += " highlighted";
      } else if (isCorrect && state.hasAnswered) {
        className += " correct";
      } else if (isWrong) {
        className += " eliminated";
      }

      const isExploration = state.hasAnswered && !state.playingLearning;
      return `<button class="${className}" data-choice="${choice}" data-idx="${idx}" data-exploration="${isExploration}" ${isDisabled && !isExploration ? "disabled" : ""}>${choice}</button>`;
    })
    .join("");

  // Feedback
  let feedbackHtml = "";
  if (state.playingSequence) {
    feedbackHtml = `<div class="feedback">Playing...</div>`;
  } else if (state.playingLearning) {
    feedbackHtml = `<div class="feedback">Listen to the difference...</div>`;
  } else if (state.hasAnswered) {
    if (state.wasCorrect && state.guessHistory.length === 0) {
      feedbackHtml = `<div class="feedback success">Correct! Click notes to compare.</div>`;
    } else if (state.wasCorrect) {
      feedbackHtml = `<div class="feedback success">Correct! The answer was ${correctAnswer}.</div>`;
    } else {
      feedbackHtml = `<div class="feedback error">Incorrect. ${correctAnswer} played first.</div>`;
    }
  }

  let afterAnswer = "";
  if (state.hasAnswered && !state.playingLearning) {
    if (state.wasCorrect && state.guessHistory.length === 0) {
      afterAnswer = renderGradeButtons();
    } else {
      // Wrong answer or correct with previous mistakes
      afterAnswer = `
        <div class="sequence-controls">
          <button class="choice-btn" id="replay-sequence-btn">Replay Sequence</button>
          <button class="choice-btn" id="continue-btn">Continue</button>
        </div>
      `;
    }
  }

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Note Pair Ordering</h1>

    <div class="exercise-container">
      <div class="nf-question-block">
        <div class="nf-question">Which note played first?</div>
        <button class="play-again-btn" id="play-btn" ${state.playingSequence || state.playingLearning ? "disabled" : ""}>Play Again (R)</button>
      </div>

      ${feedbackHtml}

      <div class="nf-choices" id="choice-buttons">
        ${choiceButtons}
      </div>

      ${afterAnswer}

      <div class="stats-row">
        <div class="stats correct-stat">
          <span class="stats-label">Session:</span>
          <span>${state.sessionCorrect}/${state.sessionTotal}</span>
        </div>
        <div class="stats">
          <span class="stats-label">Pairs:</span>
          <span>${stats.introducedPairs}/${stats.totalPairs}</span>
        </div>
        <div class="stats">
          <span class="stats-label">Sessions:</span>
          <span>${stats.sessionsCompleted}</span>
        </div>
      </div>

      <p class="keyboard-hint">Keys 1-2 to select, R to replay</p>
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
        <p>Pairs introduced: ${stats.introducedPairs}/${stats.totalPairs}</p>
        <p>Cards practiced: ${stats.introducedCards}/${stats.totalCards}</p>
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
    playCurrentSound();
  });

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
    if (!state.playingSequence && !state.playingLearning) {
      handleReplay();
    }
  });

  const choiceButtons = document.querySelectorAll(".nf-choice");
  choiceButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const choice = (btn as HTMLElement).dataset.choice || "";
      const isExploration = (btn as HTMLElement).dataset.exploration === "true";

      if (!state.hasAnswered) {
        handleAnswer(choice);
      } else if (isExploration && !state.playingLearning) {
        playNoteChoice(choice);
      }
    });
  });

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

  const replaySeqBtn = document.getElementById("replay-sequence-btn");
  replaySeqBtn?.addEventListener("click", () => {
    if (!state.playingLearning) {
      playLearningSequence();
    }
  });

  const continueBtn = document.getElementById("continue-btn");
  continueBtn?.addEventListener("click", () => {
    const grade = state.wasCorrect ? Grade.HARD : Grade.AGAIN;
    handleGrade(grade);
  });

  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
  }

  keyboardHandler = (e: KeyboardEvent) => {
    if (e.repeat) return;

    if (state.playingSequence || state.playingLearning) return;

    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      if (state.hasAnswered && !state.wasCorrect) {
        playLearningSequence();
      } else if (!state.hasAnswered) {
        handleReplay();
      }
      return;
    }

    if (
      state.hasAnswered &&
      (e.key === "Enter" || e.key === "c" || e.key === "C")
    ) {
      e.preventDefault();
      if (state.wasCorrect && state.guessHistory.length === 0) {
        // Grade buttons are shown - do nothing
      } else {
        const grade = state.wasCorrect ? Grade.HARD : Grade.AGAIN;
        handleGrade(grade);
      }
      return;
    }

    const num = parseInt(e.key, 10);

    if (!state.hasAnswered) {
      if (num >= 1 && num <= choices.length) {
        e.preventDefault();
        handleAnswer(choices[num - 1]);
      }
    } else if (state.wasCorrect && state.guessHistory.length === 0) {
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
      playCurrentSound();
    }
  });
}

export async function renderNotePairQuiz(): Promise<void> {
  initExercise();
  render();
  await playCurrentSound();
  state.inputEnabled = true;
}
