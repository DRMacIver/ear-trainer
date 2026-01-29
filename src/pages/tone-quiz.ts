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
  isInNewNoteFocusMode,
  startNewNoteFocus,
  consumeNewNoteFocusQuestion,
  shouldTriggerOrdering,
  getVocabInChromaticOrder,
  recordOrderingResult,
  enterOrderingMode,
  incrementOrderingInterval,
  AVAILABLE_OCTAVES,
  ToneQuizState,
  FullTone,
  FULL_TONES,
  QuestionType,
} from "../lib/tone-quiz-state.js";

const NOTE_DURATION = 0.6;
const GAP_BETWEEN_NOTES = 300; // ms
const INTRO_NOTE_DURATION = 0.5;
const INTRO_NOTE_GAP = 150; // ms
const ORDERING_NOTE_GAP = 400; // ms between notes in ordering sequence

/** Shuffle an array using Fisher-Yates algorithm */
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

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

interface OrderingQuestionState {
  questionType: "ordering";
  notesPlayed: { note: FullTone; octave: number }[]; // Notes in play order
  correctOrder: FullTone[]; // Chromatic order
  userOrder: (FullTone | null)[]; // User's current arrangement
  hasConfirmed: boolean;
  wrongPositions: number[]; // Indices of incorrect positions after confirm
  attemptCount: number; // Number of attempts on this question
}

// Introduction mode state (for new notes)
interface IntroductionState {
  introducedNote: FullTone;
  vocabNotes: FullTone[]; // All vocab notes in chromatic order
}

let persistentState: ToneQuizState;
let question: QuestionState;
let orderingQuestion: OrderingQuestionState | null = null;
let introState: IntroductionState | null = null;

// Practice mode: locks to a specific exercise type, no unlocks
type PracticeMode = "two-note" | "single-note" | "ordering" | null;
let practiceMode: PracticeMode = null;
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

/** Show a temporary modal overlay with a message */
function showModal(message: string, onDismiss?: () => void): void {
  // Remove any existing modal
  const existing = document.getElementById("note-change-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "note-change-modal";
  modal.className = "note-change-modal";
  modal.innerHTML = `<div class="note-change-content">${message}</div>`;
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

type TransitionInfo = {
  showModal: boolean;
  modalMessage?: string;
  isOrdering?: boolean;
};

/** Initialize an ordering question */
function initOrderingQuestion(): void {
  const vocab = persistentState.learningVocabulary;
  const correctOrder = getVocabInChromaticOrder(vocab);

  // Create notes in random order with random octaves
  const notesPlayed = shuffleArray(
    vocab.map((note) => ({
      note,
      octave: AVAILABLE_OCTAVES[Math.floor(Math.random() * AVAILABLE_OCTAVES.length)],
    }))
  );

  orderingQuestion = {
    questionType: "ordering",
    notesPlayed,
    correctOrder,
    userOrder: new Array(vocab.length).fill(null),
    hasConfirmed: false,
    wrongPositions: [],
    attemptCount: 0,
  };

  // Enter ordering mode
  persistentState = enterOrderingMode(persistentState);
  saveState(persistentState);
}

/** Initialize a new question. Returns transition info for modal display. */
function initQuestion(): TransitionInfo {
  const prevQuestionType = lastQuestionType;

  // Practice mode: force specific exercise type
  if (practiceMode === "ordering") {
    initOrderingQuestion();
    return { showModal: false, isOrdering: true };
  }

  // Check for ordering question trigger first (only in normal mode)
  if (!practiceMode && shouldTriggerOrdering(persistentState)) {
    initOrderingQuestion();
    return { showModal: true, modalMessage: "Order the Notes", isOrdering: true };
  }

  // Clear any previous ordering state
  orderingQuestion = null;

  // In practice mode, skip forced variants and accelerated mode
  if (!practiceMode) {
    // Check for a forced variant from accelerated mode
    const [forcedVariant, updatedState] = consumeForcedVariant(persistentState);
    if (forcedVariant) {
      persistentState = updatedState;
      saveState(persistentState);
      const isNewTarget = initQuestionFromVariant(forcedVariant);
      return getTransitionInfo(prevQuestionType, question.questionType, isNewTarget);
    }
  }

  // Decide question type based on what's available and stickiness
  const twoToneVariants = getUnlockedTwoToneVariants(persistentState);
  const singleNoteVariants = getUnlockedSingleNoteVariants(persistentState);

  let questionType: QuestionType;

  // Practice mode forces specific type
  if (practiceMode === "two-note") {
    questionType = "two-note";
  } else if (practiceMode === "single-note") {
    questionType = "single-note";
  } else if (isInNewNoteFocusMode(persistentState)) {
    // Force two-note when in new note focus mode
    questionType = "two-note";
  } else if (singleNoteVariants.length === 0) {
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
    return getTransitionInfo(prevQuestionType, "single-note", false);
  } else {
    const isNewTarget = initTwoNoteQuestion();
    return getTransitionInfo(prevQuestionType, "two-note", isNewTarget);
  }
}

/** Determine what modal to show based on question type transition */
function getTransitionInfo(
  prevType: QuestionType | null,
  newType: QuestionType,
  isNewTarget: boolean
): TransitionInfo {
  // Switching to single-note
  if (newType === "single-note" && prevType !== "single-note") {
    return { showModal: true, modalMessage: "Single Tones" };
  }

  // Switching to two-note or target changed within two-note
  if (newType === "two-note") {
    if (prevType !== "two-note") {
      // Switching from single-note to two-note
      return { showModal: true, modalMessage: `Two Tones: <strong>${question.targetNote}</strong>` };
    } else if (isNewTarget) {
      // Staying on two-note but target changed
      return { showModal: true, modalMessage: `Two Tones: <strong>${question.targetNote}</strong>` };
    }
  }

  return { showModal: false };
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

/** Play all notes for an ordering question */
async function playOrderingNotes(): Promise<void> {
  if (!orderingQuestion) return;

  isPlaying = true;

  for (let i = 0; i < orderingQuestion.notesPlayed.length; i++) {
    const { note, octave } = orderingQuestion.notesPlayed[i];
    await playNote(`${note}${octave}`, { duration: NOTE_DURATION });
    if (i < orderingQuestion.notesPlayed.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, ORDERING_NOTE_GAP));
    }
  }

  isPlaying = false;
}

/** Get current vocab notes in chromatic order (for introduction UI) */
function getCurrentVocabInChromaticOrder(): FullTone[] {
  return FULL_TONES.filter((n) =>
    persistentState.learningVocabulary.includes(n)
  );
}

/** Start introduction mode for a new note */
function startIntroduction(note: FullTone): void {
  introState = {
    introducedNote: note,
    vocabNotes: getCurrentVocabInChromaticOrder(),
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

// ============================================================================
// Ordering Question UI
// ============================================================================

/** Render the ordering question UI */
function renderOrdering(): void {
  if (!orderingQuestion) return;

  const app = document.getElementById("app")!;
  const isTouch = isTouchDevice();
  const vocabDisplay = persistentState.learningVocabulary.join(", ");
  const recentHistory = persistentState.history.slice(-20);
  const recentCorrect = recentHistory.filter((r) => r.correct).length;
  const totalPlayed = persistentState.history.length;

  // Get notes that are placed and available
  const placedNotes = new Set(orderingQuestion.userOrder.filter((n): n is FullTone => n !== null));
  const availableNotes = orderingQuestion.correctOrder.filter((n) => !placedNotes.has(n));

  // Position labels
  const positionLabels = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

  const practiceBanner = practiceMode
    ? `<div class="practice-mode-banner">
        <span>Practice Mode: Ordering</span>
        <a href="#/quiz">Exit Practice</a>
      </div>`
    : "";

  app.innerHTML = `
    <h1>Tone Quiz</h1>
    ${practiceBanner}
    <p>Drag the notes into chromatic order (lowest to highest).</p>
    ${isTouch ? "" : `<p class="keyboard-hints"><strong>Keys:</strong> <kbd>R</kbd> Replay All</p>`}

    <div class="exercise-container">
      <div class="controls">
        <button class="play-again-btn" id="replay-ordering-btn">Replay All</button>
      </div>

      <div class="ordering-section">
        <h3>Arrange in order:</h3>
        <div class="ordering-drop-zones" id="drop-zones">
          ${orderingQuestion.correctOrder
            .map((_, i) => {
              const placed = orderingQuestion!.userOrder[i];
              const isWrong = orderingQuestion!.wrongPositions.includes(i);
              const slotClass = `ordering-slot${placed ? " filled" : ""}${isWrong ? " wrong" : ""}`;
              return `
                <div class="ordering-slot-container">
                  <div class="${slotClass}" data-slot="${i}" data-note="${placed || ""}">
                    ${placed || ""}
                  </div>
                  <span class="ordering-slot-label">${positionLabels[i]}</span>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>

      <div class="ordering-section">
        <h3>Available notes:</h3>
        <div class="ordering-available" id="available-notes">
          ${availableNotes
            .map(
              (note) => `
                <div class="ordering-note" draggable="true" data-note="${note}">${note}</div>
              `
            )
            .join("")}
        </div>
      </div>

      <div class="ordering-actions">
        <button class="check-button" id="confirm-ordering-btn" ${
          placedNotes.size !== orderingQuestion.correctOrder.length ? "disabled" : ""
        }>Confirm</button>
      </div>

      <div id="ordering-feedback"></div>

      ${practiceMode ? "" : `
      <div class="stats">
        <span class="stats-label">Recent:</span>
        <span>${recentCorrect} / ${recentHistory.length}</span>
        <span class="stats-label" style="margin-left: 1rem;">Total:</span>
        <span>${totalPlayed}</span>
      </div>
      `}

      <div class="learning-info">
        <span class="stats-label">Learning:</span>
        <span>${vocabDisplay}</span>
        ${practiceMode ? "" : '<a href="#/stats" class="stats-link">View Stats</a>'}
        <a href="#/about" class="stats-link">About</a>
      </div>

      ${practiceMode ? "" : `
      <div class="danger-zone">
        <button class="danger-btn" id="clear-history-btn">Clear History</button>
        <p class="danger-warning">This will reset all your progress</p>
      </div>
      `}
    </div>
  `;

  setupOrderingEventListeners();
}

/** Handle drag start for ordering notes */
function handleDragStart(e: DragEvent): void {
  const target = e.target as HTMLElement;
  const note = target.dataset.note;
  if (!note) return;

  e.dataTransfer!.setData("text/plain", note);
  e.dataTransfer!.effectAllowed = "move";
  target.classList.add("dragging");
}

/** Handle drag end */
function handleDragEnd(e: DragEvent): void {
  const target = e.target as HTMLElement;
  target.classList.remove("dragging");

  // Remove all drag-over states
  document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
}

/** Handle drag over for drop zones */
function handleDragOver(e: DragEvent): void {
  e.preventDefault();
  e.dataTransfer!.dropEffect = "move";
  const target = e.target as HTMLElement;
  const slot = target.closest(".ordering-slot");
  if (slot) {
    slot.classList.add("drag-over");
  }
}

/** Handle drag leave for drop zones */
function handleDragLeave(e: DragEvent): void {
  const target = e.target as HTMLElement;
  const slot = target.closest(".ordering-slot");
  if (slot) {
    slot.classList.remove("drag-over");
  }
}

/** Handle drop on a slot */
function handleDrop(e: DragEvent): void {
  e.preventDefault();
  if (!orderingQuestion) return;

  const target = e.target as HTMLElement;
  const slot = target.closest(".ordering-slot") as HTMLElement;
  if (!slot) return;

  slot.classList.remove("drag-over");

  const droppedNote = e.dataTransfer!.getData("text/plain") as FullTone;
  const slotIndex = parseInt(slot.dataset.slot!, 10);
  const existingNote = orderingQuestion.userOrder[slotIndex];

  // Find where the dropped note came from (if it was in a slot)
  const sourceIndex = orderingQuestion.userOrder.indexOf(droppedNote);

  // If there's a note in the target slot, swap them
  if (existingNote) {
    if (sourceIndex >= 0) {
      // Swap: move existing note to source position
      orderingQuestion.userOrder[sourceIndex] = existingNote;
    }
    // If source was available pool, existing note goes back to pool (handled by placing new note)
  } else if (sourceIndex >= 0) {
    // Clear the source slot
    orderingQuestion.userOrder[sourceIndex] = null;
  }

  // Place the dropped note
  orderingQuestion.userOrder[slotIndex] = droppedNote;

  // Clear confirmation state when user modifies
  orderingQuestion.hasConfirmed = false;
  orderingQuestion.wrongPositions = [];

  renderOrdering();
}

/** Handle drop back to available notes pool */
function handleDropToPool(e: DragEvent): void {
  e.preventDefault();
  if (!orderingQuestion) return;

  const droppedNote = e.dataTransfer!.getData("text/plain") as FullTone;
  const sourceIndex = orderingQuestion.userOrder.indexOf(droppedNote);

  if (sourceIndex >= 0) {
    orderingQuestion.userOrder[sourceIndex] = null;
    orderingQuestion.hasConfirmed = false;
    orderingQuestion.wrongPositions = [];
    renderOrdering();
  }
}

/** Handle click on a slot to return note to pool */
function handleSlotClick(e: MouseEvent): void {
  if (!orderingQuestion) return;

  const target = e.target as HTMLElement;
  const slot = target.closest(".ordering-slot") as HTMLElement;
  if (!slot || !slot.classList.contains("filled")) return;

  const slotIndex = parseInt(slot.dataset.slot!, 10);
  orderingQuestion.userOrder[slotIndex] = null;
  orderingQuestion.hasConfirmed = false;
  orderingQuestion.wrongPositions = [];
  renderOrdering();
}

/** Check the ordering answer */
function checkOrderingAnswer(): void {
  if (!orderingQuestion) return;

  const wrong: number[] = [];
  for (let i = 0; i < orderingQuestion.correctOrder.length; i++) {
    if (orderingQuestion.userOrder[i] !== orderingQuestion.correctOrder[i]) {
      wrong.push(i);
    }
  }

  orderingQuestion.wrongPositions = wrong;
  orderingQuestion.hasConfirmed = true;
  orderingQuestion.attemptCount++;

  const isCorrect = wrong.length === 0;

  // In practice mode, skip state recording
  if (!practiceMode) {
    persistentState = recordOrderingResult(persistentState, isCorrect);
    saveState(persistentState);
  }

  renderOrdering();
  renderOrderingFeedback(isCorrect);
}

/** Render feedback for ordering question */
function renderOrderingFeedback(isCorrect: boolean): void {
  const feedback = document.getElementById("ordering-feedback")!;
  const isTouch = isTouchDevice();
  const continueHint = isTouch ? "Tap to continue" : "Press Space to continue";

  if (isCorrect) {
    // Show streak info only in normal mode
    const streakInfo =
      !practiceMode && persistentState.orderingCorrectStreak > 0
        ? ` (${persistentState.orderingCorrectStreak}/3 correct)`
        : "";
    feedback.className = "feedback success feedback-tappable";
    feedback.innerHTML = `Correct!${streakInfo} <span class="continue-hint">${continueHint}.</span>`;
    feedback.onclick = advanceFromOrdering;
  } else {
    feedback.className = "feedback error";
    const wrongCount = orderingQuestion!.wrongPositions.length;
    feedback.innerHTML = `
      ${wrongCount} note${wrongCount > 1 ? "s" : ""} in the wrong position. Try again!
      <br><button id="retry-ordering-btn" class="play-again-btn" style="margin-top: 0.5rem;">Replay Notes</button>
    `;
    const retryBtn = document.getElementById("retry-ordering-btn");
    if (retryBtn) {
      retryBtn.addEventListener("click", playOrderingNotes);
    }
  }
}

/** Advance from a correct ordering answer */
function advanceFromOrdering(): void {
  clearAutoAdvance();

  // In practice mode, stay in ordering practice
  if (practiceMode === "ordering") {
    initOrderingQuestion();
    renderOrdering();
    playOrderingNotes();
    return;
  }

  // Check if exited ordering mode (3 correct in a row)
  if (!persistentState.isInOrderingMode) {
    // Continue to next regular question
    orderingQuestion = null;
    nextQuestion();
  } else {
    // Stay in ordering mode, new ordering question
    initOrderingQuestion();
    renderOrdering();
    playOrderingNotes();
  }
}

/** Setup event listeners for ordering question */
function setupOrderingEventListeners(): void {
  // Replay button
  const replayBtn = document.getElementById("replay-ordering-btn");
  if (replayBtn) {
    replayBtn.addEventListener("click", playOrderingNotes);
  }

  // Confirm button
  const confirmBtn = document.getElementById("confirm-ordering-btn");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", checkOrderingAnswer);
  }

  // Clear history button
  const clearBtn = document.getElementById("clear-history-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", handleClearHistory);
  }

  // Drag-and-drop for available notes
  const availableNotes = document.querySelectorAll(".ordering-note");
  availableNotes.forEach((note) => {
    note.addEventListener("dragstart", (e) => handleDragStart(e as DragEvent));
    note.addEventListener("dragend", (e) => handleDragEnd(e as DragEvent));
  });

  // Drag-and-drop for slots (both for placing and swapping)
  const slots = document.querySelectorAll(".ordering-slot");
  slots.forEach((slot) => {
    slot.addEventListener("dragover", (e) => handleDragOver(e as DragEvent));
    slot.addEventListener("dragleave", (e) => handleDragLeave(e as DragEvent));
    slot.addEventListener("drop", (e) => handleDrop(e as DragEvent));
    slot.addEventListener("click", (e) => handleSlotClick(e as MouseEvent));

    // Make filled slots draggable
    if (slot.classList.contains("filled")) {
      (slot as HTMLElement).draggable = true;
      slot.addEventListener("dragstart", (e) => handleDragStart(e as DragEvent));
      slot.addEventListener("dragend", (e) => handleDragEnd(e as DragEvent));
    }
  });

  // Allow dropping back to available pool
  const availablePool = document.getElementById("available-notes");
  if (availablePool) {
    availablePool.addEventListener("dragover", (e) => e.preventDefault());
    availablePool.addEventListener("drop", (e) => handleDropToPool(e as DragEvent));
  }

  // Keyboard handler
  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
  }

  keyboardHandler = (e: KeyboardEvent) => {
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      playOrderingNotes();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (isPlaying) return;
      if (orderingQuestion?.hasConfirmed && orderingQuestion.wrongPositions.length === 0) {
        advanceFromOrdering();
      }
    }
  };

  document.addEventListener("keydown", keyboardHandler);

  // Cleanup on navigation
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

// ============================================================================
// Regular Question UI
// ============================================================================

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

  const practiceModeName = practiceMode === "two-note" ? "Two-Note" : "Single-Note";
  const practiceBanner = practiceMode
    ? `<div class="practice-mode-banner">
        <span>Practice Mode: ${practiceModeName}</span>
        <a href="#/quiz">Exit Practice</a>
      </div>`
    : "";

  app.innerHTML = `
    <h1>Tone Quiz</h1>
    ${practiceBanner}
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

      ${practiceMode ? "" : `
      <div class="stats">
        <span class="stats-label">Recent:</span>
        <span id="score">${recentCorrect} / ${recentHistory.length}</span>
        <span class="stats-label" style="margin-left: 1rem;">Total:</span>
        <span>${totalPlayed}</span>
      </div>
      `}

      <div class="learning-info">
        <span class="stats-label">Learning:</span>
        <span>${vocabDisplay}</span>
        ${practiceMode ? "" : '<a href="#/stats" class="stats-link">View Stats</a>'}
        <a href="#/about" class="stats-link">About</a>
      </div>

      ${practiceMode ? "" : `
      <div class="danger-zone">
        <button class="danger-btn" id="clear-history-btn">Clear History</button>
        <p class="danger-warning">This will reset all your progress</p>
      </div>
      `}
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

  // Clear history button only exists in normal mode
  const clearBtn = document.getElementById("clear-history-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", handleClearHistory);
  }

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

  // In practice mode, skip progression (no unlocks, no history recording)
  if (practiceMode) {
    renderChoiceButtons();
    renderFeedback();
    return;
  }

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

  // Increment ordering interval for non-ordering questions
  persistentState = incrementOrderingInterval(persistentState);
  saveState(persistentState);

  const transition = initQuestion();

  // Handle ordering vs regular questions
  if (transition.isOrdering) {
    renderOrdering();
    if (transition.showModal && transition.modalMessage) {
      showModal(transition.modalMessage, playOrderingNotes);
    } else {
      playOrderingNotes();
    }
  } else {
    render();
    if (transition.showModal && transition.modalMessage) {
      showModal(transition.modalMessage, playQuestionNotes);
    } else {
      playQuestionNotes();
    }
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

/** Render the practice mode selection page */
export function renderPracticeSelection(): void {
  const app = document.getElementById("app")!;
  const state = loadState();
  const hasEnoughNotes = state.learningVocabulary.length >= 3;

  app.innerHTML = `
    <a href="#/quiz" class="back-link">&larr; Back to Quiz</a>
    <h1>Practice Mode</h1>
    <p class="intro-subtitle">Practice-only (no unlocks)</p>

    <div class="exercise-container practice-selection">
      <div class="intro-section">
        <p>Practice a specific exercise type without affecting your progression. Results here don't count toward unlocks.</p>
      </div>

      <div class="practice-options">
        <a href="#/practice/two-note" class="practice-option">
          <h3>Two-Note Comparison</h3>
          <p>Two notes play - identify which one is the target note.</p>
        </a>

        <a href="#/practice/single-note" class="practice-option">
          <h3>Single-Note Identification</h3>
          <p>One note plays - identify it from two choices.</p>
        </a>

        <a href="#/practice/ordering" class="practice-option ${hasEnoughNotes ? "" : "disabled"}">
          <h3>Note Ordering</h3>
          <p>All notes play - arrange them in chromatic order.</p>
          ${hasEnoughNotes ? "" : "<span class='practice-disabled-note'>Requires 3+ notes in vocabulary</span>"}
        </a>
      </div>

      <div class="intro-section">
        <p><small>Tip: Access this page via <code>#/practice</code> in the URL.</small></p>
      </div>
    </div>
  `;
}

/** Start a practice mode session */
export function renderPracticeMode(mode: PracticeMode): void {
  practiceMode = mode;
  persistentState = loadState();
  pendingIntroducedNote = null;

  // For ordering, need at least 3 notes
  if (mode === "ordering" && persistentState.learningVocabulary.length < 3) {
    window.location.hash = "#/practice";
    return;
  }

  const transition = initQuestion();

  if (transition.isOrdering) {
    renderOrdering();
    playOrderingNotes();
  } else {
    render();
    playQuestionNotes();
  }
}

export function renderToneQuiz(): void {
  practiceMode = null; // Reset practice mode on quiz entry
  persistentState = loadState();
  pendingIntroducedNote = null; // Reset on page load
  const transition = initQuestion();

  // Handle ordering vs regular questions
  if (transition.isOrdering) {
    renderOrdering();
    if (transition.showModal && transition.modalMessage) {
      showModal(transition.modalMessage, playOrderingNotes);
    } else {
      playOrderingNotes();
    }
  } else {
    render();
    if (transition.showModal && transition.modalMessage) {
      showModal(transition.modalMessage, playQuestionNotes);
    } else {
      playQuestionNotes();
    }
  }
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
