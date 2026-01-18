/**
 * Octave or Not Exercise
 *
 * Play two notes (low then high), user identifies if they're an octave apart.
 * Difficulty increases by:
 * - Adding more base notes to the pool
 * - Using non-octave intervals closer to 12 semitones
 */

import { playNote, NOTE_FREQUENCIES } from "../audio.js";
import {
  checkDifficultyAdjustment,
  DifficultyState,
} from "../lib/difficulty.js";

const NOTE_DURATION = 0.6;
const NOTE_GAP = 0.3;
const WRONG_ANSWER_DELAY = 1500;
const CORRECT_FLASH_DELAY = 300;

const MIN_LEVEL = 1;
const MAX_LEVEL = 7;

// Base notes available at each difficulty level
// Level 1-2: C, E, G (3 notes)
// Level 3-4: C, D, E, G, A (5 notes - pentatonic)
// Level 5-6: C, D, E, F, G, A, B (7 notes - naturals)
// Level 7: All 12 notes
const BASE_NOTES_BY_LEVEL: Record<number, string[]> = {
  1: ["C", "E", "G"],
  2: ["C", "E", "G"],
  3: ["C", "D", "E", "G", "A"],
  4: ["C", "D", "E", "G", "A"],
  5: ["C", "D", "E", "F", "G", "A", "B"],
  6: ["C", "D", "E", "F", "G", "A", "B"],
  7: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],
};

// Non-octave intervals available at each difficulty level
// Lower levels use intervals far from 12, higher levels use intervals close to 12
// Level 1: tritone only (6 semitones - very different from octave)
// Level 2: add perfect 5th (7)
// Level 3: add perfect 4th (5)
// Level 4: add minor 6th (8), major 6th (9)
// Level 5: add minor 7th (10)
// Level 6: add major 7th (11)
// Level 7: add minor 9th (13) - very close to octave
const NON_OCTAVE_INTERVALS_BY_LEVEL: Record<number, number[]> = {
  1: [6],
  2: [6, 7],
  3: [5, 6, 7],
  4: [5, 6, 7, 8, 9],
  5: [5, 6, 7, 8, 9, 10],
  6: [5, 6, 7, 8, 9, 10, 11],
  7: [5, 6, 7, 8, 9, 10, 11, 13],
};

// All notes with their semitone offset from C
const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5,
  "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11,
};

const SEMITONE_TO_NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

interface ExerciseState {
  // The two notes being played [low, high]
  notes: [string, string];
  // Whether they are actually an octave apart
  isOctave: boolean;
  // The interval in semitones
  interval: number;
  // Difficulty tracking
  difficulty: DifficultyState;
  // Whether user has answered
  hasAnswered: boolean;
  // Was the answer correct
  wasCorrect: boolean | null;
  // What the user chose
  userSaidOctave: boolean | null;
  // Stats
  totalCorrect: number;
  totalAttempts: number;
  // Whether input is enabled
  inputEnabled: boolean;
}

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

function getBaseNotes(level: number): string[] {
  return BASE_NOTES_BY_LEVEL[Math.min(level, MAX_LEVEL)] || BASE_NOTES_BY_LEVEL[MAX_LEVEL];
}

function getNonOctaveIntervals(level: number): number[] {
  return NON_OCTAVE_INTERVALS_BY_LEVEL[Math.min(level, MAX_LEVEL)] || NON_OCTAVE_INTERVALS_BY_LEVEL[MAX_LEVEL];
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a note that is `semitones` above the base note.
 * Returns null if the resulting note would be out of our range (octaves 3-5).
 */
function noteAbove(baseNote: string, baseOctave: number, semitones: number): string | null {
  const baseSemitone = NOTE_TO_SEMITONE[baseNote];
  const totalSemitones = baseSemitone + semitones;
  const newOctave = baseOctave + Math.floor(totalSemitones / 12);
  const newSemitone = totalSemitones % 12;

  // Keep within octaves 3-5
  if (newOctave < 3 || newOctave > 5) return null;

  const newNote = SEMITONE_TO_NOTE[newSemitone];
  return `${newNote}${newOctave}`;
}

function generateRound(level: number): { notes: [string, string]; isOctave: boolean; interval: number } {
  const baseNotes = getBaseNotes(level);
  const nonOctaveIntervals = getNonOctaveIntervals(level);

  // Decide if this will be an octave or not (50/50)
  const isOctave = Math.random() < 0.5;
  const interval = isOctave ? 12 : pickRandom(nonOctaveIntervals);

  // Pick a base note and octave that allows the interval
  // Start from octave 3 or 4 depending on interval size
  const maxBaseOctave = interval >= 12 ? 4 : 5;
  const minBaseOctave = 3;

  let attempts = 0;
  while (attempts < 50) {
    const baseNote = pickRandom(baseNotes);
    const baseOctave = minBaseOctave + Math.floor(Math.random() * (maxBaseOctave - minBaseOctave + 1));
    const lowNote = `${baseNote}${baseOctave}`;
    const highNote = noteAbove(baseNote, baseOctave, interval);

    if (highNote && NOTE_FREQUENCIES[lowNote] && NOTE_FREQUENCIES[highNote]) {
      return { notes: [lowNote, highNote], isOctave, interval };
    }
    attempts++;
  }

  // Fallback: C3 to C4 (octave)
  return { notes: ["C3", "C4"], isOctave: true, interval: 12 };
}

function initExercise(): void {
  const round = generateRound(1);

  state = {
    notes: round.notes,
    isOctave: round.isOctave,
    interval: round.interval,
    difficulty: {
      level: 1,
      streak: 0,
      recentAnswers: [],
    },
    hasAnswered: false,
    wasCorrect: null,
    userSaidOctave: null,
    totalCorrect: 0,
    totalAttempts: 0,
    inputEnabled: false,
  };
}

function pickNextRound(): void {
  const round = generateRound(state.difficulty.level);

  state.notes = round.notes;
  state.isOctave = round.isOctave;
  state.interval = round.interval;
  state.hasAnswered = false;
  state.wasCorrect = null;
  state.userSaidOctave = null;
  state.inputEnabled = false;
}

async function playBothNotes(): Promise<void> {
  const buttons = document.querySelectorAll(".note-choice-btn");

  // Play low note
  buttons[0]?.classList.add("playing");
  await playNote(state.notes[0], { duration: NOTE_DURATION });
  buttons[0]?.classList.remove("playing");

  await sleep(NOTE_GAP * 1000);

  // Play high note
  buttons[1]?.classList.add("playing");
  await playNote(state.notes[1], { duration: NOTE_DURATION });
  buttons[1]?.classList.remove("playing");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function handleAnswer(saidOctave: boolean): void {
  if (state.hasAnswered || !state.inputEnabled) return;

  state.hasAnswered = true;
  state.userSaidOctave = saidOctave;
  state.wasCorrect = saidOctave === state.isOctave;
  state.totalAttempts++;

  if (state.wasCorrect) {
    state.totalCorrect++;
  }

  // Check difficulty adjustment
  const adjustment = checkDifficultyAdjustment(
    state.difficulty,
    state.wasCorrect,
    MIN_LEVEL,
    MAX_LEVEL
  );

  state.difficulty = {
    level: adjustment.newLevel,
    streak: adjustment.newStreak,
    recentAnswers: adjustment.newRecentAnswers,
  };

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

function getIntervalName(semitones: number): string {
  const names: Record<number, string> = {
    5: "perfect 4th",
    6: "tritone",
    7: "perfect 5th",
    8: "minor 6th",
    9: "major 6th",
    10: "minor 7th",
    11: "major 7th",
    12: "octave",
    13: "minor 9th",
  };
  return names[semitones] || `${semitones} semitones`;
}

function render(): void {
  const app = document.getElementById("app")!;

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Octave or Not</h1>
    <p>Two notes play (low then high). <strong>Are they an octave apart?</strong></p>
    <p>Use <strong>Y/N</strong> keys, <strong>Left/Right</strong> arrows, or click. Press <strong>Space</strong> to replay.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
      </div>

      <div>
        <h3>Is it an octave?</h3>
        <div class="note-choice-buttons" id="choice-buttons"></div>
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
          <span>${state.difficulty.streak}${state.difficulty.streak >= 5 ? " \u{1F525}" : ""}</span>
        </div>
        <div class="stats">
          <span class="stats-label">Level:</span>
          <span>${state.difficulty.level}</span>
        </div>
      </div>
    </div>
  `;

  renderChoiceButtons();
  renderFeedback();
  setupEventListeners();
}

function renderChoiceButtons(): void {
  const container = document.getElementById("choice-buttons")!;

  // "Yes" button
  const yesBtn = document.createElement("button");
  yesBtn.className = "note-choice-btn";
  yesBtn.textContent = "Yes (Octave)";
  if (state.hasAnswered) {
    if (state.isOctave) {
      yesBtn.classList.add("correct");
    } else if (state.userSaidOctave === true) {
      yesBtn.classList.add("incorrect");
    }
  }
  yesBtn.addEventListener("click", () => handleAnswer(true));

  // "No" button
  const noBtn = document.createElement("button");
  noBtn.className = "note-choice-btn";
  noBtn.textContent = "No (Not Octave)";
  if (state.hasAnswered) {
    if (!state.isOctave) {
      noBtn.classList.add("correct");
    } else if (state.userSaidOctave === false) {
      noBtn.classList.add("incorrect");
    }
  }
  noBtn.addEventListener("click", () => handleAnswer(false));

  container.appendChild(yesBtn);
  container.appendChild(noBtn);
}

function renderFeedback(): void {
  const feedback = document.getElementById("feedback")!;

  if (!state.hasAnswered) {
    feedback.className = "";
    feedback.textContent = "";
    return;
  }

  const intervalName = getIntervalName(state.interval);

  if (state.wasCorrect) {
    feedback.className = "feedback success";
    feedback.textContent = `Correct! ${state.notes[0]} to ${state.notes[1]} is a ${intervalName}.`;
  } else {
    feedback.className = "feedback error";
    feedback.textContent = `Wrong! ${state.notes[0]} to ${state.notes[1]} is a ${intervalName}, not ${state.isOctave ? "something else" : "an octave"}.`;
  }
}

function setupEventListeners(): void {
  const playBtn = document.getElementById("play-btn")!;
  playBtn.addEventListener("click", () => {
    if (!state.hasAnswered) {
      playBothNotes();
    }
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

    // Y or Left = Yes (octave)
    if (e.key === "y" || e.key === "Y" || e.key === "ArrowLeft") {
      e.preventDefault();
      handleAnswer(true);
      return;
    }

    // N or Right = No (not octave)
    if (e.key === "n" || e.key === "N" || e.key === "ArrowRight") {
      e.preventDefault();
      handleAnswer(false);
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

export async function renderOctaveOrNot(): Promise<void> {
  initExercise();
  render();
  await playBothNotes();
  state.inputEnabled = true;
}
