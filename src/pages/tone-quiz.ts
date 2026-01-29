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
  getLastIntroducedNote,
  getUnlockedTwoToneVariants,
  getUnlockedSingleNoteVariants,
  getUnplayedTwoToneVariants,
  getUnplayedSingleNoteVariants,
  parseVariantKey,
  consumeForcedVariant,
  startNewNoteFocus,
  consumeNewNoteFocusQuestion,
  ToneQuizState,
  FullTone,
  FULL_TONES,
  QuestionType,
} from "../lib/tone-quiz-state.js";

const NOTE_DURATION = 0.6;
const GAP_BETWEEN_NOTES = 300; // ms
const INTRO_NOTE_DURATION = 0.5;
const INTRO_NOTE_GAP = 150; // ms

/** Detect if user is on a touch device (mobile/tablet) */
function isTouchDevice(): boolean {
  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

interface QuestionState {
  questionType: QuestionType;
  note1: string; // First note played (with octave), or the only note for single-note
  note2: string; // Second note played (with octave), empty for single-note
  family1: FullTone; // Note family of first note
  family2: FullTone; // Note family of second note (same as family1 for single-note)
  targetNote: FullTone; // Correct answer (which note was played for single-note)
  otherNote: FullTone; // The alternative choice
  hasAnswered: boolean;
  wasCorrect: boolean | null;
  startTime: number;
  // For single-note questions: which option is displayed first (randomized)
  displayOrder: [FullTone, FullTone];
  // Variant key for progression tracking
  variantKey: string;
}

// Introduction mode state (for new notes)
interface IntroductionState {
  introducedNote: FullTone;
  vocabNotes: FullTone[]; // All vocab notes in chromatic order
}

let persistentState: ToneQuizState;
let question: QuestionState;
let introState: IntroductionState | null = null;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
let cleanupHandler: (() => void) | null = null; // Track cleanup to prevent stale handlers
let autoAdvanceTimeout: ReturnType<typeof setTimeout> | null = null;
let shouldRetry = false; // Whether next advance should retry same question
let isPlaying = false; // Whether audio is currently playing

// Track the last question type for stickiness
let lastQuestionType: QuestionType | null = null;

// Note stickiness for two-tone questions (stay on same target note for 3-6 questions)
let currentStickyNote: FullTone | null = null;
let questionsRemainingOnNote = 0;

const AUTO_ADVANCE_DELAY = 750; // ms
/** Probability of staying on the same question type (two-note vs single-note) */
const TYPE_STICKINESS = 0.7;
/** Min/max questions to stay on same target note for two-tone */
const NOTE_STICKY_MIN = 3;
const NOTE_STICKY_MAX = 6;

/** Show a temporary modal overlay indicating the note has changed */
function showNoteChangeModal(note: FullTone, onDismiss?: () => void): void {
  // Remove any existing modal
  const existing = document.getElementById("note-change-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "note-change-modal";
  modal.className = "note-change-modal";
  modal.innerHTML = `<div class="note-change-content">Note change: <strong>${note}</strong></div>`;
  document.body.appendChild(modal);

  // Trigger entrance animation
  requestAnimationFrame(() => modal.classList.add("visible"));

  // Remove after 1.5 seconds, then call callback
  setTimeout(() => {
    modal.classList.remove("visible");
    setTimeout(() => {
      modal.remove();
      if (onDismiss) onDismiss();
    }, 300); // Wait for fade out
  }, 1500);
}

/** Initialize a new question. Returns true if target note changed (for flash). */
function initQuestion(): boolean {
  // Check for a forced variant from accelerated mode
  const [forcedVariant, updatedState] = consumeForcedVariant(persistentState);
  if (forcedVariant) {
    persistentState = updatedState;
    saveState(persistentState);
    return initQuestionFromVariant(forcedVariant);
  }

  // Decide question type based on what's available and stickiness
  const twoToneVariants = getUnlockedTwoToneVariants(persistentState);
  const singleNoteVariants = getUnlockedSingleNoteVariants(persistentState);

  let questionType: QuestionType;

  if (singleNoteVariants.length === 0) {
    // Only two-tone available
    questionType = "two-note";
  } else if (twoToneVariants.length === 0) {
    // Only single-note available (shouldn't happen, but handle it)
    questionType = "single-note";
  } else if (lastQuestionType !== null && Math.random() < TYPE_STICKINESS) {
    // 70% chance to stay on same type
    questionType = lastQuestionType;
  } else {
    // Randomly pick type (weighted towards two-note since it's more common)
    questionType = Math.random() < 0.6 ? "two-note" : "single-note";
  }

  lastQuestionType = questionType;

  if (questionType === "single-note") {
    initSingleNoteQuestion();
    return false; // No flash for single-note
  } else {
    return initTwoNoteQuestion();
  }
}

/** Initialize a question from a specific variant (used by accelerated mode) */
function initQuestionFromVariant(variantKey: string): boolean {
  const { pair, questionType, octaves } = parseVariantKey(variantKey);
  const [pairNote1, pairNote2] = pair.split("-") as [FullTone, FullTone];

  lastQuestionType = questionType;

  if (questionType === "single-note") {
    const octave = octaves as number;
    // Randomly pick which note to play
    const [noteToPlay, alternative] =
      Math.random() < 0.5 ? [pairNote1, pairNote2] : [pairNote2, pairNote1];
    const playedWithOctave = `${noteToPlay}${octave}`;
    const displayOrder = randomizeOrder(noteToPlay, alternative);

    question = {
      questionType: "single-note",
      note1: playedWithOctave,
      note2: "",
      family1: noteToPlay,
      family2: noteToPlay,
      targetNote: noteToPlay,
      otherNote: alternative,
      hasAnswered: false,
      wasCorrect: null,
      startTime: Date.now(),
      displayOrder,
      variantKey,
    };
    return false; // No flash for single-note
  } else {
    const [octave1, octave2] = octaves as [number, number];
    // Randomly pick which note is the target
    const [targetNote, otherNote] =
      Math.random() < 0.5 ? [pairNote1, pairNote2] : [pairNote2, pairNote1];

    // Octaves match the pair order
    const targetOctave = targetNote === pairNote1 ? octave1 : octave2;
    const otherOctave = otherNote === pairNote1 ? octave1 : octave2;

    const targetWithOctave = `${targetNote}${targetOctave}`;
    const otherWithOctave = `${otherNote}${otherOctave}`;

    // Randomize play order
    const [first, second] = randomizeOrder(
      { note: targetWithOctave, family: targetNote },
      { note: otherWithOctave, family: otherNote }
    );

    // Check if target changed (for flash)
    const isNewTarget = currentStickyNote !== null && targetNote !== currentStickyNote;

    // Update stickiness
    currentStickyNote = targetNote;
    questionsRemainingOnNote = NOTE_STICKY_MIN +
      Math.floor(Math.random() * (NOTE_STICKY_MAX - NOTE_STICKY_MIN + 1)) - 1;

    question = {
      questionType: "two-note",
      note1: first.note,
      note2: second.note,
      family1: first.family,
      family2: second.family,
      targetNote,
      otherNote,
      hasAnswered: false,
      wasCorrect: null,
      startTime: Date.now(),
      displayOrder: [first.family, second.family],
      variantKey,
    };

    return isNewTarget;
  }
}

/** Initialize a random single-note question from unlocked variants */
function initSingleNoteQuestion(): void {
  const unlockedVariants = getUnlockedSingleNoteVariants(persistentState);
  if (unlockedVariants.length === 0) {
    // Fallback to two-note if no single-note variants
    initTwoNoteQuestion();
    return;
  }

  // Prioritize unplayed variants if any exist
  const unplayedVariants = getUnplayedSingleNoteVariants(persistentState);
  const variantsToChooseFrom = unplayedVariants.length > 0 ? unplayedVariants : unlockedVariants;

  // Pick a random variant (preferring unplayed)
  const selectedVariant =
    variantsToChooseFrom[Math.floor(Math.random() * variantsToChooseFrom.length)];
  const { pair, octaves } = parseVariantKey(selectedVariant);
  const [pairNote1, pairNote2] = pair.split("-") as [FullTone, FullTone];

  // Randomly pick which note to play
  const [noteToPlay, alternative] =
    Math.random() < 0.5 ? [pairNote1, pairNote2] : [pairNote2, pairNote1];

  const playedOctave = octaves as number;
  const playedWithOctave = `${noteToPlay}${playedOctave}`;

  // Randomize display order for the choice buttons
  const displayOrder = randomizeOrder(noteToPlay, alternative);

  question = {
    questionType: "single-note",
    note1: playedWithOctave,
    note2: "",
    family1: noteToPlay,
    family2: noteToPlay,
    targetNote: noteToPlay,
    otherNote: alternative,
    hasAnswered: false,
    wasCorrect: null,
    startTime: Date.now(),
    displayOrder,
    variantKey: selectedVariant,
  };
}

/** Initialize a random two-note question from unlocked variants */
function initTwoNoteQuestion(): boolean {
  const unlockedVariants = getUnlockedTwoToneVariants(persistentState);
  if (unlockedVariants.length === 0) {
    throw new Error("No unlocked two-tone variants");
  }

  let targetNote: FullTone;
  let isNewTarget = false;
  let variantsToChooseFrom: string[];

  // Check for new note focus mode FIRST - highest priority
  const [focusNote, updatedState] = consumeNewNoteFocusQuestion(persistentState);
  if (focusNote) {
    persistentState = updatedState;
    saveState(persistentState);

    // Use focus note as target, pick random other from vocab
    targetNote = focusNote;
    isNewTarget = currentStickyNote !== null && targetNote !== currentStickyNote;

    // Update stickiness to match focus
    currentStickyNote = targetNote;
    questionsRemainingOnNote = persistentState.newNoteFocusRemaining;

    // Find variants for this target
    variantsToChooseFrom = unlockedVariants.filter((v) => {
      const { pair } = parseVariantKey(v);
      const [a, b] = pair.split("-") as [FullTone, FullTone];
      return a === targetNote || b === targetNote;
    });
  } else if (getUnplayedTwoToneVariants(persistentState).length > 0) {
    // Check for unplayed variants - they take priority over stickiness
    const unplayedVariants = getUnplayedTwoToneVariants(persistentState);
    // Prioritize unplayed variants - pick a target note from them
    const unplayedNotes = new Set<FullTone>();
    for (const variant of unplayedVariants) {
      const { pair } = parseVariantKey(variant);
      const [a, b] = pair.split("-") as [FullTone, FullTone];
      unplayedNotes.add(a);
      unplayedNotes.add(b);
    }
    const noteArray = Array.from(unplayedNotes);
    targetNote = noteArray[Math.floor(Math.random() * noteArray.length)];

    // Check if this is a new target
    isNewTarget = currentStickyNote !== null && targetNote !== currentStickyNote;

    // Update stickiness
    currentStickyNote = targetNote;
    questionsRemainingOnNote =
      NOTE_STICKY_MIN + Math.floor(Math.random() * (NOTE_STICKY_MAX - NOTE_STICKY_MIN + 1)) - 1;

    // Find unplayed variants for this target
    variantsToChooseFrom = unplayedVariants.filter((v) => {
      const { pair } = parseVariantKey(v);
      const [a, b] = pair.split("-") as [FullTone, FullTone];
      return a === targetNote || b === targetNote;
    });
  } else if (questionsRemainingOnNote > 0 && currentStickyNote !== null) {
    // No unplayed variants - follow normal stickiness
    targetNote = currentStickyNote;
    questionsRemainingOnNote--;

    // Find variants for this target
    variantsToChooseFrom = unlockedVariants.filter((v) => {
      const { pair } = parseVariantKey(v);
      const [a, b] = pair.split("-") as [FullTone, FullTone];
      return a === targetNote || b === targetNote;
    });
  } else {
    // Pick a new target note
    const availableNotes = new Set<FullTone>();
    for (const variant of unlockedVariants) {
      const { pair } = parseVariantKey(variant);
      const [a, b] = pair.split("-") as [FullTone, FullTone];
      availableNotes.add(a);
      availableNotes.add(b);
    }

    // Filter out current note to ensure we pick a DIFFERENT one
    let noteArray = Array.from(availableNotes);
    if (currentStickyNote !== null && noteArray.length > 1) {
      noteArray = noteArray.filter(n => n !== currentStickyNote);
    }
    targetNote = noteArray[Math.floor(Math.random() * noteArray.length)];

    // Always a new target when stickiness expires
    isNewTarget = currentStickyNote !== null && targetNote !== currentStickyNote;

    // Set stickiness for 3-6 questions
    currentStickyNote = targetNote;
    questionsRemainingOnNote =
      NOTE_STICKY_MIN + Math.floor(Math.random() * (NOTE_STICKY_MAX - NOTE_STICKY_MIN + 1)) - 1;

    // Find variants for this target
    variantsToChooseFrom = unlockedVariants.filter((v) => {
      const { pair } = parseVariantKey(v);
      const [a, b] = pair.split("-") as [FullTone, FullTone];
      return a === targetNote || b === targetNote;
    });
  }

  // Pick a random variant (preferring unplayed)
  const selectedVariant =
    variantsToChooseFrom[Math.floor(Math.random() * variantsToChooseFrom.length)];
  const { pair, octaves } = parseVariantKey(selectedVariant);
  const [octave1, octave2] = octaves as [number, number];
  const [pairNote1, pairNote2] = pair.split("-") as [FullTone, FullTone];

  // The other note is the one that's not the target
  const otherNote = pairNote1 === targetNote ? pairNote2 : pairNote1;

  // Octaves match the pair order (pairNote1 gets octave1, pairNote2 gets octave2)
  const targetOctave = targetNote === pairNote1 ? octave1 : octave2;
  const otherOctave = otherNote === pairNote1 ? octave1 : octave2;

  const targetWithOctave = `${targetNote}${targetOctave}`;
  const otherWithOctave = `${otherNote}${otherOctave}`;

  // Randomize which plays first
  const [first, second] = randomizeOrder(
    { note: targetWithOctave, family: targetNote },
    { note: otherWithOctave, family: otherNote }
  );

  question = {
    questionType: "two-note",
    note1: first.note,
    note2: second.note,
    family1: first.family,
    family2: second.family,
    targetNote,
    otherNote,
    hasAnswered: false,
    wasCorrect: null,
    startTime: Date.now(),
    displayOrder: [targetNote, otherNote],
    variantKey: selectedVariant,
  };

  return isNewTarget;
}

async function playQuestionNotes(): Promise<void> {
  isPlaying = true;
  await playNote(question.note1, { duration: NOTE_DURATION });
  if (question.questionType === "two-note") {
    await new Promise((resolve) => setTimeout(resolve, GAP_BETWEEN_NOTES));
    await playNote(question.note2, { duration: NOTE_DURATION });
  }
  isPlaying = false;
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

  const octaveButtons = document.querySelectorAll(
    "#octave-buttons .intro-note-btn"
  );
  const vocabButtons = document.querySelectorAll(
    "#vocab-buttons .intro-note-btn"
  );

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
    await playNote(`${introState.vocabNotes[i]}4`, {
      duration: INTRO_NOTE_DURATION,
    });
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
  const tapOrClick = isTouchDevice() ? "Tap" : "Click";

  app.innerHTML = `
    <h1>Tone Quiz</h1>

    <div class="exercise-container">
      <div class="introduction-title">
        <h2>Introducing ${note}</h2>
        <p>${tapOrClick} any button to hear that note.</p>
      </div>

      <div class="intro-section">
        <h3>${note} in three octaves</h3>
        <div class="intro-buttons" id="octave-buttons"></div>
      </div>

      <div class="intro-section">
        <h3>All notes you're currently learning (Octave 4)</h3>
        <div class="intro-buttons" id="vocab-buttons"></div>
      </div>

      <div class="controls intro-controls">
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
  // Start new note focus mode for the introduced note
  if (introState) {
    persistentState = startNewNoteFocus(persistentState, introState.introducedNote);
    saveState(persistentState);
  }
  introState = null;
  initQuestion();
  render();
  playQuestionNotes();
}

function render(): void {
  const app = document.getElementById("app")!;

  const recentHistory = persistentState.history.slice(-20);
  const recentCorrect = recentHistory.filter((r) => r.correct).length;
  const totalPlayed = persistentState.history.length;
  const vocabDisplay = persistentState.learningVocabulary.join(", ");

  const isSingleNote = question.questionType === "single-note";
  const isTouch = isTouchDevice();
  const description = isSingleNote
    ? "A note plays. Identify which note it is."
    : "Two notes play. Identify the named note.";
  const keyHints = isSingleNote
    ? `<kbd>1</kbd>/<kbd>←</kbd> ${question.displayOrder[0]}, <kbd>2</kbd>/<kbd>→</kbd> ${question.displayOrder[1]}, <kbd>R</kbd> Replay, <kbd>Space</kbd> Continue`
    : "<kbd>1</kbd>/<kbd>←</kbd> First, <kbd>2</kbd>/<kbd>→</kbd> Second, <kbd>R</kbd> Replay, <kbd>Space</kbd> Continue";
  const questionText = isSingleNote
    ? `Is this ${question.displayOrder[0]} or ${question.displayOrder[1]}?`
    : `Which was the ${question.targetNote}?`;

  app.innerHTML = `
    <h1>Tone Quiz</h1>
    <p>${description}</p>
    ${isTouch ? "" : `<p class="keyboard-hints"><strong>Keys:</strong> ${keyHints}</p>`}

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="play-btn">Play Again</button>
      </div>

      <div>
        <h3>${questionText}</h3>
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
        <a href="#/stats" class="stats-link">View Stats</a>
        <a href="#/about" class="stats-link">About</a>
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

  const isSingleNote = question.questionType === "single-note";

  // For two-note: "First" and "Second"
  // For single-note: use displayOrder (randomized between target and other)
  const choices = isSingleNote
    ? [
        { label: question.displayOrder[0], family: question.displayOrder[0] },
        { label: question.displayOrder[1], family: question.displayOrder[1] },
      ]
    : [
        { label: "First", family: question.family1 },
        { label: "Second", family: question.family2 },
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
      if (question.hasAnswered && !question.wasCorrect && !isSingleNote) {
        // After wrong answer on two-note, clicking plays the note
        const noteToPlay = index === 0 ? question.note1 : question.note2;
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
    window.location.hash = "#/";
  }
}

function setupEventListeners(): void {
  const playBtn = document.getElementById("play-btn")!;
  playBtn.addEventListener("click", playQuestionNotes);

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
      playQuestionNotes();
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

  // Remove any stale cleanup handler before registering new one
  if (cleanupHandler) {
    window.removeEventListener("hashchange", cleanupHandler);
  }

  cleanupHandler = () => {
    if (keyboardHandler) {
      document.removeEventListener("keydown", keyboardHandler);
      keyboardHandler = null;
    }
    clearAutoAdvance();
    if (cleanupHandler) {
      window.removeEventListener("hashchange", cleanupHandler);
      cleanupHandler = null;
    }
  };
  window.addEventListener("hashchange", cleanupHandler);
}

function advanceToNext(): void {
  if (shouldRetry) {
    shouldRetry = false;
    retryQuestion();
  } else {
    nextQuestion();
  }
}

// Track pending introduction (set by recordQuestion when a note is unlocked)
let pendingIntroducedNote: FullTone | null = null;

function handleChoice(chosenIndex: number): void {
  if (question.hasAnswered) {
    advanceToNext();
    return;
  }

  const isSingleNote = question.questionType === "single-note";

  // For two-note: first choice is family1, second is family2
  // For single-note: check if chosen option in displayOrder is the target
  let isCorrect: boolean;
  if (isSingleNote) {
    isCorrect = question.displayOrder[chosenIndex] === question.targetNote;
  } else {
    const chosenFamily =
      chosenIndex === 0 ? question.family1 : question.family2;
    isCorrect = chosenFamily === question.targetNote;
  }

  question.hasAnswered = true;
  question.wasCorrect = isCorrect;

  // Retry on wrong answer until correct
  shouldRetry = !isCorrect;

  // Save previous state to detect note introductions
  const prevState = persistentState;

  // Record to persistent state - all questions count for progression
  persistentState = recordQuestion(persistentState, {
    timestamp: Date.now(),
    questionType: question.questionType,
    noteA: question.note1,
    noteB: question.note2,
    targetNote: question.targetNote,
    otherNote: question.otherNote,
    correct: isCorrect,
    wasFirstInStreak: true, // All questions count
    timeMs: Date.now() - question.startTime,
    variantKey: question.variantKey,
  });

  // Check if a note was just introduced
  pendingIntroducedNote = getLastIntroducedNote(prevState, persistentState);

  saveState(persistentState);

  renderChoiceButtons();
  renderFeedback();
  updateStats();
}

function renderFeedback(): void {
  const feedback = document.getElementById("feedback")!;
  const isSingleNote = question.questionType === "single-note";
  const isTouch = isTouchDevice();
  const continueHint = isTouch ? "Tap to continue" : "Press Space to continue";

  if (question.wasCorrect) {
    feedback.className = "feedback success feedback-tappable";
    feedback.innerHTML = `Correct! <span class="continue-hint">${continueHint}.</span>`;
    feedback.onclick = advanceToNext;
    // Auto-advance after delay
    autoAdvanceTimeout = setTimeout(advanceToNext, AUTO_ADVANCE_DELAY);
  } else {
    feedback.className = "feedback error";

    if (isSingleNote) {
      feedback.innerHTML = `
        Incorrect. That was ${question.targetNote}, not ${question.otherNote}.
        <br><button id="replay-btn" class="play-again-btn" style="margin-top: 0.5rem;">Replay Note</button>
        <br><span class="continue-hint feedback-tappable" id="continue-hint">${continueHint}.</span>
      `;
    } else {
      const targetPosition =
        question.family1 === question.targetNote ? "first" : "second";
      feedback.innerHTML = `
        Incorrect. The ${question.targetNote} was ${targetPosition} (the other note was ${question.otherNote}).
        <br><button id="replay-btn" class="play-again-btn" style="margin-top: 0.5rem;">Replay Both Notes</button>
        <br><span class="continue-hint feedback-tappable" id="continue-hint">${continueHint}.</span>
      `;
    }

    const replayBtn = document.getElementById("replay-btn");
    if (replayBtn) {
      replayBtn.addEventListener("click", playQuestionNotes);
    }

    const continueHintEl = document.getElementById("continue-hint");
    if (continueHintEl) {
      continueHintEl.onclick = advanceToNext;
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

/** Probability of swapping note order on retry */
const RETRY_SWAP_CHANCE = 0.8;

/** Retry the same question, swapping order 80% of the time */
function retryQuestion(): void {
  clearAutoAdvance();

  if (question.questionType === "single-note") {
    // For single-note questions, just reset the answer state
    question = {
      ...question,
      hasAnswered: false,
      wasCorrect: null,
      startTime: Date.now(),
    };
  } else {
    // Keep same notes but swap order 80% of the time
    const shouldSwap = Math.random() < RETRY_SWAP_CHANCE;

    const [first, second] = shouldSwap
      ? [
          { note: question.note2, family: question.family2 },
          { note: question.note1, family: question.family1 },
        ]
      : [
          { note: question.note1, family: question.family1 },
          { note: question.note2, family: question.family2 },
        ];

    question = {
      questionType: "two-note",
      note1: first.note,
      note2: second.note,
      family1: first.family,
      family2: second.family,
      targetNote: question.targetNote,
      otherNote: question.otherNote,
      hasAnswered: false,
      wasCorrect: null,
      startTime: Date.now(),
      displayOrder: [question.targetNote, question.otherNote],
      variantKey: question.variantKey,
    };
  }

  render();
  playQuestionNotes();
}

function nextQuestion(): void {
  clearAutoAdvance();

  // Check if a note was just introduced via the unlock system
  if (pendingIntroducedNote) {
    const noteToIntroduce = pendingIntroducedNote;
    pendingIntroducedNote = null;
    startIntroduction(noteToIntroduce);
    return;
  }

  const isNewTarget = initQuestion();
  render();
  if (isNewTarget) {
    // Show modal first, play notes after it dismisses
    showNoteChangeModal(question.targetNote, playQuestionNotes);
  } else {
    playQuestionNotes();
  }
}

function renderIntroPage(showBackLink: boolean): void {
  const app = document.getElementById("app")!;
  const isTouch = isTouchDevice();

  const backLink = showBackLink
    ? `<a href="#/quiz" class="back-link">&larr; Back to Quiz</a>`
    : "";

  const buttonText = showBackLink ? "Return to Quiz" : "Start Training";

  const keyboardTip = isTouch
    ? ""
    : `<li>Keyboard shortcuts: <kbd>1</kbd>/<kbd>←</kbd> first option, <kbd>2</kbd>/<kbd>→</kbd> second option, <kbd>R</kbd> replay</li>`;

  app.innerHTML = `
    ${backLink}
    <h1>Ear Trainer</h1>
    <p class="intro-subtitle">Perfect Pitch Training</p>

    <div class="exercise-container intro-container">
      <div class="intro-section">
        <h2>How it works</h2>
        <p>This exercise trains you to recognize musical notes by ear. You'll progress through increasingly difficult challenges:</p>

        <ol class="intro-steps">
          <li>Start with <strong>two-note comparison</strong>: Two notes play - identify which one was the target note (e.g., "Which was the C?").</li>
          <li>Progress to <strong>single-note identification</strong>: Once you're reliable at comparing notes, you'll hear just one note and identify it directly.</li>
          <li><strong>Expanding vocabulary:</strong> You start with C and G. As you master notes, new ones are introduced.</li>
        </ol>

        <p>Note: This is an experimental exercise, and is in fairly active development. I can't promise it will actually get you to perfect pitch, and the learning progression may be wildly off.</p>
      </div>

      <div class="intro-section">
        <h2>Tips</h2>
        <ul class="intro-tips">
          <li>Use headphones for best results</li>
          <li>The exercise adapts to your skill level automatically</li>
          <li>Your progress is saved in your browser</li>
          ${keyboardTip}
        </ul>
      </div>

      <div class="controls">
        <a href="#/quiz" class="check-button start-button">${buttonText}</a>
      </div>
    </div>
  `;
}

export function renderToneQuizIntro(): void {
  // If user has history, go directly to the quiz
  const state = loadState();
  if (state.history.length > 0) {
    window.location.hash = "#/quiz";
    return;
  }

  renderIntroPage(false);
}

export function renderToneQuizAbout(): void {
  renderIntroPage(true);
}

export function renderToneQuiz(): void {
  persistentState = loadState();
  pendingIntroducedNote = null; // Reset on page load
  initQuestion();

  render();
  playQuestionNotes();
}

// Clean up handlers on HMR to prevent stale handlers from persisting
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (keyboardHandler) {
      document.removeEventListener("keydown", keyboardHandler);
      keyboardHandler = null;
    }
    if (cleanupHandler) {
      window.removeEventListener("hashchange", cleanupHandler);
      cleanupHandler = null;
    }
    clearAutoAdvance();
  });
}
