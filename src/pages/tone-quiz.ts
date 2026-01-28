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
  maybeStartNewSession,
  getRepeatProbability,
  selectMostUrgentPair,
  getReadySingleNotePairs,
  findNoteReadyForOctaveIntro,
  introduceOctave,
  pickRandomUnlockedOctave,
  getUnlockedOctavesForNote,
  ToneQuizState,
  FullTone,
  FULL_TONES,
  QuestionType,
} from "../lib/tone-quiz-state.js";

const NOTE_DURATION = 0.6;
const GAP_BETWEEN_NOTES = 300; // ms
const INTRO_NOTE_DURATION = 0.5;
const INTRO_NOTE_GAP = 150; // ms

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
  isFirstInStreak: boolean;
  countsForStreak: boolean; // False for retries/repeats
  startTime: number;
  // For single-note questions: which option is displayed first (randomized)
  displayOrder: [FullTone, FullTone];
}

// Introduction mode state (for new notes)
interface IntroductionState {
  introducedNote: FullTone;
  vocabNotes: FullTone[]; // All vocab notes in chromatic order
}

// Octave introduction mode state (for unlocking new octaves)
interface OctaveIntroductionState {
  note: FullTone;
  newOctave: number;
  unlockedOctaves: number[]; // All unlocked octaves including the new one
}

let persistentState: ToneQuizState;
let question: QuestionState;
let introState: IntroductionState | null = null;
let octaveIntroState: OctaveIntroductionState | null = null;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
let autoAdvanceTimeout: ReturnType<typeof setTimeout> | null = null;
let shouldRetry = false; // Whether next advance should retry same question
let shouldRepeatSwapped = false; // Whether to repeat correct answer with swapped order
let isPlaying = false; // Whether audio is currently playing

// Single-note cycle queue: when non-empty, we're in a single-note cycle
// Each entry is a note to ask about (paired with another note from ready pairs)
let singleNoteQueue: FullTone[] = [];

const AUTO_ADVANCE_DELAY = 750; // ms
const RETRY_CHANCE = 1.0; // Always retry after wrong answer until correct
const REPEAT_CORRECT_CHANCE = 0.3; // 30% chance to repeat after correct answer
const MAX_SINGLE_NOTE_CYCLE = 6; // Cap single-note cycle at 6 notes

/** Pick octave for target note from unlocked octaves */
function pickTargetOctave(note: FullTone): number {
  return pickRandomUnlockedOctave(persistentState, note);
}

/**
 * Pick octave for the "other" note based on distance from target.
 * Uses octave 3 (for A/B) or octave 5 (for C/D) only if it keeps
 * the note within 4 diatonic steps of the target.
 */
function pickOtherOctave(target: FullTone, other: FullTone): number {
  const targetIdx = FULL_TONES.indexOf(target);
  const otherIdx = FULL_TONES.indexOf(other);

  // Pitch positions relative to C4=0, D4=1, ..., B4=6
  // Octave 3: B3=-1, A3=-2, etc.
  // Octave 5: C5=7, D5=8, etc.
  const targetPitch = targetIdx;
  const otherPitchOct4 = otherIdx;
  const otherPitchOct3 = otherIdx - 7;
  const otherPitchOct5 = otherIdx + 7;

  const distOct4 = Math.abs(otherPitchOct4 - targetPitch);
  const distOct3 = Math.abs(otherPitchOct3 - targetPitch);
  const distOct5 = Math.abs(otherPitchOct5 - targetPitch);

  // Use octave 3 for A/B only if it's closer AND within 4 steps
  if (
    (other === "A" || other === "B") &&
    distOct3 <= 4 &&
    distOct3 < distOct4
  ) {
    return 3;
  }

  // Use octave 5 for C/D only if it's closer AND within 4 steps
  if (
    (other === "C" || other === "D") &&
    distOct5 <= 4 &&
    distOct5 < distOct4
  ) {
    return 5;
  }

  return 4;
}

/** Probability of starting a single-note cycle when pairs are available */
const SINGLE_NOTE_CYCLE_CHANCE = 0.3;

/** Shuffle array in place using Fisher-Yates */
function shuffleArray<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

/** Start a single-note cycle by populating the queue with all notes from ready pairs */
function startSingleNoteCycle(): void {
  const readyPairs = getReadySingleNotePairs(persistentState);
  if (readyPairs.length === 0) return;

  // Get all unique notes from ready pairs
  const uniqueNotes = new Set<FullTone>();
  for (const [a, b] of readyPairs) {
    uniqueNotes.add(a);
    uniqueNotes.add(b);
  }

  // Convert to array, shuffle, and cap at MAX_SINGLE_NOTE_CYCLE
  const notes = Array.from(uniqueNotes);
  shuffleArray(notes);
  singleNoteQueue = notes.slice(0, MAX_SINGLE_NOTE_CYCLE);
}

interface InitQuestionResult {
  isNewTarget: boolean;
  introducedNote: FullTone | null;
  octaveIntro: { note: FullTone; octave: number } | null;
}

function initQuestion(): InitQuestionResult {
  const now = Date.now();

  // Maybe start new session (if inactive for more than 5 minutes)
  persistentState = maybeStartNewSession(persistentState, now);

  // Check if any note is ready for octave introduction
  const octaveReady = findNoteReadyForOctaveIntro(persistentState);
  if (octaveReady) {
    // Return special result indicating octave introduction needed
    return {
      isNewTarget: false,
      introducedNote: null,
      octaveIntro: octaveReady,
    };
  }

  // If we're in a single-note cycle, continue with it
  if (singleNoteQueue.length > 0) {
    return { ...initSingleNoteQuestion(), octaveIntro: null };
  }

  // Check if we should start a new single-note cycle
  const readyPairs = getReadySingleNotePairs(persistentState);
  if (readyPairs.length > 0 && Math.random() < SINGLE_NOTE_CYCLE_CHANCE) {
    startSingleNoteCycle();
    return { ...initSingleNoteQuestion(), octaveIntro: null };
  }

  // Roll for repeat based on session freshness
  const repeatProb = getRepeatProbability(persistentState, now);
  const shouldRepeat = Math.random() < repeatProb;

  if (shouldRepeat) {
    // Try to find most urgent review card
    const pair = selectMostUrgentPair(persistentState);
    if (pair) {
      // Use FSRS-selected pair
      return {
        ...initQuestionFromPair(pair.target, pair.other),
        octaveIntro: null,
      };
    }
  }

  // Fall through to normal selection
  return { ...initQuestionNormal(), octaveIntro: null };
}

/** Initialize a single-note question using the cycle queue */
function initSingleNoteQuestion(): {
  isNewTarget: boolean;
  introducedNote: FullTone | null;
} {
  // Pop the next note from the queue
  const noteToPlay = singleNoteQueue.pop();

  if (!noteToPlay) {
    // Queue empty, fallback to normal question
    return initQuestionNormal();
  }

  // Find a ready pair that includes this note
  const readyPairs = getReadySingleNotePairs(persistentState);
  const matchingPairs = readyPairs.filter(
    ([a, b]) => a === noteToPlay || b === noteToPlay
  );

  if (matchingPairs.length === 0) {
    // No matching pair found, fallback to normal question
    return initQuestionNormal();
  }

  // Pick a random matching pair
  const [pairNote1, pairNote2] =
    matchingPairs[Math.floor(Math.random() * matchingPairs.length)];

  // The note we're playing is noteToPlay, the alternative is the other note in the pair
  const alternative = pairNote1 === noteToPlay ? pairNote2 : pairNote1;

  // Pick from unlocked octaves for this note
  const playedOctave = pickTargetOctave(noteToPlay);
  const playedWithOctave = `${noteToPlay}${playedOctave}`;

  // Randomize display order for the choice buttons
  const displayOrder = randomizeOrder(noteToPlay, alternative);

  question = {
    questionType: "single-note",
    note1: playedWithOctave, // The note that will be played
    note2: "", // Not used for single-note
    family1: noteToPlay,
    family2: noteToPlay, // Same as family1 for single-note
    targetNote: noteToPlay, // The correct answer
    otherNote: alternative, // The wrong answer
    hasAnswered: false,
    wasCorrect: null,
    isFirstInStreak: true,
    countsForStreak: true,
    startTime: Date.now(),
    displayOrder,
  };

  return { isNewTarget: false, introducedNote: null };
}

/** Initialize question from a specific target-other pair (FSRS repeat) */
function initQuestionFromPair(
  targetNote: FullTone,
  otherNote: FullTone
): { isNewTarget: boolean; introducedNote: FullTone | null } {
  const targetOctave = pickTargetOctave(targetNote);
  const otherOctave = pickOtherOctave(targetNote, otherNote);

  const targetWithOctave = `${targetNote}${targetOctave}`;
  const otherWithOctave = `${otherNote}${otherOctave}`;

  // Randomize which plays first
  const [first, second] = randomizeOrder(
    { note: targetWithOctave, family: targetNote },
    { note: otherWithOctave, family: otherNote }
  );

  // Check if this is actually a new target vs current target
  const isNewTarget = targetNote !== persistentState.currentTarget;

  // Update current target state if changed
  if (isNewTarget) {
    persistentState = {
      ...persistentState,
      currentTarget: targetNote,
      currentTargetOctave: targetOctave,
      correctStreak: 0,
      isFirstOnTarget: false,
    };
  }

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
    isFirstInStreak: true, // FSRS repeats count for tracking
    countsForStreak: true,
    startTime: Date.now(),
    displayOrder: [targetNote, otherNote], // Not used for two-note questions
  };

  return { isNewTarget, introducedNote: null };
}

/** Initialize question using normal selection (adaptive difficulty) */
function initQuestionNormal(): {
  isNewTarget: boolean;
  introducedNote: FullTone | null;
} {
  // Select target note (with stickiness - stays until 3 correct in a row)
  const [
    targetNote,
    targetOctave,
    isNewTarget,
    isFirstOnTarget,
    updatedState,
    introducedNote,
  ] = selectTargetNote(persistentState, pickTargetOctave);
  persistentState = updatedState;

  // Select other note based on current learning progress
  const otherNote = selectOtherNote(persistentState, targetNote);
  const otherOctave = pickOtherOctave(targetNote, otherNote);

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
    isFirstInStreak: isFirstOnTarget,
    countsForStreak: true, // New questions count
    startTime: Date.now(),
    displayOrder: [targetNote, otherNote], // Not used for two-note questions
  };

  return { isNewTarget, introducedNote };
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

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back</a>
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
  playQuestionNotes();
}

// ============================================================================
// Octave Introduction Mode
// ============================================================================

/** Start octave introduction mode for a note getting a new octave */
function startOctaveIntroduction(note: FullTone, newOctave: number): void {
  // Update state to unlock the new octave
  persistentState = introduceOctave(persistentState, note, newOctave);
  saveState(persistentState);

  // Set up the introduction state
  octaveIntroState = {
    note,
    newOctave,
    unlockedOctaves: getUnlockedOctavesForNote(persistentState, note),
  };

  renderOctaveIntroduction();
  playOctaveIntroductionSequence();
}

/** Play octave introduction sequence: note in all unlocked octaves, then vocab context */
async function playOctaveIntroductionSequence(): Promise<void> {
  if (!octaveIntroState) return;

  isPlaying = true;

  const octaveButtons = document.querySelectorAll(
    "#octave-intro-buttons .intro-note-btn"
  );
  const vocabButtons = document.querySelectorAll(
    "#octave-vocab-buttons .intro-note-btn"
  );

  // Play the note in all unlocked octaves (in order)
  const octaves = octaveIntroState.unlockedOctaves;
  for (let i = 0; i < octaves.length; i++) {
    const btn = octaveButtons[i];
    btn?.classList.add("playing");
    await playNote(`${octaveIntroState.note}${octaves[i]}`, {
      duration: INTRO_NOTE_DURATION,
    });
    await new Promise((r) => setTimeout(r, INTRO_NOTE_GAP));
    btn?.classList.remove("playing");
  }

  // Brief pause before vocab context
  await new Promise((r) => setTimeout(r, 400));

  // Play vocabulary context in octave 4
  const vocabNotes = getVocabInChromaticOrder();
  for (let i = 0; i < vocabNotes.length; i++) {
    const btn = vocabButtons[i];
    btn?.classList.add("playing");
    await playNote(`${vocabNotes[i]}4`, { duration: INTRO_NOTE_DURATION });
    await new Promise((r) => setTimeout(r, INTRO_NOTE_GAP));
    btn?.classList.remove("playing");
  }

  isPlaying = false;
}

/** Render the octave introduction UI */
function renderOctaveIntroduction(): void {
  if (!octaveIntroState) return;

  const app = document.getElementById("app")!;
  const { note, newOctave, unlockedOctaves } = octaveIntroState;

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back</a>
    <h1>Tone Quiz</h1>

    <div class="exercise-container">
      <div class="introduction-title">
        <h2>Introducing ${note} in Octave ${newOctave}</h2>
        <p>Click any button to hear that note.</p>
      </div>

      <div class="intro-section">
        <h3>${note} in your unlocked octaves</h3>
        <div class="intro-buttons" id="octave-intro-buttons"></div>
      </div>

      <div class="intro-section">
        <h3>Vocabulary context (Octave 4)</h3>
        <div class="intro-buttons" id="octave-vocab-buttons"></div>
      </div>

      <div class="controls">
        <button class="play-again-btn" id="replay-octave-intro-btn">Replay All</button>
        <button class="check-button" id="continue-octave-btn">Continue to Quiz</button>
      </div>
    </div>
  `;

  // Set up octave buttons
  const octaveContainer = document.getElementById("octave-intro-buttons")!;
  for (const octave of unlockedOctaves) {
    const btn = document.createElement("button");
    btn.className = "intro-note-btn";
    if (octave === newOctave) {
      btn.classList.add("intro-note-highlighted");
    }
    btn.textContent = `${note}${octave}`;
    btn.addEventListener("click", () => {
      playNote(`${note}${octave}`, { duration: INTRO_NOTE_DURATION });
    });
    octaveContainer.appendChild(btn);
  }

  // Set up vocab context buttons
  const vocabContainer = document.getElementById("octave-vocab-buttons")!;
  const vocabNotes = getVocabInChromaticOrder();
  for (const vocabNote of vocabNotes) {
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

  setupOctaveIntroEventListeners();
}

/** Setup event listeners for octave introduction mode */
function setupOctaveIntroEventListeners(): void {
  const continueBtn = document.getElementById("continue-octave-btn");
  if (continueBtn) {
    continueBtn.addEventListener("click", finishOctaveIntroduction);
  }

  const replayBtn = document.getElementById("replay-octave-intro-btn");
  if (replayBtn) {
    replayBtn.addEventListener("click", replayOctaveIntroSequence);
  }

  // Add keyboard handler for octave introduction mode
  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
  }

  keyboardHandler = (e: KeyboardEvent) => {
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      replayOctaveIntroSequence();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!isPlaying) {
        finishOctaveIntroduction();
      }
    }
  };

  document.addEventListener("keydown", keyboardHandler);
}

/** Replay the octave introduction sequence */
async function replayOctaveIntroSequence(): Promise<void> {
  if (!octaveIntroState || isPlaying) return;
  await playOctaveIntroductionSequence();
}

/** Finish octave introduction and return to normal quiz */
function finishOctaveIntroduction(): void {
  octaveIntroState = null;
  const { introducedNote } = initQuestion();

  // If a new note was introduced, start note introduction
  if (introducedNote) {
    startIntroduction(introducedNote);
    return;
  }

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
    <a href="#/" class="back-link">&larr; Back</a>
    <h1>Tone Quiz</h1>
    <p>${description}</p>
    <p class="keyboard-hints"><strong>Keys:</strong> ${keyHints}</p>

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
    persistentState = loadState();
    initQuestion();
    render();
    playQuestionNotes();
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

  const isSingleNote = question.questionType === "single-note";

  // For two-note: first choice is family1, second is family2
  // For single-note: check if chosen option in displayOrder is the target
  let isCorrect: boolean;
  if (isSingleNote) {
    // displayOrder is randomized, check if chosen note is the target
    isCorrect = question.displayOrder[chosenIndex] === question.targetNote;
  } else {
    const chosenFamily =
      chosenIndex === 0 ? question.family1 : question.family2;
    isCorrect = chosenFamily === question.targetNote;
  }

  question.hasAnswered = true;
  question.wasCorrect = isCorrect;

  // Decide next action
  if (isCorrect) {
    // 30% chance to repeat with swapped order (doesn't count for streak)
    // Only for two-note questions
    shouldRepeatSwapped =
      !isSingleNote && Math.random() < REPEAT_CORRECT_CHANCE;
  } else {
    // Always retry on wrong answer
    shouldRetry = Math.random() < RETRY_CHANCE;
  }

  // Record to persistent state (map to noteA/noteB for QuestionRecord)
  persistentState = recordQuestion(persistentState, {
    timestamp: Date.now(),
    questionType: question.questionType,
    noteA: question.note1,
    noteB: question.note2,
    targetNote: question.targetNote,
    otherNote: question.otherNote,
    correct: isCorrect,
    wasFirstInStreak: question.isFirstInStreak,
    timeMs: Date.now() - question.startTime,
  });

  // Only update streak if this question counts and won't be repeated (two-note only)
  if (question.countsForStreak && !shouldRepeatSwapped && !isSingleNote) {
    persistentState = updateStreak(persistentState, isCorrect);
  }
  saveState(persistentState);

  renderChoiceButtons();
  renderFeedback();
  updateStats();
}

function renderFeedback(): void {
  const feedback = document.getElementById("feedback")!;
  const isSingleNote = question.questionType === "single-note";

  if (question.wasCorrect) {
    feedback.className = "feedback success";
    feedback.textContent = "Correct! Press Space to continue.";
    // Auto-advance after delay
    autoAdvanceTimeout = setTimeout(advanceToNext, AUTO_ADVANCE_DELAY);
  } else {
    feedback.className = "feedback error";

    if (isSingleNote) {
      feedback.innerHTML = `
        Incorrect. That was ${question.targetNote}, not ${question.otherNote}.
        <br><button id="replay-btn" class="play-again-btn" style="margin-top: 0.5rem;">Replay Note</button>
        <br><small>Press Space to continue.</small>
      `;
    } else {
      const targetPosition =
        question.family1 === question.targetNote ? "first" : "second";
      feedback.innerHTML = `
        Incorrect. The ${question.targetNote} was ${targetPosition} (the other note was ${question.otherNote}).
        <br><button id="replay-btn" class="play-again-btn" style="margin-top: 0.5rem;">Replay Both Notes</button>
        <br><small>Press Space to continue.</small>
      `;
    }

    const replayBtn = document.getElementById("replay-btn");
    if (replayBtn) {
      replayBtn.addEventListener("click", playQuestionNotes);
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
      isFirstInStreak: false, // Retry never counts for familiarity
      countsForStreak: false,
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
      isFirstInStreak: false, // Retry never counts for familiarity
      countsForStreak: false, // Retries/repeats don't count for streak
      startTime: Date.now(),
      displayOrder: [question.targetNote, question.otherNote], // Not used for two-note
    };
  }

  render();
  playQuestionNotes();
}

function nextQuestion(): void {
  clearAutoAdvance();
  const { isNewTarget, introducedNote, octaveIntro } = initQuestion();

  // If a note is ready for octave introduction, start octave intro mode
  if (octaveIntro) {
    startOctaveIntroduction(octaveIntro.note, octaveIntro.octave);
    return;
  }

  // If a new note was introduced, start introduction mode
  if (introducedNote) {
    startIntroduction(introducedNote);
    return;
  }

  render();
  if (isNewTarget) {
    flashScreen();
  }
  playQuestionNotes();
}

function renderIntroPage(showBackLink: boolean): void {
  const app = document.getElementById("app")!;

  const backLink = showBackLink
    ? `<a href="#/quiz" class="back-link">&larr; Back to Quiz</a>`
    : "";

  const buttonText = showBackLink ? "Return to Quiz" : "Start Training";

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
      </div>

      <div class="intro-section">
        <h2>Tips</h2>
        <ul class="intro-tips">
          <li>Use headphones for best results</li>
          <li>The exercise adapts to your skill level automatically</li>
          <li>Your progress is saved in your browser</li>
          <li>Keyboard shortcuts: <kbd>1</kbd>/<kbd>←</kbd> first option, <kbd>2</kbd>/<kbd>→</kbd> second option, <kbd>R</kbd> replay</li>
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
  const { introducedNote, octaveIntro } = initQuestion();

  // If a note is ready for octave introduction, start octave intro mode
  if (octaveIntro) {
    startOctaveIntroduction(octaveIntro.note, octaveIntro.octave);
    return;
  }

  // If a new note was introduced on first load (shouldn't happen normally),
  // start introduction mode
  if (introducedNote) {
    startIntroduction(introducedNote);
    return;
  }

  render();
  playQuestionNotes();
}
