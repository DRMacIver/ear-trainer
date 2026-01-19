/**
 * Tone Quiz Exercise
 *
 * Two tones play. User identifies which one was a particular note.
 * Features adaptive learning with stickiness and progressive difficulty.
 */

import { playNote } from "../audio.js";
import {
  loadState,
  saveState,
  clearState,
  randomizeOrder,
  recordQuestion,
  selectTargetNote,
  selectOtherNote,
  updateStreak,
  ToneQuizState,
  FullTone,
  STREAK_LENGTH,
} from "../lib/tone-quiz-state.js";

const NOTE_DURATION = 0.6;
const GAP_BETWEEN_NOTES = 300; // ms

interface QuestionState {
  noteA: string; // First note played (with octave)
  noteB: string; // Second note played (with octave)
  familyA: FullTone; // Note family of first note
  familyB: FullTone; // Note family of second note
  targetNote: FullTone; // Which note family we're asking about
  otherNote: FullTone; // The other note family
  hasAnswered: boolean;
  wasCorrect: boolean | null;
  isFirstInStreak: boolean;
  startTime: number;
}

let persistentState: ToneQuizState;
let question: QuestionState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

/** Get allowed octaves for a note family to prevent edge identification */
function getAllowedOctaves(family: FullTone): number[] {
  // A and B can be in octave 3 or 4
  // C and D can be in octave 4 or 5
  // Others are just octave 4
  if (family === "A" || family === "B") {
    return [3, 4];
  } else if (family === "C" || family === "D") {
    return [4, 5];
  }
  return [4];
}

function pickOctave(family: FullTone): number {
  const octaves = getAllowedOctaves(family);
  return octaves[Math.floor(Math.random() * octaves.length)];
}

function initQuestion(): boolean {
  // Select target note (with stickiness - stays until 3 correct in a row)
  const [targetNote, targetOctave, isNewTarget, isFirstOnTarget, updatedState] =
    selectTargetNote(persistentState, pickOctave);
  persistentState = updatedState;

  // Select other note based on current learning progress
  const otherNote = selectOtherNote(persistentState, targetNote);
  const otherOctave = pickOctave(otherNote);

  const targetWithOctave = `${targetNote}${targetOctave}`;
  const otherWithOctave = `${otherNote}${otherOctave}`;

  // Randomize which plays first
  const [first, second] = randomizeOrder(
    { note: targetWithOctave, family: targetNote },
    { note: otherWithOctave, family: otherNote }
  );

  question = {
    noteA: first.note,
    noteB: second.note,
    familyA: first.family,
    familyB: second.family,
    targetNote,
    otherNote,
    hasAnswered: false,
    wasCorrect: null,
    isFirstInStreak: isFirstOnTarget,
    startTime: Date.now(),
  };

  return isNewTarget;
}

async function playBothNotes(): Promise<void> {
  await playNote(question.noteA, { duration: NOTE_DURATION });
  await new Promise((resolve) => setTimeout(resolve, GAP_BETWEEN_NOTES));
  await playNote(question.noteB, { duration: NOTE_DURATION });
}

function flashScreen(): void {
  const app = document.getElementById("app")!;
  app.classList.add("flash");
  setTimeout(() => app.classList.remove("flash"), 300);
}

function render(): void {
  const app = document.getElementById("app")!;

  const recentHistory = persistentState.history.slice(-20);
  const recentCorrect = recentHistory.filter((r) => r.correct).length;
  const totalPlayed = persistentState.history.length;
  const vocabDisplay = persistentState.learningVocabulary.join(", ");
  const streakInfo = `(${persistentState.correctStreak}/${STREAK_LENGTH} correct)`;

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Tone Quiz</h1>
    <p>Two notes play. Which one was the <strong>${question.targetNote}</strong>? ${streakInfo}</p>
    <p class="keyboard-hints"><strong>Keys:</strong> <kbd>1</kbd>/<kbd>←</kbd> First, <kbd>2</kbd>/<kbd>→</kbd> Second, <kbd>R</kbd> Replay, <kbd>Space</kbd> Continue</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
      </div>

      <div>
        <h3>Which was the ${question.targetNote}?</h3>
        <div class="note-choice-buttons" id="choice-buttons"></div>
      </div>

      <div id="feedback"></div>

      <div class="stats">
        <span class="stats-label">Recent:</span>
        <span id="score">${recentCorrect} / ${recentHistory.length}</span>
        <span class="stats-label" style="margin-left: 1rem;">Total:</span>
        <span>${totalPlayed}</span>
      </div>

      <div class="learning-info">
        <span class="stats-label">Learning:</span>
        <span>${vocabDisplay}</span>
      </div>

      <div class="danger-zone">
        <button class="danger-btn" id="clear-history-btn">Clear History</button>
        <p class="danger-warning">This will reset all your progress</p>
      </div>
    </div>
  `;

  renderChoiceButtons();
  setupEventListeners();
}

function renderChoiceButtons(): void {
  const container = document.getElementById("choice-buttons")!;
  container.innerHTML = "";

  // Show "First" and "Second" as the choices
  const choices = [
    { label: "First", family: question.familyA },
    { label: "Second", family: question.familyB },
  ];

  choices.forEach((choice, index) => {
    const button = document.createElement("button");
    button.className = "note-choice-btn";
    button.textContent = choice.label;
    button.dataset.index = String(index);

    if (question.hasAnswered) {
      const isCorrect = choice.family === question.targetNote;
      if (isCorrect) {
        button.classList.add("correct");
      } else if (!question.wasCorrect) {
        button.classList.add("incorrect");
      }
    }

    button.addEventListener("click", () => handleChoice(index));
    container.appendChild(button);
  });
}

function handleClearHistory(): void {
  if (confirm("Clear all history? This cannot be undone.")) {
    clearState();
    persistentState = loadState();
    initQuestion();
    render();
    playBothNotes();
  }
}

function setupEventListeners(): void {
  const playBtn = document.getElementById("play-btn")!;
  playBtn.addEventListener("click", playBothNotes);

  const clearBtn = document.getElementById("clear-history-btn")!;
  clearBtn.addEventListener("click", handleClearHistory);

  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
  }

  keyboardHandler = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "1") {
      e.preventDefault();
      handleChoice(0);
    } else if (e.key === "ArrowRight" || e.key === "2") {
      e.preventDefault();
      handleChoice(1);
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      playBothNotes();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (question.hasAnswered) {
        nextQuestion();
      } else {
        playBothNotes();
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
}

function handleChoice(chosenIndex: number): void {
  if (question.hasAnswered) {
    nextQuestion();
    return;
  }

  const chosenFamily = chosenIndex === 0 ? question.familyA : question.familyB;
  const isCorrect = chosenFamily === question.targetNote;

  question.hasAnswered = true;
  question.wasCorrect = isCorrect;

  // Record to persistent state and update streak
  persistentState = recordQuestion(persistentState, {
    timestamp: Date.now(),
    noteA: question.noteA,
    noteB: question.noteB,
    targetNote: question.targetNote,
    otherNote: question.otherNote,
    correct: isCorrect,
    wasFirstInStreak: question.isFirstInStreak,
    timeMs: Date.now() - question.startTime,
  });
  persistentState = updateStreak(persistentState, isCorrect);
  saveState(persistentState);

  renderChoiceButtons();
  renderFeedback();
  updateStats();
}

function renderFeedback(): void {
  const feedback = document.getElementById("feedback")!;

  if (question.wasCorrect) {
    feedback.className = "feedback success";
    feedback.textContent = "Correct! Press Space to continue.";
  } else {
    feedback.className = "feedback error";
    const targetPosition = question.familyA === question.targetNote ? "first" : "second";
    feedback.innerHTML = `
      Incorrect. The ${question.targetNote} was ${targetPosition} (the other note was ${question.otherNote}).
      <br><button id="replay-btn" class="play-again-btn" style="margin-top: 0.5rem;">Replay Both Notes</button>
      <br><small>Press Space to continue.</small>
    `;

    const replayBtn = document.getElementById("replay-btn");
    if (replayBtn) {
      replayBtn.addEventListener("click", playBothNotes);
    }
  }
}

function updateStats(): void {
  const recentHistory = persistentState.history.slice(-20);
  const recentCorrect = recentHistory.filter((r) => r.correct).length;

  const scoreEl = document.getElementById("score");
  if (scoreEl) {
    scoreEl.textContent = `${recentCorrect} / ${recentHistory.length}`;
  }
}

function nextQuestion(): void {
  const isNewTarget = initQuestion();
  render();
  if (isNewTarget) {
    flashScreen();
  }
  playBothNotes();
}

export function renderToneQuiz(): void {
  persistentState = loadState();
  initQuestion();
  render();
  playBothNotes();
}
