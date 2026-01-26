/**
 * Note Identification Quiz Exercise
 *
 * Progressive spaced repetition training for note identification through three question types:
 * - octaveId: "What octave is this note in?" (single note, answer 3/4/5)
 * - noteSequence: "What note is this?" (plays note in 3→4→5, answer note family)
 * - fullNote: "What note is this?" (single note, answer full note like A4)
 */

import { playFrequency } from "../audio.js";
import { Grade } from "../lib/fsrs.js";
import {
  loadState,
  saveState,
  selectSessionCards,
  recordReview,
  incrementSessionCount,
  getStats,
  clearAllProgress,
  checkRetirements,
  getFrequencyForNote,
  getNearbyNotes,
  getNearbyFamilies,
  getOctave,
  getNoteFamily,
  getIntroducedFamilies,
  NoteIdMemoryState,
  SessionCards,
  NoteIdCard,
  OCTAVES,
} from "../lib/note-id-memory.js";

const NOTE_DURATION = 0.8;
const SEQUENCE_GAP_MS = 300;

interface CurrentQuestion {
  card: NoteIdCard;
  isNew: boolean;
}

interface ExerciseState {
  memoryState: NoteIdMemoryState;
  sessionCards: SessionCards;
  allQuestions: CurrentQuestion[];
  correctCounts: Map<string, number>;
  currentQuestion: CurrentQuestion;
  currentChoices: (string | number)[];
  eliminatedChoices: Set<string | number>;
  guessHistory: (string | number)[];
  hasAnswered: boolean;
  wasCorrect: boolean | null;
  userAnswer: string | number | null;
  lastFeedback: "too-high" | "too-low" | "incorrect" | null;
  sessionCorrect: number;
  sessionTotal: number;
  inputEnabled: boolean;
  startTime: number;
  elapsedBeforePause: number;
  pausedAt: number | null;
  replayTimesMs: number[];
  playingSequence: boolean;
  playingOctaveTeaching: boolean;
  playingNoteTeaching: boolean;
  highlightedChoice: string | number | null;
  sequenceComplete: boolean;
}

const REQUIRED_CORRECT = 2;

let state: ExerciseState;
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
let visibilityHandler: (() => void) | null = null;

function getElapsedTime(): number {
  if (state.pausedAt !== null) {
    return state.elapsedBeforePause;
  }
  return state.elapsedBeforePause + (performance.now() - state.startTime);
}

function setupVisibilityHandler(): void {
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
  }

  visibilityHandler = () => {
    if (document.hidden) {
      if (state.pausedAt === null) {
        state.elapsedBeforePause += performance.now() - state.startTime;
        state.pausedAt = performance.now();
      }
    } else {
      if (state.pausedAt !== null) {
        state.startTime = performance.now();
        state.pausedAt = null;
      }
    }
  };

  document.addEventListener("visibilitychange", visibilityHandler);
}

function buildSessionQuestions(sessionCards: SessionCards): CurrentQuestion[] {
  const questions: CurrentQuestion[] = [];

  // Add new cards
  for (const card of sessionCards.newCards) {
    questions.push({ card, isNew: true });
  }

  // Add review cards
  for (const card of sessionCards.reviewCards) {
    questions.push({ card, isNew: false });
  }

  return questions;
}

function pickNextQuestion(
  allQuestions: CurrentQuestion[],
  correctCounts: Map<string, number>,
  excludeId?: string
): CurrentQuestion {
  const needsWork = allQuestions.filter((q) => {
    const key = q.card.id;
    return (
      (correctCounts.get(key) ?? 0) < REQUIRED_CORRECT && key !== excludeId
    );
  });

  if (needsWork.length === 0) {
    return allQuestions[0];
  }

  needsWork.sort((a, b) => {
    const countA = correctCounts.get(a.card.id) ?? 0;
    const countB = correctCounts.get(b.card.id) ?? 0;
    if (countA !== countB) return countA - countB;
    return Math.random() - 0.5;
  });

  return needsWork[0];
}

function getChoices(
  card: NoteIdCard,
  memoryState: NoteIdMemoryState
): (string | number)[] {
  if (card.questionType === "octaveId") {
    // Always offer 3, 4, 5 as choices
    return OCTAVES;
  }

  if (card.questionType === "noteSequence") {
    // Only allow introduced families as choices
    const introducedFamilies = getIntroducedFamilies(memoryState);
    return getNearbyFamilies(card.noteFamily!, 4, introducedFamilies);
  }

  if (card.questionType === "fullNote") {
    // Only allow notes whose families have been introduced
    const introducedFamilies = getIntroducedFamilies(memoryState);
    const octave = getOctave(card.note!);
    const allowedNotes = introducedFamilies.map((f) => `${f}${octave}`);
    return getNearbyNotes(card.note!, 4, allowedNotes);
  }

  return [];
}

function getCorrectAnswer(card: NoteIdCard): string | number {
  if (card.questionType === "octaveId") {
    return getOctave(card.note!);
  }
  if (card.questionType === "noteSequence") {
    return card.noteFamily!;
  }
  if (card.questionType === "fullNote") {
    return card.note!;
  }
  return "";
}

function initExercise(): void {
  let memoryState = loadState();
  memoryState = checkRetirements(memoryState);
  const sessionCards = selectSessionCards(memoryState);
  const allQuestions = buildSessionQuestions(sessionCards);

  const correctCounts = new Map<string, number>();
  for (const question of allQuestions) {
    correctCounts.set(question.card.id, 0);
  }

  const firstQuestion = pickNextQuestion(allQuestions, correctCounts);
  state = {
    memoryState,
    sessionCards,
    allQuestions,
    correctCounts,
    currentQuestion: firstQuestion,
    currentChoices: getChoices(firstQuestion.card, memoryState),
    eliminatedChoices: new Set(),
    guessHistory: [],
    hasAnswered: false,
    wasCorrect: null,
    userAnswer: null,
    lastFeedback: null,
    sessionCorrect: 0,
    sessionTotal: 0,
    inputEnabled: false,
    startTime: performance.now(),
    elapsedBeforePause: 0,
    pausedAt: document.hidden ? performance.now() : null,
    replayTimesMs: [],
    playingSequence: false,
    playingOctaveTeaching: false,
    playingNoteTeaching: false,
    highlightedChoice: null,
    sequenceComplete: false,
  };

  setupVisibilityHandler();
}

function isCorrectAnswer(answer: string | number): boolean {
  return answer === getCorrectAnswer(state.currentQuestion.card);
}

function handleAnswer(answer: string | number): void {
  if (state.hasAnswered || !state.inputEnabled) return;
  if (state.eliminatedChoices.has(answer)) return;

  state.userAnswer = answer;
  const correctAnswer = getCorrectAnswer(state.currentQuestion.card);

  if (isCorrectAnswer(answer)) {
    state.hasAnswered = true;
    state.wasCorrect = true;
    state.lastFeedback = null;
    state.sessionTotal++;

    if (state.guessHistory.length === 0) {
      state.sessionCorrect++;
    }

    if (
      state.guessHistory.length > 0 &&
      state.currentQuestion.card.questionType !== "noteSequence"
    ) {
      // For octaveId and fullNote, play learning sequence after mistakes
      // For noteSequence, just let them explore by clicking
      render();
      setTimeout(() => {
        playLearningSequence();
      }, 500);
    } else {
      render();
    }
  } else {
    state.guessHistory.push(answer);
    state.wasCorrect = false;

    const questionType = state.currentQuestion.card.questionType;

    if (questionType === "octaveId") {
      // For octaveId, eliminate wrong choice and play teaching sequence
      state.lastFeedback = null; // No text feedback, just listen
      state.eliminatedChoices.add(answer);

      render();

      // Play teaching sequence: wrong octave then correct octave
      playOctaveTeachingSequence(answer as number, correctAnswer as number);
    } else if (questionType === "noteSequence") {
      // For noteSequence, eliminate wrong choice and play teaching sequence
      state.lastFeedback = "incorrect";
      state.eliminatedChoices.add(answer);

      render();

      // Play teaching sequence: wrong family then correct family
      playNoteSequenceTeachingSequence(
        answer as string,
        correctAnswer as string
      );
    } else {
      // For fullNote, use directional feedback
      const noteOrder = [
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
      const getIndex = (n: string) => noteOrder.indexOf(n.replace(/\d+$/, ""));
      const isTooHigh =
        getIndex(answer as string) > getIndex(correctAnswer as string);
      state.lastFeedback = isTooHigh ? "too-high" : "too-low";

      // Eliminate choices directionally
      for (const choice of state.currentChoices) {
        const choiceIdx = getIndex(choice as string);
        const answerIdx = getIndex(answer as string);
        if (isTooHigh && choiceIdx >= answerIdx) {
          state.eliminatedChoices.add(choice);
        } else if (!isTooHigh && choiceIdx <= answerIdx) {
          state.eliminatedChoices.add(choice);
        }
      }

      render();
    }
  }
}

function handleGrade(grade: Grade): void {
  const timeMs = Math.round(getElapsedTime());

  state.memoryState = recordReview(
    state.memoryState,
    state.currentQuestion.card.id,
    grade,
    {
      guessHistory: state.guessHistory,
      timeMs,
      replayTimesMs: state.replayTimesMs,
    }
  );

  // Check for retirements after review
  state.memoryState = checkRetirements(state.memoryState);
  saveState(state.memoryState);

  if (state.wasCorrect && state.guessHistory.length === 0) {
    const key = state.currentQuestion.card.id;
    const current = state.correctCounts.get(key) ?? 0;
    state.correctCounts.set(key, current + 1);
  }

  const allComplete = state.allQuestions.every((q) => {
    const key = q.card.id;
    return (state.correctCounts.get(key) ?? 0) >= REQUIRED_CORRECT;
  });

  if (allComplete) {
    state.memoryState = incrementSessionCount(state.memoryState);
    saveState(state.memoryState);
    renderSessionComplete();
  } else {
    advanceToNext();
  }
}

function advanceToNext(): void {
  const currentId = state.currentQuestion.card.id;
  const nextQuestion = pickNextQuestion(
    state.allQuestions,
    state.correctCounts,
    currentId
  );

  state.currentQuestion = nextQuestion;
  state.currentChoices = getChoices(nextQuestion.card, state.memoryState);
  state.eliminatedChoices = new Set();
  state.guessHistory = [];
  state.hasAnswered = false;
  state.wasCorrect = null;
  state.userAnswer = null;
  state.lastFeedback = null;
  state.inputEnabled = false;
  state.startTime = performance.now();
  state.elapsedBeforePause = 0;
  state.pausedAt = document.hidden ? performance.now() : null;
  state.replayTimesMs = [];
  state.playingSequence = false;
  state.playingOctaveTeaching = false;
  state.playingNoteTeaching = false;
  state.highlightedChoice = null;
  state.sequenceComplete = false;

  render();
  playCurrentSound();
}

async function playCurrentSound(): Promise<void> {
  const card = state.currentQuestion.card;

  if (card.questionType === "noteSequence") {
    // Play note in all three octaves: 3 → 4 → 5
    const family = card.noteFamily!;
    for (const octave of OCTAVES) {
      const note = `${family}${octave}`;
      const freq = getFrequencyForNote(note);
      await playFrequency(freq, { duration: NOTE_DURATION });
      if (octave < 5) {
        await new Promise((r) => setTimeout(r, SEQUENCE_GAP_MS));
      }
    }
  } else {
    // octaveId or fullNote: play single note
    const freq = getFrequencyForNote(card.note!);
    await playFrequency(freq, { duration: NOTE_DURATION });
  }

  state.inputEnabled = true;
}

async function handleReplay(): Promise<void> {
  state.replayTimesMs.push(Math.round(getElapsedTime()));
  await playCurrentSound();
}

/**
 * Play teaching sequence for wrong octave answer:
 * 1. Play the note in the wrong octave they chose
 * 2. Then play the note in the correct octave
 */
async function playOctaveTeachingSequence(
  wrongOctave: number,
  correctOctave: number
): Promise<void> {
  state.playingOctaveTeaching = true;
  state.inputEnabled = false;
  render();

  const card = state.currentQuestion.card;
  const family = getNoteFamily(card.note!);

  // Play the wrong octave (what they chose)
  state.highlightedChoice = wrongOctave;
  render();
  const wrongNote = `${family}${wrongOctave}`;
  const wrongFreq = getFrequencyForNote(wrongNote);
  await playFrequency(wrongFreq, { duration: NOTE_DURATION });
  await new Promise((r) => setTimeout(r, SEQUENCE_GAP_MS));

  // Play the correct octave (without highlighting - don't reveal the answer)
  state.highlightedChoice = null;
  render();
  const correctNote = `${family}${correctOctave}`;
  const correctFreq = getFrequencyForNote(correctNote);
  await playFrequency(correctFreq, { duration: NOTE_DURATION });

  state.playingOctaveTeaching = false;
  state.inputEnabled = true;
  render();
}

/**
 * Play a single octave's note (for clicking octave buttons after answering).
 */
async function playOctaveNote(octave: number): Promise<void> {
  const card = state.currentQuestion.card;
  const family = getNoteFamily(card.note!);
  const note = `${family}${octave}`;
  const freq = getFrequencyForNote(note);

  state.highlightedChoice = octave;
  render();
  await playFrequency(freq, { duration: NOTE_DURATION });
  state.highlightedChoice = null;
  render();
}

/**
 * Play a note family's sequence (for clicking note buttons after answering).
 */
async function playNoteFamilySequence(family: string): Promise<void> {
  state.highlightedChoice = family;
  render();

  for (const octave of OCTAVES) {
    const note = `${family}${octave}`;
    const freq = getFrequencyForNote(note);
    await playFrequency(freq, { duration: NOTE_DURATION });
    if (octave < 5) {
      await new Promise((r) => setTimeout(r, SEQUENCE_GAP_MS));
    }
  }

  state.highlightedChoice = null;
  render();
}

/**
 * Play teaching sequence for wrong noteSequence answer:
 * 1. Play the wrong family in 3→4→5
 * 2. Then play the correct family in 3→4→5
 */
async function playNoteSequenceTeachingSequence(
  wrongFamily: string,
  correctFamily: string
): Promise<void> {
  state.playingNoteTeaching = true;
  state.inputEnabled = false;
  render();

  // Play the wrong family sequence (what they chose)
  state.highlightedChoice = wrongFamily;
  render();
  for (const octave of OCTAVES) {
    const note = `${wrongFamily}${octave}`;
    const freq = getFrequencyForNote(note);
    await playFrequency(freq, { duration: NOTE_DURATION });
    if (octave < 5) {
      await new Promise((r) => setTimeout(r, SEQUENCE_GAP_MS));
    }
  }

  await new Promise((r) => setTimeout(r, SEQUENCE_GAP_MS * 2));

  // Play the correct family sequence (without highlighting - don't reveal the answer)
  state.highlightedChoice = null;
  render();
  for (const octave of OCTAVES) {
    const note = `${correctFamily}${octave}`;
    const freq = getFrequencyForNote(note);
    await playFrequency(freq, { duration: NOTE_DURATION });
    if (octave < 5) {
      await new Promise((r) => setTimeout(r, SEQUENCE_GAP_MS));
    }
  }

  state.highlightedChoice = null;
  state.playingNoteTeaching = false;
  state.inputEnabled = true;
  render();
}

async function playLearningSequence(): Promise<void> {
  state.playingSequence = true;
  state.sequenceComplete = false;
  render();

  const card = state.currentQuestion.card;
  const correctAnswer = getCorrectAnswer(card);

  if (card.questionType === "octaveId") {
    // Play the note in each octave, highlighting the choice
    for (const octave of state.currentChoices as number[]) {
      state.highlightedChoice = octave;
      render();
      const family = getNoteFamily(card.note!);
      const note = `${family}${octave}`;
      const freq = getFrequencyForNote(note);
      await playFrequency(freq, { duration: NOTE_DURATION });
      await new Promise((r) => setTimeout(r, SEQUENCE_GAP_MS));
    }
    // Play correct answer one more time
    state.highlightedChoice = correctAnswer;
    render();
    const freq = getFrequencyForNote(card.note!);
    await playFrequency(freq, { duration: NOTE_DURATION });
  } else if (card.questionType === "noteSequence") {
    // Play each family in all three octaves
    for (const family of state.currentChoices as string[]) {
      state.highlightedChoice = family;
      render();
      // Play the middle octave (4) for the family
      const note = `${family}4`;
      const freq = getFrequencyForNote(note);
      await playFrequency(freq, { duration: NOTE_DURATION });
      await new Promise((r) => setTimeout(r, SEQUENCE_GAP_MS));
    }
    // Play correct answer sequence
    state.highlightedChoice = correctAnswer;
    render();
    for (const octave of OCTAVES) {
      const note = `${card.noteFamily}${octave}`;
      const freq = getFrequencyForNote(note);
      await playFrequency(freq, { duration: NOTE_DURATION });
      if (octave < 5) {
        await new Promise((r) => setTimeout(r, SEQUENCE_GAP_MS));
      }
    }
  } else {
    // fullNote: play each choice
    for (const choice of state.currentChoices as string[]) {
      state.highlightedChoice = choice;
      render();
      const freq = getFrequencyForNote(choice);
      await playFrequency(freq, { duration: NOTE_DURATION });
      await new Promise((r) => setTimeout(r, SEQUENCE_GAP_MS));
    }
    // Play correct answer
    state.highlightedChoice = correctAnswer;
    render();
    const freq = getFrequencyForNote(card.note!);
    await playFrequency(freq, { duration: NOTE_DURATION });
  }

  state.playingSequence = false;
  state.highlightedChoice = null;
  state.sequenceComplete = true;
  render();
}

function formatChoice(choice: string | number, questionType: string): string {
  if (questionType === "octaveId") {
    return `Octave ${choice}`;
  }
  return String(choice);
}

function getQuestionText(card: NoteIdCard): string {
  if (card.questionType === "octaveId") {
    return "What octave is this note in?";
  }
  if (card.questionType === "noteSequence") {
    return "What note is this?";
  }
  if (card.questionType === "fullNote") {
    return "What note is this?";
  }
  return "";
}

function getQuestionTypeLabel(card: NoteIdCard): string {
  if (card.questionType === "octaveId") {
    return "Octave ID";
  }
  if (card.questionType === "noteSequence") {
    return "Note Sequence";
  }
  if (card.questionType === "fullNote") {
    return "Full Note";
  }
  return "";
}

function render(): void {
  const app = document.getElementById("app")!;
  const stats = getStats(state.memoryState);
  const card = state.currentQuestion.card;
  const choices = state.currentChoices;
  const correctAnswer = getCorrectAnswer(card);

  const questionText = getQuestionText(card);
  const typeLabel = getQuestionTypeLabel(card);

  const isOctaveId = card.questionType === "octaveId";
  const isNoteSequence = card.questionType === "noteSequence";
  const allowsExploration = isOctaveId || isNoteSequence;

  const choiceButtons = choices
    .map((choice, idx) => {
      let className = "choice-btn nf-choice";
      const isEliminated = state.eliminatedChoices.has(choice);
      const isCorrect = state.hasAnswered && choice === correctAnswer;

      // For octaveId and noteSequence, keep buttons clickable for exploration
      // (even eliminated choices can be clicked to hear them again)
      // But disable during sequence playback or teaching playback
      let isDisabled: boolean;
      if (allowsExploration) {
        // For exploration types, only disable during playback (not for eliminated choices)
        isDisabled =
          state.playingSequence ||
          state.playingOctaveTeaching ||
          state.playingNoteTeaching ||
          state.sequenceComplete;
      } else {
        isDisabled =
          isEliminated ||
          state.playingSequence ||
          state.playingOctaveTeaching ||
          state.playingNoteTeaching ||
          state.sequenceComplete;
      }

      if (state.highlightedChoice === choice) {
        className += " highlighted";
      } else if (isCorrect) {
        className += " correct";
      } else if (isEliminated) {
        className += " eliminated";
      }

      // Add data attributes for exploration behavior
      const isExploration = allowsExploration && state.hasAnswered;
      const canExploreEliminated = allowsExploration && isEliminated;
      return `<button class="${className}" data-choice="${choice}" data-idx="${idx}" data-exploration="${isExploration}" data-explore-eliminated="${canExploreEliminated}" ${isDisabled ? "disabled" : ""}>${formatChoice(choice, card.questionType)}</button>`;
    })
    .join("");

  // Feedback
  let feedbackHtml = "";
  if (state.playingSequence) {
    feedbackHtml = `<div class="feedback">Playing sequence...</div>`;
  } else if (state.playingOctaveTeaching) {
    feedbackHtml = `<div class="feedback">Listen to the difference...</div>`;
  } else if (state.playingNoteTeaching) {
    feedbackHtml = `<div class="feedback">Listen to the difference...</div>`;
  } else if (state.sequenceComplete) {
    feedbackHtml = `<div class="feedback success">The answer was ${formatChoice(correctAnswer, card.questionType)}</div>`;
  } else if (state.hasAnswered) {
    if (isOctaveId) {
      feedbackHtml = `<div class="feedback success">Correct! Click octaves to compare.</div>`;
    } else if (isNoteSequence) {
      feedbackHtml = `<div class="feedback success">Correct! Click notes to compare.</div>`;
    } else {
      feedbackHtml = `<div class="feedback success">Correct!</div>`;
    }
  } else if (state.lastFeedback) {
    let feedbackText: string;
    if (state.lastFeedback === "incorrect") {
      feedbackText = "Incorrect";
    } else {
      feedbackText =
        state.lastFeedback === "too-high" ? "Too high!" : "Too low!";
    }
    feedbackHtml = `<div class="feedback error">${feedbackText}</div>`;
  }

  let afterAnswer = "";
  if (state.sequenceComplete) {
    afterAnswer = `
      <div class="sequence-controls">
        <button class="choice-btn" id="replay-sequence-btn">Replay Sequence</button>
        <button class="choice-btn" id="continue-btn">Continue</button>
      </div>
    `;
  } else if (state.hasAnswered && state.guessHistory.length === 0) {
    afterAnswer = renderGradeButtons();
  } else if (
    state.hasAnswered &&
    state.guessHistory.length > 0 &&
    isNoteSequence
  ) {
    // For noteSequence with previous mistakes, show continue button (no learning sequence)
    afterAnswer = `
      <div class="sequence-controls">
        <button class="choice-btn" id="continue-btn">Continue</button>
      </div>
    `;
  }

  // Progress summary
  const totalIntroduced =
    stats.introducedOctaveId +
    stats.introducedNoteSequence +
    stats.introducedFullNote;
  const totalPossible = stats.totalCards;

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Note Identification Quiz</h1>

    <div class="exercise-container">
      <div class="nf-question-block">
        <div class="question-type-label">${typeLabel}</div>
        <div class="nf-question">${questionText}</div>
        <button class="play-again-btn" id="play-btn">Play Again (R)</button>
      </div>

      ${feedbackHtml}

      <div class="nf-choices" id="choice-buttons">
        ${choiceButtons}
      </div>

      ${afterAnswer}

      <div class="stats-row">
        <div class="stats correct-stat">
          <span class="stats-label">Session:</span>
          <span>${state.sessionCorrect}/${state.sessionTotal}</span>
        </div>
        <div class="stats">
          <span class="stats-label">Progress:</span>
          <span>${totalIntroduced}/${totalPossible} cards</span>
        </div>
        <div class="stats">
          <span class="stats-label">Sessions:</span>
          <span>${stats.sessionsCompleted}</span>
        </div>
      </div>

      <p class="keyboard-hint">Keys 1-${choices.length} to select</p>
    </div>

    <div class="danger-zone">
      <button class="danger-btn" id="clear-history-btn">Clear Progress</button>
      <p class="danger-warning">Reset all learning history</p>
    </div>
  `;

  setupEventListeners();
}

function renderGradeButtons(): string {
  return `
    <div class="grade-buttons">
      <p class="grade-prompt">How well did you know it?</p>
      <div class="grade-btn-row">
        <button class="grade-btn again" data-grade="1">Again</button>
        <button class="grade-btn hard" data-grade="2">Hard</button>
        <button class="grade-btn good" data-grade="3">Good</button>
        <button class="grade-btn easy" data-grade="4">Easy</button>
      </div>
    </div>
  `;
}

function renderSessionComplete(): void {
  const app = document.getElementById("app")!;
  const stats = getStats(state.memoryState);

  const accuracy =
    state.sessionTotal > 0
      ? Math.round((state.sessionCorrect / state.sessionTotal) * 100)
      : 0;

  const totalIntroduced =
    stats.introducedOctaveId +
    stats.introducedNoteSequence +
    stats.introducedFullNote;

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Session Complete!</h1>

    <div class="exercise-container">
      <div class="session-summary">
        <h2>Results</h2>
        <p>Accuracy: ${state.sessionCorrect}/${state.sessionTotal} (${accuracy}%)</p>
        <p>Cards introduced: ${totalIntroduced}/${stats.totalCards}</p>
        <p>Retired cards: ${stats.retiredCards}</p>
        <p>Total sessions: ${stats.sessionsCompleted}</p>
        <p>Total reviews: ${stats.totalReviews}</p>
      </div>

      <div class="session-actions">
        <button class="play-again-btn" id="new-session-btn">Start New Session</button>
        <a href="#/" class="back-link">Return to Exercises</a>
      </div>
    </div>
  `;

  const newSessionBtn = document.getElementById("new-session-btn");
  newSessionBtn?.addEventListener("click", () => {
    initExercise();
    render();
    playCurrentSound();
  });

  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
    keyboardHandler = null;
  }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

function setupEventListeners(): void {
  const choices = state.currentChoices;
  const playBtn = document.getElementById("play-btn");
  playBtn?.addEventListener("click", () => {
    handleReplay();
  });

  const choiceButtons = document.querySelectorAll(".nf-choice");
  choiceButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const choiceStr = (btn as HTMLElement).dataset.choice || "";
      const isExploration = (btn as HTMLElement).dataset.exploration === "true";
      const canExploreEliminated =
        (btn as HTMLElement).dataset.exploreEliminated === "true";
      const questionType = state.currentQuestion.card.questionType;

      if (questionType === "octaveId") {
        const octave = parseInt(choiceStr, 10);
        if (canExploreEliminated && !state.playingOctaveTeaching) {
          // Clicking eliminated choice plays that octave's note
          playOctaveNote(octave);
        } else if (!state.hasAnswered) {
          handleAnswer(octave);
        } else if (isExploration && !state.playingOctaveTeaching) {
          // After answering, clicking plays that octave's note
          playOctaveNote(octave);
        }
      } else if (questionType === "noteSequence") {
        if (canExploreEliminated && !state.playingNoteTeaching) {
          // Clicking eliminated choice plays that family's sequence
          playNoteFamilySequence(choiceStr);
        } else if (!state.hasAnswered) {
          handleAnswer(choiceStr);
        } else if (isExploration && !state.playingNoteTeaching) {
          // After answering, clicking plays that note family's sequence
          playNoteFamilySequence(choiceStr);
        }
      } else if (!state.hasAnswered) {
        handleAnswer(choiceStr);
      }
    });
  });

  const gradeButtons = document.querySelectorAll(".grade-btn");
  gradeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const grade = parseInt(
        (btn as HTMLElement).dataset.grade || "3",
        10
      ) as Grade;
      handleGrade(grade);
    });
  });

  const replaySeqBtn = document.getElementById("replay-sequence-btn");
  replaySeqBtn?.addEventListener("click", () => {
    playLearningSequence();
  });

  const continueBtn = document.getElementById("continue-btn");
  continueBtn?.addEventListener("click", () => {
    handleGrade(Grade.AGAIN);
  });

  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
  }

  keyboardHandler = (e: KeyboardEvent) => {
    if (e.repeat) return;

    if (state.playingSequence) return;

    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      if (state.sequenceComplete) {
        playLearningSequence();
      } else {
        handleReplay();
      }
      return;
    }

    if (
      state.sequenceComplete &&
      (e.key === "Enter" || e.key === "c" || e.key === "C")
    ) {
      e.preventDefault();
      handleGrade(Grade.AGAIN);
      return;
    }

    const num = parseInt(e.key, 10);

    if (!state.hasAnswered) {
      if (num >= 1 && num <= choices.length) {
        e.preventDefault();
        handleAnswer(choices[num - 1]);
      }
    } else if (!state.sequenceComplete && state.guessHistory.length === 0) {
      if (num >= 1 && num <= 4) {
        e.preventDefault();
        handleGrade(num as Grade);
      }
    }
  };

  document.addEventListener("keydown", keyboardHandler);

  const cleanupOnNavigate = () => {
    if (keyboardHandler) {
      document.removeEventListener("keydown", keyboardHandler);
      keyboardHandler = null;
    }
    if (visibilityHandler) {
      document.removeEventListener("visibilitychange", visibilityHandler);
      visibilityHandler = null;
    }
    window.removeEventListener("hashchange", cleanupOnNavigate);
  };
  window.addEventListener("hashchange", cleanupOnNavigate);

  const clearHistoryBtn = document.getElementById("clear-history-btn");
  clearHistoryBtn?.addEventListener("click", () => {
    if (
      confirm(
        "Are you sure you want to clear ALL progress? This cannot be undone."
      )
    ) {
      clearAllProgress();
      initExercise();
      render();
      playCurrentSound();
    }
  });
}

export async function renderNoteIdQuiz(): Promise<void> {
  initExercise();
  render();
  await playCurrentSound();
  state.inputEnabled = true;
}
