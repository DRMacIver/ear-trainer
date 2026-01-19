/**
 * Note-Frequency Quiz Exercise
 *
 * Spaced repetition training for note-frequency mapping across octaves 3, 4, 5.
 * Two question types:
 * - freqToNote: "This is 440Hz. Which note is it?"
 * - noteToFreq: "This is A4. Which frequency is it?"
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
  getNearbyNotes,
  getNearbyFrequencies,
  getOctave,
  getIntroducedNotes,
  NoteFreqMemoryState,
  SessionCards,
  QuizDirection,
} from "../lib/note-freq-memory.js";

const NOTE_DURATION = 0.8;

interface CurrentCard {
  note: string;
  direction: QuizDirection;
  frequency: number;
  octave: number;
  isNew: boolean;
}

interface ExerciseState {
  memoryState: NoteFreqMemoryState;
  sessionCards: SessionCards;
  allCards: CurrentCard[];
  allowedNotes: string[];
  correctCounts: Map<string, number>;
  currentCard: CurrentCard;
  currentChoices: (string | number)[];
  eliminatedChoices: Set<string | number>;
  guessHistory: (string | number)[];
  hasAnswered: boolean;
  wasCorrect: boolean | null;
  userAnswer: string | number | null;
  lastFeedback: "too-high" | "too-low" | null;
  sessionCorrect: number;
  sessionTotal: number;
  inputEnabled: boolean;
  startTime: number;
  elapsedBeforePause: number;
  pausedAt: number | null;
  replayTimesMs: number[];
  playingSequence: boolean;
  highlightedChoice: string | number | null;
  sequenceComplete: boolean;
}

const REQUIRED_CORRECT = 2;

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
let visibilityHandler: (() => void) | null = null;

function cardKey(note: string, direction: QuizDirection): string {
  return `${note}:${direction}`;
}

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

function buildSessionCards(sessionCards: SessionCards): CurrentCard[] {
  const cards: CurrentCard[] = [];

  // Add cards for new notes (both directions)
  for (const note of sessionCards.newNotes) {
    const frequency = getFrequencyForNote(note);
    const octave = getOctave(note);
    cards.push({
      note,
      direction: "freqToNote",
      frequency,
      octave,
      isNew: true,
    });
    cards.push({
      note,
      direction: "noteToFreq",
      frequency,
      octave,
      isNew: true,
    });
  }

  // Add review cards
  for (const reviewCard of sessionCards.reviewCards) {
    const frequency = getFrequencyForNote(reviewCard.note);
    cards.push({
      note: reviewCard.note,
      direction: reviewCard.direction,
      frequency,
      octave: getOctave(reviewCard.note),
      isNew: false,
    });
  }

  return cards;
}

function pickNextCard(
  allCards: CurrentCard[],
  correctCounts: Map<string, number>,
  excludeKey?: string
): CurrentCard {
  const needsWork = allCards.filter((card) => {
    const key = cardKey(card.note, card.direction);
    return (
      (correctCounts.get(key) ?? 0) < REQUIRED_CORRECT && key !== excludeKey
    );
  });

  if (needsWork.length === 0) {
    return allCards[0];
  }

  needsWork.sort((a, b) => {
    const countA = correctCounts.get(cardKey(a.note, a.direction)) ?? 0;
    const countB = correctCounts.get(cardKey(b.note, b.direction)) ?? 0;
    if (countA !== countB) return countA - countB;
    return Math.random() - 0.5;
  });

  return needsWork[0];
}

function getChoices(
  card: CurrentCard,
  allowedNotes: string[]
): (string | number)[] {
  if (card.direction === "freqToNote") {
    return getNearbyNotes(card.note, 4, allowedNotes);
  } else {
    return getNearbyFrequencies(card.frequency, 4, allowedNotes);
  }
}

function initExercise(): void {
  const memoryState = loadState();
  const sessionCards = selectSessionCards(memoryState);
  const allCards = buildSessionCards(sessionCards);

  // Allowed notes = introduced + session new notes
  const introduced = getIntroducedNotes(memoryState);
  const allowedNotes = [...new Set([...introduced, ...sessionCards.newNotes])];

  const correctCounts = new Map<string, number>();
  for (const card of allCards) {
    correctCounts.set(cardKey(card.note, card.direction), 0);
  }

  const firstCard = pickNextCard(allCards, correctCounts);
  state = {
    memoryState,
    sessionCards,
    allCards,
    allowedNotes,
    correctCounts,
    currentCard: firstCard,
    currentChoices: getChoices(firstCard, allowedNotes),
    eliminatedChoices: new Set(),
    guessHistory: [],
    hasAnswered: false,
    wasCorrect: null,
    userAnswer: null,
    lastFeedback: null,
    sessionCorrect: 0,
    sessionTotal: 0,
    inputEnabled: false,
    startTime: performance.now(),
    elapsedBeforePause: 0,
    pausedAt: document.hidden ? performance.now() : null,
    replayTimesMs: [],
    playingSequence: false,
    highlightedChoice: null,
    sequenceComplete: false,
  };

  setupVisibilityHandler();
}

function getCorrectAnswer(): string | number {
  if (state.currentCard.direction === "freqToNote") {
    return state.currentCard.note;
  } else {
    return state.currentCard.frequency;
  }
}

function isCorrectAnswer(answer: string | number): boolean {
  return answer === getCorrectAnswer();
}

function handleAnswer(answer: string | number): void {
  if (state.hasAnswered || !state.inputEnabled) return;
  if (state.eliminatedChoices.has(answer)) return;

  state.userAnswer = answer;

  if (isCorrectAnswer(answer)) {
    state.hasAnswered = true;
    state.wasCorrect = true;
    state.lastFeedback = null;
    state.sessionTotal++;

    if (state.guessHistory.length === 0) {
      state.sessionCorrect++;
    }

    if (state.guessHistory.length > 0) {
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

    // Determine too high/low
    let isTooHigh: boolean;
    if (state.currentCard.direction === "freqToNote") {
      const noteOrder = [
        "C",
        "C#",
        "D",
        "D#",
        "E",
        "F",
        "F#",
        "G",
        "G#",
        "A",
        "A#",
        "B",
      ];
      const getIndex = (n: string) => noteOrder.indexOf(n.replace(/\d+$/, ""));
      isTooHigh = getIndex(answer as string) > getIndex(state.currentCard.note);
    } else {
      isTooHigh = (answer as number) > state.currentCard.frequency;
    }
    state.lastFeedback = isTooHigh ? "too-high" : "too-low";

    // Eliminate choices
    for (const choice of state.currentChoices) {
      if (state.currentCard.direction === "freqToNote") {
        const noteOrder = [
          "C",
          "C#",
          "D",
          "D#",
          "E",
          "F",
          "F#",
          "G",
          "G#",
          "A",
          "A#",
          "B",
        ];
        const getIndex = (n: string) =>
          noteOrder.indexOf(n.replace(/\d+$/, ""));
        const choiceIdx = getIndex(choice as string);
        const answerIdx = getIndex(answer as string);
        if (isTooHigh && choiceIdx >= answerIdx) {
          state.eliminatedChoices.add(choice);
        } else if (!isTooHigh && choiceIdx <= answerIdx) {
          state.eliminatedChoices.add(choice);
        }
      } else {
        if (isTooHigh && (choice as number) >= (answer as number)) {
          state.eliminatedChoices.add(choice);
        } else if (!isTooHigh && (choice as number) <= (answer as number)) {
          state.eliminatedChoices.add(choice);
        }
      }
    }

    render();
  }
}

function handleGrade(grade: Grade): void {
  const timeMs = Math.round(getElapsedTime());
  const guessHistory =
    state.currentCard.direction === "freqToNote"
      ? (state.guessHistory as string[])
      : (state.guessHistory as number[]);

  state.memoryState = recordReview(
    state.memoryState,
    state.currentCard.note,
    state.currentCard.direction,
    grade,
    {
      guessHistory,
      timeMs,
      replayTimesMs: state.replayTimesMs,
    }
  );
  saveState(state.memoryState);

  if (state.wasCorrect && state.guessHistory.length === 0) {
    const key = cardKey(state.currentCard.note, state.currentCard.direction);
    const current = state.correctCounts.get(key) ?? 0;
    state.correctCounts.set(key, current + 1);
  }

  const allComplete = state.allCards.every((card) => {
    const key = cardKey(card.note, card.direction);
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
  const currentKey = cardKey(
    state.currentCard.note,
    state.currentCard.direction
  );
  const nextCard = pickNextCard(
    state.allCards,
    state.correctCounts,
    currentKey
  );

  state.currentCard = nextCard;
  state.currentChoices = getChoices(nextCard, state.allowedNotes);
  state.eliminatedChoices = new Set();
  state.guessHistory = [];
  state.hasAnswered = false;
  state.wasCorrect = null;
  state.userAnswer = null;
  state.lastFeedback = null;
  state.inputEnabled = false;
  state.startTime = performance.now();
  state.elapsedBeforePause = 0;
  state.pausedAt = document.hidden ? performance.now() : null;
  state.replayTimesMs = [];
  state.playingSequence = false;
  state.highlightedChoice = null;
  state.sequenceComplete = false;

  render();
  playCurrentFrequency();
}

async function playCurrentFrequency(): Promise<void> {
  await playFrequency(state.currentCard.frequency, { duration: NOTE_DURATION });
  state.inputEnabled = true;
}

async function handleReplay(): Promise<void> {
  state.replayTimesMs.push(Math.round(getElapsedTime()));
  await playCurrentFrequency();
}

async function playLearningSequence(): Promise<void> {
  state.playingSequence = true;
  state.sequenceComplete = false;
  render();

  const GAP_MS = 300;

  for (const choice of state.currentChoices) {
    state.highlightedChoice = choice;
    render();

    let freq: number;
    if (state.currentCard.direction === "freqToNote") {
      freq = getFrequencyForNote(choice as string);
    } else {
      freq = choice as number;
    }

    await playFrequency(freq, { duration: NOTE_DURATION });
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  state.highlightedChoice = getCorrectAnswer();
  render();
  await playFrequency(state.currentCard.frequency, { duration: NOTE_DURATION });

  state.playingSequence = false;
  state.highlightedChoice = null;
  state.sequenceComplete = true;
  render();
}

function formatChoice(choice: string | number): string {
  if (typeof choice === "number") {
    return `${choice}Hz`;
  }
  return choice;
}

function render(): void {
  const app = document.getElementById("app")!;
  const stats = getStats(state.memoryState);
  const choices = state.currentChoices;
  const correctAnswer = getCorrectAnswer();

  // Build question with prominent key value
  let questionHtml: string;
  if (state.currentCard.direction === "freqToNote") {
    questionHtml = `<span class="question-value">${state.currentCard.frequency}Hz</span><br>Which note is it?`;
  } else {
    questionHtml = `<span class="question-value">${state.currentCard.note}</span><br>Which frequency is it?`;
  }

  const choiceButtons = choices
    .map((choice, idx) => {
      let className = "choice-btn nf-choice";
      const isEliminated = state.eliminatedChoices.has(choice);
      const isCorrect = state.hasAnswered && choice === correctAnswer;
      const isDisabled =
        isEliminated || state.playingSequence || state.sequenceComplete;

      if (state.highlightedChoice === choice) {
        className += " highlighted";
      } else if (isCorrect) {
        className += " correct";
      } else if (isEliminated) {
        className += " eliminated";
      }

      return `<button class="${className}" data-choice="${choice}" data-idx="${idx}" ${isDisabled ? "disabled" : ""}>${formatChoice(choice)}</button>`;
    })
    .join("");

  // Feedback
  let feedbackHtml = "";
  if (state.playingSequence) {
    feedbackHtml = `<div class="feedback">Playing sequence...</div>`;
  } else if (state.sequenceComplete) {
    feedbackHtml = `<div class="feedback success">The answer was ${formatChoice(correctAnswer)}</div>`;
  } else if (state.hasAnswered) {
    feedbackHtml = `<div class="feedback success">Correct!</div>`;
  } else if (state.lastFeedback) {
    const feedbackText =
      state.lastFeedback === "too-high" ? "Too high!" : "Too low!";
    feedbackHtml = `<div class="feedback error">${feedbackText}</div>`;
  }

  let afterAnswer = "";
  if (state.sequenceComplete) {
    afterAnswer = `
      <div class="sequence-controls">
        <button class="choice-btn" id="replay-sequence-btn">Replay Sequence</button>
        <button class="choice-btn" id="continue-btn">Continue</button>
      </div>
    `;
  } else if (state.hasAnswered && state.guessHistory.length === 0) {
    afterAnswer = renderGradeButtons();
  }

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Note-Frequency Quiz</h1>

    <div class="exercise-container">
      <div class="nf-question-block">
        <div class="nf-question">${questionHtml}</div>
        <button class="play-again-btn" id="play-btn">Play Again (R)</button>
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
          <span class="stats-label">Progress:</span>
          <span>${stats.introducedNotes}/${stats.totalNotes} notes</span>
        </div>
        <div class="stats">
          <span class="stats-label">Sessions:</span>
          <span>${stats.sessionsCompleted}</span>
        </div>
      </div>

      <p class="keyboard-hint">Keys 1-${choices.length} to select</p>
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
        <p>Notes learned: ${stats.introducedNotes}/${stats.totalNotes}</p>
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

  const choiceButtons = document.querySelectorAll(".nf-choice");
  choiceButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.hasAnswered) {
        const choiceStr = (btn as HTMLElement).dataset.choice || "";
        let choice: string | number;
        if (state.currentCard.direction === "noteToFreq") {
          choice = parseInt(choiceStr, 10);
        } else {
          choice = choiceStr;
        }
        handleAnswer(choice);
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
    playLearningSequence();
  });

  const continueBtn = document.getElementById("continue-btn");
  continueBtn?.addEventListener("click", () => {
    handleGrade(Grade.AGAIN);
  });

  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
  }

  keyboardHandler = (e: KeyboardEvent) => {
    if (e.repeat) return;

    if (state.playingSequence) return;

    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      if (state.sequenceComplete) {
        playLearningSequence();
      } else {
        handleReplay();
      }
      return;
    }

    if (
      state.sequenceComplete &&
      (e.key === "Enter" || e.key === "c" || e.key === "C")
    ) {
      e.preventDefault();
      handleGrade(Grade.AGAIN);
      return;
    }

    const num = parseInt(e.key, 10);

    if (!state.hasAnswered) {
      if (num >= 1 && num <= choices.length) {
        e.preventDefault();
        handleAnswer(choices[num - 1]);
      }
    } else if (!state.sequenceComplete && state.guessHistory.length === 0) {
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
      playCurrentFrequency();
    }
  });
}

export async function renderNoteFreqQuiz(): Promise<void> {
  initExercise();
  render();
  await playCurrentFrequency();
  state.inputEnabled = true;
}
