/**
 * Note Choice Exercise
 *
 * Plays a single note and asks the user to identify which of two notes it is.
 */

import { playNote, selectRandomNotes, isPlaying } from "../audio.js";
import {
  HistoryEntry,
  renderHistorySummary,
  setupHistoryBackButton,
} from "../lib/history.js";

interface ExerciseState {
  // The two notes to choose between
  choices: [string, string];
  // Which note is the correct answer (0 or 1)
  correctIndex: number;
  // Whether the user has answered
  hasAnswered: boolean;
  // Whether they got it right
  wasCorrect: boolean | null;
  // Running score
  correct: number;
  total: number;
  // Session history
  history: HistoryEntry[];
  // Whether showing history view
  showingHistory: boolean;
}

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

function initExercise(preserveScore = false): void {
  const choices = selectRandomNotes(2) as [string, string];
  const correctIndex = Math.random() < 0.5 ? 0 : 1;

  state = {
    choices,
    correctIndex,
    hasAnswered: false,
    wasCorrect: null,
    correct: preserveScore ? state.correct : 0,
    total: preserveScore ? state.total : 0,
    history: preserveScore ? state.history : [],
    showingHistory: false,
  };
}

function render(): void {
  const app = document.getElementById("app")!;

  if (state.showingHistory) {
    app.innerHTML = renderHistorySummary(state.history, "Note Choice");
    setupHistoryBackButton(() => {
      state.showingHistory = false;
      render();
      playCurrentNote();
    });
    return;
  }

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Note Choice</h1>
    <p>Listen to the note and identify which one it is. Use <strong>Left/Right arrows</strong> to choose, <strong>Space</strong> to continue.</p>

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Note</button>
        <button class="done-button" id="done-btn">Done</button>
      </div>

      <div>
        <h3>Which note is it?</h3>
        <div class="note-choice-buttons" id="choice-buttons"></div>
      </div>

      <div id="feedback"></div>

      <div class="stats">
        <span class="stats-label">Score:</span>
        <span id="score">${state.correct} / ${state.total}</span>
      </div>
    </div>
  `;

  renderChoiceButtons();
  setupEventListeners();
}

function renderChoiceButtons(): void {
  const container = document.getElementById("choice-buttons")!;
  container.innerHTML = "";

  state.choices.forEach((note, index) => {
    const button = document.createElement("button");
    button.className = "note-choice-btn";
    button.textContent = note;
    button.dataset.index = String(index);

    if (state.hasAnswered) {
      if (index === state.correctIndex) {
        button.classList.add("correct");
      } else if (!state.wasCorrect) {
        button.classList.add("incorrect");
      }
    }

    button.addEventListener("click", () => handleChoice(index));
    container.appendChild(button);
  });
}

function setupEventListeners(): void {
  const playBtn = document.getElementById("play-btn")!;
  playBtn.addEventListener("click", () => {
    if (!isPlaying()) {
      playCurrentNote();
    }
  });

  const doneBtn = document.getElementById("done-btn")!;
  doneBtn.addEventListener("click", () => {
    state.showingHistory = true;
    render();
  });

  // Clean up previous keyboard handler if any
  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
  }

  keyboardHandler = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      handleChoice(0);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      handleChoice(1);
    } else if (e.key === " " && state.hasAnswered) {
      e.preventDefault();
      nextExercise();
    }
  };

  document.addEventListener("keydown", keyboardHandler);

  // Clean up on navigation
  const cleanupOnNavigate = () => {
    if (keyboardHandler) {
      document.removeEventListener("keydown", keyboardHandler);
      keyboardHandler = null;
    }
    window.removeEventListener("hashchange", cleanupOnNavigate);
  };
  window.addEventListener("hashchange", cleanupOnNavigate);
}

function playCurrentNote(): void {
  const correctNote = state.choices[state.correctIndex];
  playNote(correctNote, { duration: 0.8 });
}

function nextExercise(): void {
  initExercise(true);
  render();
  playCurrentNote();
}

function handleChoice(chosenIndex: number): void {
  if (state.hasAnswered) {
    nextExercise();
    return;
  }

  state.hasAnswered = true;
  state.wasCorrect = chosenIndex === state.correctIndex;
  state.total++;

  // Record history
  const correctNote = state.choices[state.correctIndex];
  const chosenNote = state.choices[chosenIndex];
  state.history.push({
    prompt: correctNote,
    userAnswer: chosenNote,
    correctAnswer: correctNote,
    correct: state.wasCorrect,
  });

  if (state.wasCorrect) {
    state.correct++;
  }

  renderChoiceButtons();
  renderFeedback();
  updateScore();
}

function renderFeedback(): void {
  const feedback = document.getElementById("feedback")!;
  const correctNote = state.choices[state.correctIndex];

  if (state.wasCorrect) {
    feedback.className = "feedback success";
    feedback.textContent = "Correct! Press Space or click to continue.";
  } else {
    feedback.className = "feedback error";
    feedback.textContent = `That was ${correctNote}. Press Space or click to continue.`;
  }
}

function updateScore(): void {
  const scoreEl = document.getElementById("score")!;
  scoreEl.textContent = `${state.correct} / ${state.total}`;
}

export function renderNoteChoice(): void {
  initExercise();
  render();
  playCurrentNote();
}
