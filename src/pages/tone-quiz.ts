/**
 * Tone Quiz Exercise
 *
 * Two tones play. User identifies which one was a particular note.
 * Features adaptive learning with stickiness and progressive difficulty.
 */

import { playNote, shuffle } from "../audio.js";
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
  phase: "title" | "matching";
  // Matching exercise state
  targetNotes: FullTone[]; // Notes in correct order (chromatic)
  assignments: (FullTone | null)[]; // Current assignments to drop zones
  availableNotes: FullTone[]; // Notes not yet assigned
  hasChecked: boolean;
  incorrectPositions: Set<number>;
  isComplete: boolean;
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
const RETRY_CHANCE = 0.7; // 70% chance to retry after wrong answer
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
  const vocabInOrder = getVocabInChromaticOrder();
  introState = {
    introducedNote: note,
    phase: "title",
    targetNotes: vocabInOrder,
    assignments: new Array(vocabInOrder.length).fill(null),
    availableNotes: shuffle([...vocabInOrder]) as FullTone[],
    hasChecked: false,
    incorrectPositions: new Set(),
    isComplete: false,
  };
  renderIntroduction();
  playIntroductionSequence();
}

/** Play introduction sequence: note in 3 octaves, then vocab in order */
async function playIntroductionSequence(): Promise<void> {
  if (!introState) return;

  isPlaying = true;

  // Play the introduced note in 3 octaves
  for (const octave of [3, 4, 5]) {
    await playNote(`${introState.introducedNote}${octave}`, {
      duration: INTRO_NOTE_DURATION,
    });
    await new Promise((r) => setTimeout(r, INTRO_NOTE_GAP));
  }

  // Brief pause before vocab
  await new Promise((r) => setTimeout(r, 400));

  // Play all vocab notes in chromatic order (octave 4)
  for (const note of introState.targetNotes) {
    await playNote(`${note}4`, { duration: INTRO_NOTE_DURATION });
    await new Promise((r) => setTimeout(r, INTRO_NOTE_GAP));
  }

  isPlaying = false;

  // Transition to matching phase
  introState.phase = "matching";
  renderIntroduction();
}

/** Render the introduction UI */
function renderIntroduction(): void {
  if (!introState) return;

  const app = document.getElementById("app")!;

  if (introState.phase === "title") {
    app.innerHTML = `
      <a href="#/" class="back-link">&larr; Back to exercises</a>
      <h1>Tone Quiz</h1>

      <div class="exercise-container">
        <div class="introduction-title">
          <h2>Introducing ${introState.introducedNote}</h2>
          <p>Listen to the note in three octaves, then all your notes in order...</p>
        </div>
      </div>
    `;
    return;
  }

  // Matching phase
  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Tone Quiz</h1>

    <div class="exercise-container">
      <div class="introduction-title">
        <h2>Introducing ${introState.introducedNote}</h2>
        <p>Now put the notes back in order (lowest to highest).</p>
      </div>

      <div class="sound-buttons" id="sound-buttons"></div>

      <div>
        <h3>Available Notes</h3>
        <div class="available-notes" id="available-notes"></div>
      </div>

      <div class="controls">
        <button class="play-again-btn" id="replay-intro-btn">Replay All Notes</button>
        <button class="check-button" id="check-btn">Check Order</button>
      </div>

      <div id="feedback"></div>
    </div>
  `;

  renderIntroSoundButtons();
  renderIntroAvailableNotes();
  setupIntroEventListeners();
}

/** Render sound buttons for introduction matching */
function renderIntroSoundButtons(): void {
  if (!introState) return;
  const state = introState; // Local reference for closure

  const container = document.getElementById("sound-buttons")!;
  container.innerHTML = "";

  state.targetNotes.forEach((note, index) => {
    const div = document.createElement("div");
    div.className = "sound-button";

    const button = document.createElement("button");
    button.textContent = `Sound ${index + 1}`;
    button.addEventListener("click", () => playNote(`${note}4`, { duration: INTRO_NOTE_DURATION }));

    const dropZone = document.createElement("div");
    dropZone.className = "drop-zone";
    dropZone.dataset.index = String(index);

    if (state.hasChecked) {
      if (state.incorrectPositions.has(index)) {
        dropZone.classList.add("incorrect");
      } else if (state.assignments[index] !== null) {
        dropZone.classList.add("correct");
      }
    }

    const assignedNote = state.assignments[index];
    if (assignedNote) {
      const chip = createIntroNoteChip(assignedNote);
      dropZone.appendChild(chip);
    }

    setupIntroDropZone(dropZone);

    div.appendChild(button);
    div.appendChild(dropZone);
    container.appendChild(div);
  });
}

/** Render available notes for introduction matching */
function renderIntroAvailableNotes(): void {
  if (!introState) return;

  const container = document.getElementById("available-notes")!;
  container.innerHTML = "";

  introState.availableNotes.forEach((note) => {
    const chip = createIntroNoteChip(note);
    container.appendChild(chip);
  });

  setupIntroAvailableNotesDropZone(container);
}

/** Create a draggable note chip */
function createIntroNoteChip(note: FullTone): HTMLElement {
  const chip = document.createElement("div");
  chip.className = "note-chip";
  chip.textContent = note;
  chip.draggable = true;
  chip.dataset.note = note;

  chip.addEventListener("dragstart", (e) => {
    chip.classList.add("dragging");
    e.dataTransfer!.setData("text/plain", note);
    e.dataTransfer!.effectAllowed = "move";
  });

  chip.addEventListener("dragend", () => {
    chip.classList.remove("dragging");
  });

  // Click to play the note
  chip.addEventListener("click", () => {
    playNote(`${note}4`, { duration: INTRO_NOTE_DURATION });
  });

  return chip;
}

/** Setup drop zone for a sound slot */
function setupIntroDropZone(dropZone: HTMLElement): void {
  if (!introState) return;

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (!introState) return;

    const note = e.dataTransfer!.getData("text/plain") as FullTone;
    const targetIndex = parseInt(dropZone.dataset.index!, 10);

    const sourceAssignmentIndex = introState.assignments.indexOf(note);
    const sourceAvailableIndex = introState.availableNotes.indexOf(note);
    const existingNote = introState.assignments[targetIndex];

    if (sourceAvailableIndex !== -1) {
      introState.availableNotes.splice(sourceAvailableIndex, 1);
      if (existingNote) {
        introState.availableNotes.push(existingNote);
      }
    }

    if (sourceAssignmentIndex !== -1 && sourceAssignmentIndex !== targetIndex) {
      introState.assignments[sourceAssignmentIndex] = existingNote;
    }

    introState.assignments[targetIndex] = note;

    if (introState.hasChecked) {
      introState.hasChecked = false;
      introState.incorrectPositions.clear();
    }

    renderIntroSoundButtons();
    renderIntroAvailableNotes();
    updateIntroCheckButton();
  });
}

/** Setup available notes area as drop zone */
function setupIntroAvailableNotesDropZone(container: HTMLElement): void {
  if (!introState) return;

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    container.classList.add("drag-over");
  });

  container.addEventListener("dragleave", () => {
    container.classList.remove("drag-over");
  });

  container.addEventListener("drop", (e) => {
    e.preventDefault();
    container.classList.remove("drag-over");
    if (!introState) return;

    const note = e.dataTransfer!.getData("text/plain") as FullTone;

    const assignmentIndex = introState.assignments.indexOf(note);
    if (assignmentIndex !== -1) {
      introState.assignments[assignmentIndex] = null;
    }

    if (!introState.availableNotes.includes(note)) {
      introState.availableNotes.push(note);
    }

    if (introState.hasChecked) {
      introState.hasChecked = false;
      introState.incorrectPositions.clear();
    }

    renderIntroSoundButtons();
    renderIntroAvailableNotes();
    updateIntroCheckButton();
  });
}

/** Setup event listeners for introduction mode */
function setupIntroEventListeners(): void {
  const checkBtn = document.getElementById("check-btn")!;
  checkBtn.addEventListener("click", checkIntroAnswers);

  const replayBtn = document.getElementById("replay-intro-btn");
  if (replayBtn) {
    replayBtn.addEventListener("click", replayIntroNotes);
  }

  updateIntroCheckButton();

  // Add keyboard handler for introduction mode
  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
  }

  keyboardHandler = (e: KeyboardEvent) => {
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      replayIntroNotes();
    }
  };

  document.addEventListener("keydown", keyboardHandler);
}

/** Replay all notes in intro sequence */
async function replayIntroNotes(): Promise<void> {
  if (!introState || isPlaying) return;

  isPlaying = true;

  // Play all vocab notes in chromatic order (octave 4)
  for (const note of introState.targetNotes) {
    await playNote(`${note}4`, { duration: INTRO_NOTE_DURATION });
    await new Promise((r) => setTimeout(r, INTRO_NOTE_GAP));
  }

  isPlaying = false;
}

/** Update check button state */
function updateIntroCheckButton(): void {
  if (!introState) return;

  const checkBtn = document.getElementById("check-btn") as HTMLButtonElement | null;
  if (checkBtn) {
    const allAssigned = introState.assignments.every((a) => a !== null);
    checkBtn.disabled = !allAssigned || introState.isComplete;
  }
}

/** Check if the matching is correct */
async function checkIntroAnswers(): Promise<void> {
  if (!introState) return;

  introState.hasChecked = true;
  introState.incorrectPositions.clear();

  let allCorrect = true;
  introState.assignments.forEach((assignedNote, index) => {
    if (assignedNote !== introState!.targetNotes[index]) {
      introState!.incorrectPositions.add(index);
      allCorrect = false;
    }
  });

  introState.isComplete = allCorrect;

  renderIntroSoundButtons();
  renderIntroFeedback(allCorrect);

  if (allCorrect) {
    // Play all notes with highlight, then transition to normal quiz
    await playIntroNotesWithHighlight();
    finishIntroduction();
  }
}

/** Render feedback for intro matching */
function renderIntroFeedback(allCorrect: boolean): void {
  if (!introState) return;

  const feedback = document.getElementById("feedback")!;
  if (allCorrect) {
    feedback.className = "feedback success";
    feedback.textContent = "Correct! Starting quiz...";
  } else {
    const wrongCount = introState.incorrectPositions.size;
    feedback.className = "feedback error";
    feedback.textContent = `${wrongCount} ${wrongCount === 1 ? "note is" : "notes are"} in the wrong position. Try again!`;
  }
}

/** Play all notes with visual highlight */
async function playIntroNotesWithHighlight(): Promise<void> {
  if (!introState) return;

  const buttons = document.querySelectorAll(".sound-button");
  isPlaying = true;

  for (let i = 0; i < introState.targetNotes.length; i++) {
    const button = buttons[i];
    button.classList.add("playing");

    await playNote(`${introState.targetNotes[i]}4`, { duration: INTRO_NOTE_DURATION });
    await new Promise((r) => setTimeout(r, INTRO_NOTE_GAP + 100));

    button.classList.remove("playing");
  }

  isPlaying = false;
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
