/**
 * Progressive Note Identification Exercise
 *
 * Adaptive difficulty exercise where students identify notes from a growing set.
 * - Starts with 2 notes (C4 + one distant note)
 * - Uses EMA-based difficulty adjustment
 * - Max 10 notes, min 2 notes
 */

import { OCTAVE_4_NOTES, playNote } from "../audio.js";
import {
  checkDifficultyAdjustment,
  createDifficultyState,
  DifficultyState,
} from "../lib/difficulty.js";
import { loadDifficulty, saveDifficulty } from "../lib/storage.js";
import {
  HistoryEntry,
  renderHistorySummary,
  setupHistoryBackButton,
  setupHistoryPlayButtons,
} from "../lib/history.js";

const MIN_NOTES = 2;
const MAX_NOTES = 10;
const WRONG_ANSWER_DELAY = 1000; // ms to show wrong answer before continuing
const CORRECT_FLASH_DELAY = 300; // ms to show green flash on correct answer
const NOTE_DURATION = 0.8; // seconds

interface ExerciseState {
  // Current set of notes (indices into OCTAVE_4_NOTES)
  noteIndices: number[];
  // The current note being tested (index into noteIndices)
  currentNoteIdx: number;
  // Difficulty state (level = number of notes)
  difficulty: DifficultyState;
  // Whether user has answered current question
  hasAnswered: boolean;
  // Was the answer correct
  wasCorrect: boolean | null;
  // What index did the user choose (for showing incorrect highlight)
  chosenIdx: number | null;
  // Total stats
  totalCorrect: number;
  totalAttempts: number;
  // Current streak (for display)
  streak: number;
  // Most recently added note (to highlight as new)
  newNoteIdx: number | null;
  // Whether input is currently accepted
  inputEnabled: boolean;
  // Session history
  history: HistoryEntry[];
  // Whether showing history view
  showingHistory: boolean;
}

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
let lastSpaceTime = 0;
const SPACE_DEBOUNCE_MS = 300;

// Sharp note indices: C#=1, D#=3, F#=6, G#=8, A#=10
const SHARP_INDICES = [1, 3, 6, 8, 10];
// Mapping from sharp index to its base note index
const SHARP_TO_BASE: Record<number, number> = {
  1: 0, // C# -> C
  3: 2, // D# -> D
  6: 5, // F# -> F
  8: 7, // G# -> G
  10: 9, // A# -> A
};
// Minimum notes before sharps can be introduced
const MIN_NOTES_FOR_SHARPS = 5;

/**
 * Get the semitone index for a note (0-11 within octave 4).
 */
function getNoteIndex(note: string): number {
  return OCTAVE_4_NOTES.indexOf(note);
}

/**
 * Check if a note index is a sharp.
 */
function isSharpNote(noteIdx: number): boolean {
  return SHARP_INDICES.includes(noteIdx);
}

/**
 * Check if a sharp note can be added given the current set.
 * Rules: Must have at least MIN_NOTES_FOR_SHARPS notes AND the base note must be present.
 */
function canAddSharp(sharpIdx: number, existingIndices: number[]): boolean {
  // Must have enough notes
  if (existingIndices.length < MIN_NOTES_FOR_SHARPS) {
    return false;
  }
  // Base note must be present
  const baseIdx = SHARP_TO_BASE[sharpIdx];
  return existingIndices.includes(baseIdx);
}

/**
 * Calculate minimum semitone distance from a note to any note in a set.
 */
function minDistanceToSet(noteIdx: number, setIndices: number[]): number {
  if (setIndices.length === 0) return 12;
  return Math.min(...setIndices.map((idx) => Math.abs(noteIdx - idx)));
}

/**
 * Select a note that tends toward being well-differentiated from existing notes,
 * but with randomization. Uses distance-squared as weights for selection.
 *
 * Sharp notes (#) are only available when:
 * - There are at least MIN_NOTES_FOR_SHARPS notes
 * - The base note (e.g., C for C#) is already in the set
 */
function selectDifferentiatedNote(existingIndices: number[]): number {
  const available: number[] = [];
  for (let i = 0; i < OCTAVE_4_NOTES.length; i++) {
    if (existingIndices.includes(i)) continue;

    // Check if this is a sharp that can't be added yet
    if (isSharpNote(i) && !canAddSharp(i, existingIndices)) {
      continue;
    }

    available.push(i);
  }

  if (available.length === 0) return -1;

  // Score each available note by its minimum distance to existing notes
  // Use distance squared as weight to prefer distant notes but allow randomness
  const scored = available.map((idx) => {
    const distance = minDistanceToSet(idx, existingIndices);
    return {
      idx,
      weight: distance * distance, // Square to bias toward more distant notes
    };
  });

  // Weighted random selection
  const totalWeight = scored.reduce((sum, s) => sum + s.weight, 0);
  let random = Math.random() * totalWeight;

  for (const s of scored) {
    random -= s.weight;
    if (random <= 0) {
      return s.idx;
    }
  }

  // Fallback (shouldn't happen)
  return scored[scored.length - 1].idx;
}

/**
 * Initialize the exercise with 2 notes: C4 and one distant note.
 */
function initExercise(): void {
  // Load saved level (number of notes), clamped to valid range
  const savedLevel = loadDifficulty("progressive-id", MIN_NOTES);
  const targetNotes = Math.max(MIN_NOTES, Math.min(MAX_NOTES, Math.round(savedLevel)));

  // Build note set starting with C4, adding differentiated notes up to target
  const c4Index = getNoteIndex("C4");
  const noteIndices = [c4Index];

  while (noteIndices.length < targetNotes) {
    const newNote = selectDifferentiatedNote(noteIndices);
    noteIndices.push(newNote);
  }
  noteIndices.sort((a, b) => a - b);

  state = {
    noteIndices,
    currentNoteIdx: 0,
    difficulty: createDifficultyState(targetNotes), // Fresh EMA, saved level
    hasAnswered: false,
    wasCorrect: null,
    chosenIdx: null,
    totalCorrect: 0,
    totalAttempts: 0,
    streak: 0,
    newNoteIdx: null,
    inputEnabled: false,
    history: [],
    showingHistory: false,
  };

  pickNextNote();
}

function pickNextNote(): void {
  const previousIdx = state.currentNoteIdx;

  // Pick a random note, but re-roll once if it's the same as last time
  let newIdx = Math.floor(Math.random() * state.noteIndices.length);
  if (newIdx === previousIdx && state.noteIndices.length > 1) {
    newIdx = Math.floor(Math.random() * state.noteIndices.length);
  }

  state.currentNoteIdx = newIdx;
  state.hasAnswered = false;
  state.wasCorrect = null;
  state.chosenIdx = null;
}

function getCurrentNote(): string {
  return OCTAVE_4_NOTES[state.noteIndices[state.currentNoteIdx]];
}

function getActiveNotes(): string[] {
  return state.noteIndices.map((idx) => OCTAVE_4_NOTES[idx]);
}

function increaseDifficulty(): void {
  if (state.noteIndices.length < MAX_NOTES) {
    const newNote = selectDifferentiatedNote(state.noteIndices);
    if (newNote !== -1) {
      state.noteIndices.push(newNote);
      state.noteIndices.sort((a, b) => a - b);
      state.newNoteIdx = newNote;
    }
  } else {
    // At max, swap out a random non-C4 note
    const c4Index = getNoteIndex("C4");
    const swappable = state.noteIndices.filter((idx) => idx !== c4Index);
    if (swappable.length > 0) {
      const toRemove = swappable[Math.floor(Math.random() * swappable.length)];
      state.noteIndices = state.noteIndices.filter((idx) => idx !== toRemove);
      const newNote = selectDifferentiatedNote(state.noteIndices);
      if (newNote !== -1) {
        state.noteIndices.push(newNote);
        state.noteIndices.sort((a, b) => a - b);
        state.newNoteIdx = newNote;
      }
    }
  }
}

function decreaseDifficulty(): void {
  if (state.noteIndices.length > MIN_NOTES) {
    const c4Index = getNoteIndex("C4");
    const removable = state.noteIndices.filter((idx) => idx !== c4Index);
    if (removable.length > 0) {
      const toRemove = removable[Math.floor(Math.random() * removable.length)];
      state.noteIndices = state.noteIndices.filter((idx) => idx !== toRemove);
    }
  }
}

function applyDifficultyAdjustment(wasCorrect: boolean): void {
  const adjustment = checkDifficultyAdjustment(
    state.difficulty,
    wasCorrect,
    MIN_NOTES,
    MAX_NOTES
  );

  // Update difficulty state
  state.difficulty = {
    level: adjustment.newLevel,
    ema: adjustment.newEma,
  };

  // Apply note changes based on level change
  if (adjustment.changed === "increased") {
    increaseDifficulty();
  } else if (adjustment.changed === "decreased") {
    decreaseDifficulty();
  }

  // Save level for next session
  saveDifficulty("progressive-id", state.difficulty.level);
}

async function advanceToNextNote(): Promise<void> {
  pickNextNote();
  state.inputEnabled = false;
  render();
  await playCurrentNote();
  state.inputEnabled = true;
}

function handleAnswer(chosenIdx: number): void {
  if (state.hasAnswered || !state.inputEnabled) {
    return; // Already answered or input not yet enabled
  }

  if (chosenIdx < 0 || chosenIdx >= state.noteIndices.length) return;

  state.hasAnswered = true;
  state.chosenIdx = chosenIdx;
  state.wasCorrect = chosenIdx === state.currentNoteIdx;
  state.totalAttempts++;

  // Record history
  const correctNote = getCurrentNote();
  const chosenNote = OCTAVE_4_NOTES[state.noteIndices[chosenIdx]];
  state.history.push({
    prompt: correctNote,
    notes: [correctNote],
    userAnswer: chosenNote,
    correctAnswer: correctNote,
    correct: state.wasCorrect,
  });

  if (state.wasCorrect) {
    state.totalCorrect++;
    state.streak++;
    // Clear new note highlight if it was correctly identified
    const chosenNoteIdx = state.noteIndices[chosenIdx];
    if (chosenNoteIdx === state.newNoteIdx) {
      state.newNoteIdx = null;
    }
  } else {
    state.streak = 0;
  }

  // Apply difficulty adjustment
  applyDifficultyAdjustment(state.wasCorrect);
  render();

  // Auto-advance: brief flash if correct, longer delay if wrong
  if (state.wasCorrect) {
    setTimeout(advanceToNextNote, CORRECT_FLASH_DELAY);
  } else {
    setTimeout(advanceToNextNote, WRONG_ANSWER_DELAY);
  }
}

async function playCurrentNote(): Promise<void> {
  await playNote(getCurrentNote(), { duration: NOTE_DURATION });
}

function render(): void {
  const app = document.getElementById("app")!;

  if (state.showingHistory) {
    app.innerHTML = renderHistorySummary(state.history, "Progressive Note ID");
    setupHistoryBackButton(() => {
      state.showingHistory = false;
      render();
      playCurrentNote();
    });
    setupHistoryPlayButtons(state.history, async (notes) => {
      await playNote(notes[0], { duration: NOTE_DURATION });
    });
    return;
  }

  const notes = getActiveNotes();

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Progressive Note ID</h1>
    <p>Identify the note you hear. Use <strong>number keys (1-${notes.length})</strong> or click. Press <strong>Space</strong> to replay.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Note</button>
        <button class="done-button" id="done-btn">Done</button>
      </div>

      <div>
        <h3>Which note is it? <span class="note-count">(${notes.length} notes)</span></h3>
        <div class="progressive-note-buttons" id="note-buttons"></div>
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
          <span>${state.streak}${state.streak >= 5 ? " 🔥" : ""}</span>
        </div>
        <div class="stats">
          <span class="stats-label">Level:</span>
          <span>${notes.length} notes</span>
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
  const notes = getActiveNotes();

  notes.forEach((note, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "progressive-note-wrapper";

    const button = document.createElement("button");
    button.className = "progressive-note-btn";
    button.textContent = note;

    // Highlight new note
    const noteIdx = state.noteIndices[index];
    if (noteIdx === state.newNoteIdx) {
      button.classList.add("new-note");
    }

    if (state.hasAnswered) {
      if (index === state.currentNoteIdx) {
        button.classList.add("correct");
      } else if (index === state.chosenIdx) {
        button.classList.add("incorrect");
      }
    }

    button.addEventListener("click", () => handleAnswer(index));

    const label = document.createElement("div");
    label.className = "key-label";
    label.textContent = index === 9 ? "0" : String(index + 1);

    wrapper.appendChild(button);
    wrapper.appendChild(label);
    container.appendChild(wrapper);
  });
}

function renderFeedback(): void {
  const feedback = document.getElementById("feedback");
  if (!feedback) return;

  if (!state.hasAnswered) {
    feedback.className = "";
    feedback.textContent = "";
    return;
  }

  const correctNote = getCurrentNote();
  if (state.wasCorrect) {
    feedback.className = "feedback success";
    feedback.textContent = "Correct!";
  } else {
    feedback.className = "feedback error";
    feedback.textContent = `That was ${correctNote}.`;
  }
}

function setupEventListeners(): void {
  const playBtn = document.getElementById("play-btn")!;
  playBtn.addEventListener("click", playCurrentNote);

  const doneBtn = document.getElementById("done-btn")!;
  doneBtn.addEventListener("click", () => {
    state.showingHistory = true;
    render();
  });

  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
  }

  keyboardHandler = (e: KeyboardEvent) => {
    if (e.repeat) return; // Ignore held keys

    const notes = getActiveNotes();

    // Space to replay note
    if (e.key === " ") {
      e.preventDefault();
      const now = Date.now();
      if (!state.hasAnswered && now - lastSpaceTime > SPACE_DEBOUNCE_MS) {
        lastSpaceTime = now;
        playCurrentNote();
      }
      return;
    }

    // Number keys 1-9 and 0 (for 10)
    let keyNum = -1;
    if (e.key >= "1" && e.key <= "9") {
      keyNum = parseInt(e.key, 10) - 1;
    } else if (e.key === "0") {
      keyNum = 9;
    }

    if (keyNum >= 0 && keyNum < notes.length) {
      e.preventDefault();
      handleAnswer(keyNum);
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

export async function renderProgressiveId(): Promise<void> {
  initExercise();
  render();
  await playCurrentNote();
  state.inputEnabled = true;
}
