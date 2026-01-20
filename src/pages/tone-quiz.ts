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
  FULL_TONES,
} from "../lib/tone-quiz-state.js";

const NOTE_DURATION = 0.6;
const GAP_BETWEEN_NOTES = 300; // ms
const INTRO_NOTE_DURATION = 0.5;
const INTRO_NOTE_GAP = 150; // ms

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
  countsForStreak: boolean; // False for retries/repeats
  startTime: number;
}

// Introduction mode state
interface IntroductionState {
  introducedNote: FullTone;
  vocabNotes: FullTone[]; // All vocab notes in chromatic order
}

let persistentState: ToneQuizState;
let question: QuestionState;
let introState: IntroductionState | null = null;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
let autoAdvanceTimeout: ReturnType<typeof setTimeout> | null = null;
let shouldRetry = false; // Whether next advance should retry same question
let shouldRepeatSwapped = false; // Whether to repeat correct answer with swapped order
let isPlaying = false; // Whether audio is currently playing

const AUTO_ADVANCE_DELAY = 750; // ms
const RETRY_CHANCE = 1.0; // Always retry after wrong answer until correct
const REPEAT_CORRECT_CHANCE = 0.3; // 30% chance to repeat after correct answer

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

function initQuestion(): { isNewTarget: boolean; introducedNote: FullTone | null } {
  // Select target note (with stickiness - stays until 3 correct in a row)
  const [targetNote, targetOctave, isNewTarget, isFirstOnTarget, updatedState, introducedNote] =
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
    countsForStreak: true, // New questions count
    startTime: Date.now(),
  };

  return { isNewTarget, introducedNote };
}

async function playBothNotes(): Promise<void> {
  isPlaying = true;
  await playNote(question.noteA, { duration: NOTE_DURATION });
  await new Promise((resolve) => setTimeout(resolve, GAP_BETWEEN_NOTES));
  await playNote(question.noteB, { duration: NOTE_DURATION });
  isPlaying = false;
}

function flashScreen(): void {
  const app = document.getElementById("app")!;
  app.classList.add("flash");
  setTimeout(() => app.classList.remove("flash"), 300);
}

/** Get vocab notes in chromatic order */
function getVocabInChromaticOrder(): FullTone[] {
  return FULL_TONES.filter((n) =>
    persistentState.learningVocabulary.includes(n)
  );
}

/** Start introduction mode for a new note */
function startIntroduction(note: FullTone): void {
  introState = {
    introducedNote: note,
    vocabNotes: getVocabInChromaticOrder(),
  };
  renderIntroduction();
  playIntroductionSequence();
}

/** Play introduction sequence: note in 3 octaves, then vocab in order */
async function playIntroductionSequence(): Promise<void> {
  if (!introState) return;

  isPlaying = true;

  const octaveButtons = document.querySelectorAll("#octave-buttons .intro-note-btn");
  const vocabButtons = document.querySelectorAll("#vocab-buttons .intro-note-btn");

  // Play the introduced note in 3 octaves
  const octaves = [3, 4, 5];
  for (let i = 0; i < octaves.length; i++) {
    const btn = octaveButtons[i];
    btn?.classList.add("playing");
    await playNote(`${introState.introducedNote}${octaves[i]}`, {
      duration: INTRO_NOTE_DURATION,
    });
    await new Promise((r) => setTimeout(r, INTRO_NOTE_GAP));
    btn?.classList.remove("playing");
  }

  // Brief pause before vocab
  await new Promise((r) => setTimeout(r, 400));

  // Play all vocab notes in chromatic order (octave 4)
  for (let i = 0; i < introState.vocabNotes.length; i++) {
    const btn = vocabButtons[i];
    btn?.classList.add("playing");
    await playNote(`${introState.vocabNotes[i]}4`, { duration: INTRO_NOTE_DURATION });
    await new Promise((r) => setTimeout(r, INTRO_NOTE_GAP));
    btn?.classList.remove("playing");
  }

  isPlaying = false;
}

/** Render the introduction UI */
function renderIntroduction(): void {
  if (!introState) return;

  const app = document.getElementById("app")!;
  const note = introState.introducedNote;

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Tone Quiz</h1>

    <div class="exercise-container">
      <div class="introduction-title">
        <h2>Introducing ${note}</h2>
        <p>Click any button to hear that note.</p>
      </div>

      <div class="intro-section">
        <h3>${note} in three octaves</h3>
        <div class="intro-buttons" id="octave-buttons"></div>
      </div>

      <div class="intro-section">
        <h3>All notes you're currently learning (Octave 4)</h3>
        <div class="intro-buttons" id="vocab-buttons"></div>
      </div>

      <div class="controls">
        <button class="play-again-btn" id="replay-intro-btn">Replay All</button>
        <button class="check-button" id="continue-btn">Continue to Quiz</button>
      </div>
    </div>
  `;

  setupIntroExploreButtons();
  setupIntroEventListeners();
}

/** Setup the clickable buttons for explore phase */
function setupIntroExploreButtons(): void {
  if (!introState) return;

  const note = introState.introducedNote;

  // Octave buttons
  const octaveContainer = document.getElementById("octave-buttons")!;
  for (const octave of [3, 4, 5]) {
    const btn = document.createElement("button");
    btn.className = "intro-note-btn";
    btn.textContent = `${note}${octave}`;
    btn.addEventListener("click", () => {
      playNote(`${note}${octave}`, { duration: INTRO_NOTE_DURATION });
    });
    octaveContainer.appendChild(btn);
  }

  // Vocab buttons
  const vocabContainer = document.getElementById("vocab-buttons")!;
  for (const vocabNote of introState.vocabNotes) {
    const btn = document.createElement("button");
    btn.className = "intro-note-btn";
    if (vocabNote === note) {
      btn.classList.add("intro-note-highlighted");
    }
    btn.textContent = vocabNote;
    btn.addEventListener("click", () => {
      playNote(`${vocabNote}4`, { duration: INTRO_NOTE_DURATION });
    });
    vocabContainer.appendChild(btn);
  }
}

/** Setup event listeners for introduction mode */
function setupIntroEventListeners(): void {
  const continueBtn = document.getElementById("continue-btn");
  if (continueBtn) {
    continueBtn.addEventListener("click", finishIntroduction);
  }

  const replayBtn = document.getElementById("replay-intro-btn");
  if (replayBtn) {
    replayBtn.addEventListener("click", replayIntroSequence);
  }

  // Add keyboard handler for introduction mode
  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
  }

  keyboardHandler = (e: KeyboardEvent) => {
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      replayIntroSequence();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!isPlaying) {
        finishIntroduction();
      }
    }
  };

  document.addEventListener("keydown", keyboardHandler);
}

/** Replay the full introduction sequence */
async function replayIntroSequence(): Promise<void> {
  if (!introState || isPlaying) return;
  await playIntroductionSequence();
}

/** Finish introduction and return to normal quiz */
function finishIntroduction(): void {
  introState = null;
  render();
  playBothNotes();
}

function render(): void {
  const app = document.getElementById("app")!;

  const recentHistory = persistentState.history.slice(-20);
  const recentCorrect = recentHistory.filter((r) => r.correct).length;
  const totalPlayed = persistentState.history.length;
  const vocabDisplay = persistentState.learningVocabulary.join(", ");

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Tone Quiz</h1>
    <p>Two notes play. Identify the named note.</p>
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
        <a href="#/exercises/tone-quiz/stats" class="stats-link">View Stats</a>
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

    button.addEventListener("click", () => {
      if (question.hasAnswered && !question.wasCorrect) {
        // After wrong answer, clicking plays the note
        const noteToPlay = index === 0 ? question.noteA : question.noteB;
        playNote(noteToPlay, { duration: NOTE_DURATION });
      } else {
        handleChoice(index);
      }
    });
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
      if (isPlaying) return; // Don't advance while audio is playing
      if (question.hasAnswered) {
        advanceToNext();
      }
      // Space no longer replays - use R for that
    }
  };

  document.addEventListener("keydown", keyboardHandler);

  const cleanupOnNavigate = () => {
    if (keyboardHandler) {
      document.removeEventListener("keydown", keyboardHandler);
      keyboardHandler = null;
    }
    clearAutoAdvance();
    window.removeEventListener("hashchange", cleanupOnNavigate);
  };
  window.addEventListener("hashchange", cleanupOnNavigate);
}

function advanceToNext(): void {
  if (shouldRetry) {
    shouldRetry = false;
    retryQuestion();
  } else if (shouldRepeatSwapped) {
    shouldRepeatSwapped = false;
    retryQuestion(); // retryQuestion already randomizes order
  } else {
    nextQuestion();
  }
}

function handleChoice(chosenIndex: number): void {
  if (question.hasAnswered) {
    advanceToNext();
    return;
  }

  const chosenFamily = chosenIndex === 0 ? question.familyA : question.familyB;
  const isCorrect = chosenFamily === question.targetNote;

  question.hasAnswered = true;
  question.wasCorrect = isCorrect;

  // Decide next action
  if (isCorrect) {
    // 30% chance to repeat with swapped order (doesn't count for streak)
    shouldRepeatSwapped = Math.random() < REPEAT_CORRECT_CHANCE;
  } else {
    // 70% chance to retry on wrong answer
    shouldRetry = Math.random() < RETRY_CHANCE;
  }

  // Record to persistent state
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

  // Only update streak if this question counts and won't be repeated
  if (question.countsForStreak && !shouldRepeatSwapped) {
    persistentState = updateStreak(persistentState, isCorrect);
  }
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
    // Auto-advance after delay
    autoAdvanceTimeout = setTimeout(advanceToNext, AUTO_ADVANCE_DELAY);
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

function clearAutoAdvance(): void {
  if (autoAdvanceTimeout) {
    clearTimeout(autoAdvanceTimeout);
    autoAdvanceTimeout = null;
  }
}

/** Retry the same question with randomized order */
function retryQuestion(): void {
  clearAutoAdvance();

  // Keep same notes but randomize order
  const targetWithOctave = question.familyA === question.targetNote
    ? question.noteA
    : question.noteB;
  const otherWithOctave = question.familyA === question.targetNote
    ? question.noteB
    : question.noteA;

  const [first, second] = randomizeOrder(
    { note: targetWithOctave, family: question.targetNote },
    { note: otherWithOctave, family: question.otherNote }
  );

  question = {
    noteA: first.note,
    noteB: second.note,
    familyA: first.family,
    familyB: second.family,
    targetNote: question.targetNote,
    otherNote: question.otherNote,
    hasAnswered: false,
    wasCorrect: null,
    isFirstInStreak: false, // Retry never counts for familiarity
    countsForStreak: false, // Retries/repeats don't count for streak
    startTime: Date.now(),
  };

  render();
  playBothNotes();
}

function nextQuestion(): void {
  clearAutoAdvance();
  const { isNewTarget, introducedNote } = initQuestion();

  // If a new note was introduced, start introduction mode
  if (introducedNote) {
    startIntroduction(introducedNote);
    return;
  }

  render();
  if (isNewTarget) {
    flashScreen();
  }
  playBothNotes();
}

export function renderToneQuiz(): void {
  persistentState = loadState();
  const { introducedNote } = initQuestion();

  // If a new note was introduced on first load (shouldn't happen normally),
  // start introduction mode
  if (introducedNote) {
    startIntroduction(introducedNote);
    return;
  }

  render();
  playBothNotes();
}
