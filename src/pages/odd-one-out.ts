/**
 * Odd One Out Exercise
 *
 * Play three notes: two are the same note in different octaves,
 * one is a different note. User identifies which is the odd one.
 */

import { playNote, shuffle, getChromaticIndex, NOTE_FREQUENCIES, isPlaying } from "../audio.js";
import {
  HistoryEntry,
  renderHistorySummary,
  setupHistoryBackButton,
} from "../lib/history.js";

const NOTE_DURATION = 0.6;
const NOTE_GAP = 0.3;
const WRONG_ANSWER_DELAY = 2000;
const CORRECT_FLASH_DELAY = 300;

// Available base notes (without octave)
const BASE_NOTES = [
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

interface ExerciseState {
  // The three notes being played (e.g., ["C3", "E4", "C5"])
  notes: string[];
  // Index of the odd one (0, 1, or 2)
  oddIndex: number;
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

/**
 * Pick a random base note (without octave).
 */
function randomBaseNote(): string {
  return BASE_NOTES[Math.floor(Math.random() * BASE_NOTES.length)];
}

/**
 * Pick a base note that is NOT a semitone of the given note.
 */
function pickDifferentNote(excludeNote: string): string {
  const excludeIdx = getChromaticIndex(excludeNote);
  const candidates = BASE_NOTES.filter((n) => {
    const idx = BASE_NOTES.indexOf(n);
    const diff = Math.abs(idx - excludeIdx);
    // Must be at least 2 semitones away (not same, not adjacent)
    return diff >= 2 && diff <= 10; // 10 handles wrapping (11 would be semitone)
  });
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Pick two different octaves for the same note.
 */
function pickTwoOctaves(): [number, number] {
  const octaves = [3, 4, 5];
  const shuffled = shuffle(octaves);
  return [shuffled[0], shuffled[1]];
}

/**
 * Pick one octave for the odd note (from a reasonable range).
 */
function pickOddOctave(): number {
  const octaves = [3, 4, 5];
  return octaves[Math.floor(Math.random() * octaves.length)];
}

/**
 * Sort notes by pitch (frequency) from low to high.
 */
function sortByPitch(notes: { note: string; isOdd: boolean }[]): { note: string; isOdd: boolean }[] {
  return [...notes].sort((a, b) => NOTE_FREQUENCIES[a.note] - NOTE_FREQUENCIES[b.note]);
}

function initExercise(): void {
  // Pick the "same" note (appears twice in different octaves)
  const sameNote = randomBaseNote();
  const [octave1, octave2] = pickTwoOctaves();

  // Pick the odd note (different from sameNote, not a semitone)
  const oddNote = pickDifferentNote(sameNote);
  const oddOctave = pickOddOctave();

  // Create the three notes
  const sameNote1 = `${sameNote}${octave1}`;
  const sameNote2 = `${sameNote}${octave2}`;
  const oddFull = `${oddNote}${oddOctave}`;

  // Sort by pitch (low to high) and track where odd one ends up
  const positions = sortByPitch([
    { note: sameNote1, isOdd: false },
    { note: sameNote2, isOdd: false },
    { note: oddFull, isOdd: true },
  ]);

  state = {
    notes: positions.map((p) => p.note),
    oddIndex: positions.findIndex((p) => p.isOdd),
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

  // Pick the "same" note
  const sameNote = randomBaseNote();
  const [octave1, octave2] = pickTwoOctaves();

  // Pick the odd note
  const oddNote = pickDifferentNote(sameNote);
  const oddOctave = pickOddOctave();

  const sameNote1 = `${sameNote}${octave1}`;
  const sameNote2 = `${sameNote}${octave2}`;
  const oddFull = `${oddNote}${oddOctave}`;

  const positions = sortByPitch([
    { note: sameNote1, isOdd: false },
    { note: sameNote2, isOdd: false },
    { note: oddFull, isOdd: true },
  ]);

  state = {
    notes: positions.map((p) => p.note),
    oddIndex: positions.findIndex((p) => p.isOdd),
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

async function playAllNotes(): Promise<void> {
  for (let i = 0; i < state.notes.length; i++) {
    // Highlight current button
    const buttons = document.querySelectorAll(".note-choice-btn");
    buttons[i]?.classList.add("playing");

    await playNote(state.notes[i], { duration: NOTE_DURATION });

    buttons[i]?.classList.remove("playing");

    // Gap between notes (except after last)
    if (i < state.notes.length - 1) {
      await sleep(NOTE_GAP * 1000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function handleAnswer(chosenIdx: number): void {
  if (state.hasAnswered || !state.inputEnabled) return;
  if (chosenIdx < 0 || chosenIdx >= 3) return;

  state.hasAnswered = true;
  state.chosenIdx = chosenIdx;
  state.wasCorrect = chosenIdx === state.oddIndex;
  state.totalAttempts++;

  // Record history
  const oddNote = state.notes[state.oddIndex];
  state.history.push({
    prompt: state.notes.join(", "),
    userAnswer: `Sound ${chosenIdx + 1}`,
    correctAnswer: `Sound ${state.oddIndex + 1} (${oddNote})`,
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
  await playAllNotes();
  state.inputEnabled = true;
}

function render(): void {
  const app = document.getElementById("app")!;

  if (state.showingHistory) {
    app.innerHTML = renderHistorySummary(state.history, "Odd One Out");
    setupHistoryBackButton(() => {
      state.showingHistory = false;
      render();
      playAllNotes();
    });
    return;
  }

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Odd One Out</h1>
    <p>Three notes play: two are the same note in different octaves, one is different. <strong>Find the odd one!</strong></p>
    <p>Use <strong>number keys (1-3)</strong> or click. Press <strong>Space</strong> to replay.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
        <button class="done-button" id="done-btn">Done</button>
      </div>

      <div>
        <h3>Which note is different?</h3>
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

  for (let i = 0; i < 3; i++) {
    const button = document.createElement("button");
    button.className = "note-choice-btn";
    button.textContent = `Sound ${i + 1}`;

    if (state.hasAnswered) {
      if (i === state.oddIndex) {
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

  const oddNote = state.notes[state.oddIndex];
  if (state.wasCorrect) {
    feedback.className = "feedback success";
    feedback.textContent = `Correct! The odd one was ${oddNote}.`;
  } else {
    feedback.className = "feedback error";
    feedback.textContent = `Wrong! The odd one was Sound ${state.oddIndex + 1} (${oddNote}).`;
  }
}

function setupEventListeners(): void {
  const playBtn = document.getElementById("play-btn")!;
  playBtn.addEventListener("click", () => {
    if (!state.hasAnswered && !isPlaying()) {
      playAllNotes();
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
      if (!state.hasAnswered && !isPlaying()) {
        playAllNotes();
      }
      return;
    }

    if (e.key >= "1" && e.key <= "3") {
      e.preventDefault();
      handleAnswer(parseInt(e.key, 10) - 1);
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

export async function renderOddOneOut(): Promise<void> {
  initExercise();
  render();
  await playAllNotes();
  state.inputEnabled = true;
}
