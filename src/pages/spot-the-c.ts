/**
 * Spot the C Exercise
 *
 * Two notes are played, one is always a C (C3, C4, or C5).
 * User identifies which one is the C.
 */

import { playNote, ALL_NOTES } from "../audio.js";
import {
  HistoryEntry,
  renderHistorySummary,
  setupHistoryBackButton,
} from "../lib/history.js";

const NOTE_DURATION = 0.6;
const NOTE_GAP = 0.3;
const WRONG_ANSWER_DELAY = 1000;
const CORRECT_FLASH_DELAY = 300;

// C notes that can be played
const C_NOTES = ["C3", "C4", "C5"];

// Range for the other note: A2 to E5 (slightly beyond C3-C5 range)
// We'll use notes from C3 area to C5 area, but not C notes
const OTHER_NOTES = ALL_NOTES.filter((note) => {
  // Exclude all C notes
  if (note.startsWith("C") && !note.startsWith("C#")) return false;
  // Keep notes in roughly the right range (all our notes are C3-B5)
  return true;
});

interface ExerciseState {
  // The two notes being played
  notes: [string, string];
  // Index of the C (0 or 1)
  cIndex: number;
  // Whether user has answered
  hasAnswered: boolean;
  // Was the answer correct
  wasCorrect: boolean | null;
  // What index did the user choose
  chosenIdx: number | null;
  // Stats
  totalCorrect: number;
  totalAttempts: number;
  streak: number;
  // Whether input is enabled
  inputEnabled: boolean;
  // Session history
  history: HistoryEntry[];
  // Whether showing history view
  showingHistory: boolean;
}

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

function pickCNote(): string {
  return C_NOTES[Math.floor(Math.random() * C_NOTES.length)];
}

function pickOtherNote(): string {
  return OTHER_NOTES[Math.floor(Math.random() * OTHER_NOTES.length)];
}

function initExercise(): void {
  const cNote = pickCNote();
  const otherNote = pickOtherNote();

  // Randomly decide order
  const cFirst = Math.random() < 0.5;
  const notes: [string, string] = cFirst
    ? [cNote, otherNote]
    : [otherNote, cNote];
  const cIndex = cFirst ? 0 : 1;

  state = {
    notes,
    cIndex,
    hasAnswered: false,
    wasCorrect: null,
    chosenIdx: null,
    totalCorrect: 0,
    totalAttempts: 0,
    streak: 0,
    inputEnabled: false,
    history: [],
    showingHistory: false,
  };
}

function pickNextRound(): void {
  const prevCorrect = state.totalCorrect;
  const prevAttempts = state.totalAttempts;
  const prevStreak = state.streak;
  const prevHistory = state.history;

  const cNote = pickCNote();
  const otherNote = pickOtherNote();

  const cFirst = Math.random() < 0.5;
  const notes: [string, string] = cFirst
    ? [cNote, otherNote]
    : [otherNote, cNote];
  const cIndex = cFirst ? 0 : 1;

  state = {
    notes,
    cIndex,
    hasAnswered: false,
    wasCorrect: null,
    chosenIdx: null,
    totalCorrect: prevCorrect,
    totalAttempts: prevAttempts,
    streak: prevStreak,
    inputEnabled: false,
    history: prevHistory,
    showingHistory: false,
  };
}

async function playBothNotes(): Promise<void> {
  const buttons = document.querySelectorAll(".note-choice-btn");

  // Play first note
  buttons[0]?.classList.add("playing");
  await playNote(state.notes[0], { duration: NOTE_DURATION });
  buttons[0]?.classList.remove("playing");

  // Gap
  await sleep(NOTE_GAP * 1000);

  // Play second note
  buttons[1]?.classList.add("playing");
  await playNote(state.notes[1], { duration: NOTE_DURATION });
  buttons[1]?.classList.remove("playing");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function handleAnswer(chosenIdx: number): void {
  if (state.hasAnswered || !state.inputEnabled) return;
  if (chosenIdx !== 0 && chosenIdx !== 1) return;

  state.hasAnswered = true;
  state.chosenIdx = chosenIdx;
  state.wasCorrect = chosenIdx === state.cIndex;
  state.totalAttempts++;

  // Record history
  const cNote = state.notes[state.cIndex];
  state.history.push({
    prompt: `${state.notes[0]} / ${state.notes[1]}`,
    userAnswer: `Sound ${chosenIdx + 1}`,
    correctAnswer: `Sound ${state.cIndex + 1} (${cNote})`,
    correct: state.wasCorrect,
  });

  if (state.wasCorrect) {
    state.streak++;
    state.totalCorrect++;
  } else {
    state.streak = 0;
  }

  render();

  if (state.wasCorrect) {
    setTimeout(advanceToNext, CORRECT_FLASH_DELAY);
  } else {
    setTimeout(advanceToNext, WRONG_ANSWER_DELAY);
  }
}

async function advanceToNext(): Promise<void> {
  pickNextRound();
  state.inputEnabled = false;
  render();
  await playBothNotes();
  state.inputEnabled = true;
}

function render(): void {
  const app = document.getElementById("app")!;

  if (state.showingHistory) {
    app.innerHTML = renderHistorySummary(state.history, "Spot the C");
    setupHistoryBackButton(() => {
      state.showingHistory = false;
      render();
      playBothNotes();
    });
    return;
  }

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Spot the C</h1>
    <p>Two notes play: one is a C, one is not. <strong>Find the C!</strong></p>
    <p>Use <strong>Left/Right arrows</strong> or <strong>1/2</strong> or click. Press <strong>Space</strong> to replay.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
        <button class="done-button" id="done-btn">Done</button>
      </div>

      <div>
        <h3>Which one is the C?</h3>
        <div class="note-choice-buttons" id="note-buttons"></div>
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
      </div>
    </div>
  `;

  renderNoteButtons();
  renderFeedback();
  setupEventListeners();
}

function renderNoteButtons(): void {
  const container = document.getElementById("note-buttons")!;

  for (let i = 0; i < 2; i++) {
    const button = document.createElement("button");
    button.className = "note-choice-btn";
    button.textContent = `Sound ${i + 1}`;

    if (state.hasAnswered) {
      if (i === state.cIndex) {
        button.classList.add("correct");
      } else if (i === state.chosenIdx) {
        button.classList.add("incorrect");
      }
    }

    button.addEventListener("click", () => handleAnswer(i));
    container.appendChild(button);
  }
}

function renderFeedback(): void {
  const feedback = document.getElementById("feedback")!;

  if (!state.hasAnswered) {
    feedback.className = "";
    feedback.textContent = "";
    return;
  }

  const cNote = state.notes[state.cIndex];
  const otherNote = state.notes[state.cIndex === 0 ? 1 : 0];

  if (state.wasCorrect) {
    feedback.className = "feedback success";
    feedback.textContent = `Correct! Sound ${state.cIndex + 1} was ${cNote}. The other was ${otherNote}.`;
  } else {
    feedback.className = "feedback error";
    feedback.textContent = `Wrong! Sound ${state.cIndex + 1} was the C (${cNote}). You heard ${otherNote}.`;
  }
}

function setupEventListeners(): void {
  const playBtn = document.getElementById("play-btn")!;
  playBtn.addEventListener("click", () => {
    if (!state.hasAnswered) {
      playBothNotes();
    }
  });

  const doneBtn = document.getElementById("done-btn")!;
  doneBtn.addEventListener("click", () => {
    state.showingHistory = true;
    render();
  });

  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
  }

  keyboardHandler = (e: KeyboardEvent) => {
    if (e.key === " ") {
      e.preventDefault();
      if (!state.hasAnswered) {
        playBothNotes();
      }
      return;
    }

    // Left arrow or 1 = first sound
    if (e.key === "ArrowLeft" || e.key === "1") {
      e.preventDefault();
      handleAnswer(0);
      return;
    }

    // Right arrow or 2 = second sound
    if (e.key === "ArrowRight" || e.key === "2") {
      e.preventDefault();
      handleAnswer(1);
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

export async function renderSpotTheC(): Promise<void> {
  initExercise();
  render();
  await playBothNotes();
  state.inputEnabled = true;
}
