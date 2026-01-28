/**
 * State management for the tone quiz exercise.
 * Tracks play history and learning progress for continuous play sessions.
 */

import { Card, Grade, createDeck } from "./fsrs.js";

const STORAGE_KEY = "tone-quiz-state-v2";
const deck = createDeck();

export { Grade };

/** Full tones (no sharps/flats) in chromatic order */
export const FULL_TONES = ["C", "D", "E", "F", "G", "A", "B"] as const;
export type FullTone = (typeof FULL_TONES)[number];

/** Semitone values for each note (C=0, D=2, etc.) */
export const NOTE_SEMITONES: Record<FullTone, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** Available octaves for all notes (no progression - all available from start) */
export const AVAILABLE_OCTAVES = [3, 4, 5] as const;

/** Order to introduce notes: C and G first (well separated), then fill in */
export const LEARNING_ORDER: FullTone[] = ["C", "G", "E", "A", "D", "F", "B"];

/** Number of consecutive correct answers needed to move to next target */
export const STREAK_LENGTH = 3;

/** Number of recent attempts to consider for mastery */
export const MASTERY_WINDOW = 10;
/** Minimum correct in window to be considered mastered */
export const MASTERY_THRESHOLD = 9;
/** Minimum questions between any unlocks */
export const UNLOCK_COOLDOWN = 20;

export type QuestionType = "two-note" | "single-note";

/** Pending unlock types */
export interface PendingUnlock {
  type: "single-note-pair" | "note";
  value: string; // Normalized pair "C-G" or note "E"
}

export interface QuestionRecord {
  timestamp: number;
  questionType?: QuestionType; // Optional for backwards compat, defaults to "two-note"
  noteA: string; // Note played first (with octave, e.g., "C4"), or only note for single-note
  noteB: string; // Note played second (with octave, e.g., "D4"), empty for single-note
  targetNote: string; // Which note we asked about (without octave, e.g., "C")
  otherNote: string; // The other note family (without octave)
  correct: boolean;
  wasFirstInStreak: boolean; // Only first-in-streak counts for familiarity
  timeMs?: number;
}

/** FSRS card state for a target-other pair */
export interface TonePairCard {
  card: Card | null; // null = never reviewed
  lastReviewedAt: number | null;
  reviewCount: number;
}

/** Session tracking for spaced repetition */
export interface SessionInfo {
  sessionStartTime: number; // When current session began
  previousSessionEnd: number | null; // When last session ended (for gap calculation)
}

export interface ToneQuizState {
  history: QuestionRecord[];
  lastPlayedAt: number | null;

  // Learning state
  learningVocabulary: FullTone[]; // Notes currently being learned
  performance: Record<string, Record<string, boolean[]>>; // target -> other -> results (two-note questions)

  // Single-note question performance: played -> alternative -> results
  // e.g., singleNotePerformance["C"]["G"] tracks "identify C when choice is C vs G"
  singleNotePerformance: Record<string, Record<string, boolean[]>>;

  // Sticky target state
  currentTarget: FullTone | null;
  currentTargetOctave: number | null;
  correctStreak: number; // Consecutive correct answers on current target
  isFirstOnTarget: boolean; // Whether next question is first on this target

  // Unlock-based progression system
  unlockedSingleNotePairs: string[]; // Normalized pairs that have unlocked single-note questions ["C-G", ...]
  pendingUnlocks: PendingUnlock[]; // Queue of unlocks waiting for cooldown
  questionsSinceLastUnlock: number; // Counter for unlock cooldown

  // FSRS spaced repetition state
  pairCards: Record<string, TonePairCard>; // "target-other" -> card state
  session: SessionInfo;
}

function createInitialState(): ToneQuizState {
  return {
    history: [],
    lastPlayedAt: null,
    learningVocabulary: ["C", "G"], // Start with C and G
    performance: {},
    singleNotePerformance: {},
    currentTarget: null,
    currentTargetOctave: null,
    correctStreak: 0,
    isFirstOnTarget: true,
    unlockedSingleNotePairs: [],
    pendingUnlocks: [],
    questionsSinceLastUnlock: 0,
    pairCards: {},
    session: {
      sessionStartTime: Date.now(),
      previousSessionEnd: null,
    },
  };
}

export function loadState(): ToneQuizState {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return createInitialState();
  }
  const parsed = JSON.parse(stored) as ToneQuizState;
  return parsed;
}

export function saveState(state: ToneQuizState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearState(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Get the two adjacent notes for a given note (wrapping at octave boundaries).
 * Returns [lower, upper] neighbors.
 */
export function getAdjacentNotes(note: FullTone): [FullTone, FullTone] {
  const idx = FULL_TONES.indexOf(note);
  const lower = FULL_TONES[(idx - 1 + FULL_TONES.length) % FULL_TONES.length];
  const upper = FULL_TONES[(idx + 1) % FULL_TONES.length];
  return [lower, upper];
}

/**
 * Get the adjacent notes to a note within a vocabulary.
 * Returns [lower, upper] neighbors in chromatic order from the vocabulary.
 * Returns null for a direction if no neighbor exists in that direction.
 */
export function getAdjacentNotesInVocabulary(
  note: FullTone,
  vocabulary: FullTone[]
): [FullTone | null, FullTone | null] {
  if (!vocabulary.includes(note) || vocabulary.length < 2) {
    return [null, null];
  }

  const noteIdx = FULL_TONES.indexOf(note);

  // Find nearest note above (in chromatic order) from vocabulary
  let upper: FullTone | null = null;
  for (let offset = 1; offset < FULL_TONES.length; offset++) {
    const candidate = FULL_TONES[(noteIdx + offset) % FULL_TONES.length];
    if (vocabulary.includes(candidate) && candidate !== note) {
      upper = candidate;
      break;
    }
  }

  // Find nearest note below from vocabulary
  let lower: FullTone | null = null;
  for (let offset = 1; offset < FULL_TONES.length; offset++) {
    const candidate =
      FULL_TONES[(noteIdx - offset + FULL_TONES.length) % FULL_TONES.length];
    if (vocabulary.includes(candidate) && candidate !== note) {
      lower = candidate;
      break;
    }
  }

  return [lower, upper];
}

/**
 * Get the chromatic distance between two notes (0-6, wrapping).
 */
export function getNoteDistance(a: FullTone, b: FullTone): number {
  const idxA = FULL_TONES.indexOf(a);
  const idxB = FULL_TONES.indexOf(b);
  const diff = Math.abs(idxA - idxB);
  return Math.min(diff, FULL_TONES.length - diff);
}

// ============================================================================
// Pair Utility Functions for New Unlock System
// ============================================================================

/**
 * Normalize a pair to alphabetical order for consistent storage.
 * Returns "C-G" regardless of whether called with (C, G) or (G, C).
 */
export function normalizePair(a: FullTone, b: FullTone): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Get C Major scale position for a note (C=0, D=1, E=2, F=3, G=4, A=5, B=6).
 */
export function getScalePosition(note: FullTone): number {
  return FULL_TONES.indexOf(note);
}

/**
 * Get notes between two notes in C Major scale (exclusive).
 * Returns notes in LEARNING_ORDER preference.
 * Example: getNotesBetween("C", "G") returns ["D", "E", "F"]
 */
export function getNotesBetween(a: FullTone, b: FullTone): FullTone[] {
  const posA = getScalePosition(a);
  const posB = getScalePosition(b);
  const minPos = Math.min(posA, posB);
  const maxPos = Math.max(posA, posB);

  // Get notes strictly between (exclusive of endpoints)
  const between: FullTone[] = [];
  for (let i = minPos + 1; i < maxPos; i++) {
    between.push(FULL_TONES[i]);
  }

  // Sort by LEARNING_ORDER preference
  return between.sort(
    (x, y) => LEARNING_ORDER.indexOf(x) - LEARNING_ORDER.indexOf(y)
  );
}

/**
 * Get the two closest notes to a candidate from the vocabulary.
 * Returns sorted by distance (closest first).
 */
export function getClosestVocabularyNotes(
  vocabulary: FullTone[],
  candidate: FullTone
): FullTone[] {
  const withDistances = vocabulary
    .filter((n) => n !== candidate)
    .map((n) => ({ note: n, distance: getNoteDistance(n, candidate) }))
    .sort((a, b) => a.distance - b.distance);

  // Return up to 2 closest notes
  return withDistances.slice(0, 2).map((x) => x.note);
}

// ============================================================================
// Performance Tracking Functions for Mastery
// ============================================================================

/**
 * Get combined two-tone performance for a pair (both directions, last MASTERY_WINDOW).
 * Combines results from A->B and B->A questions.
 */
export function getPairTwoToneResults(
  state: ToneQuizState,
  a: FullTone,
  b: FullTone
): boolean[] {
  const resultsAB = state.performance[a]?.[b] ?? [];
  const resultsBA = state.performance[b]?.[a] ?? [];

  // Combine and take last MASTERY_WINDOW results
  // We interleave by timestamp order if we had timestamps, but we don't
  // So just combine and take the most recent overall
  const combined = [...resultsAB, ...resultsBA];
  return combined.slice(-MASTERY_WINDOW);
}

/**
 * Get combined single-note performance for a pair (both directions, last MASTERY_WINDOW).
 * Combines results from "played A, choice A vs B" and "played B, choice B vs A".
 */
export function getPairSingleNoteResults(
  state: ToneQuizState,
  a: FullTone,
  b: FullTone
): boolean[] {
  const resultsAB = state.singleNotePerformance[a]?.[b] ?? [];
  const resultsBA = state.singleNotePerformance[b]?.[a] ?? [];

  const combined = [...resultsAB, ...resultsBA];
  return combined.slice(-MASTERY_WINDOW);
}

/**
 * Check if results meet mastery threshold (9/10).
 */
export function isMastered(results: boolean[]): boolean {
  if (results.length < MASTERY_WINDOW) return false;
  const correct = results.filter(Boolean).length;
  return correct >= MASTERY_THRESHOLD;
}

// ============================================================================
// Unlock Logic Functions
// ============================================================================

/**
 * Check if single-note questions are unlocked for this pair.
 */
export function isSingleNotePairUnlocked(
  state: ToneQuizState,
  a: FullTone,
  b: FullTone
): boolean {
  const normalized = normalizePair(a, b);
  return state.unlockedSingleNotePairs.includes(normalized);
}

/**
 * Get all unlocked single-note pairs as [FullTone, FullTone][].
 */
export function getUnlockedSingleNotePairs(
  state: ToneQuizState
): Array<[FullTone, FullTone]> {
  return state.unlockedSingleNotePairs.map((pair) => {
    const [a, b] = pair.split("-") as [FullTone, FullTone];
    return [a, b];
  });
}

/**
 * Find next note to unlock between a pair (or null if any already between or none exist).
 * Returns the first note in LEARNING_ORDER that:
 * 1. Is between the two notes in the C Major scale
 * 2. Is not already in the vocabulary
 */
export function getNextNoteToBetween(
  state: ToneQuizState,
  a: FullTone,
  b: FullTone
): FullTone | null {
  const between = getNotesBetween(a, b);

  // Check if any notes between are already in vocabulary
  const vocabSet = new Set(state.learningVocabulary);
  const betweenInVocab = between.filter((n) => vocabSet.has(n));
  if (betweenInVocab.length > 0) {
    return null; // Already have a note between, don't add another
  }

  // Find the first note between that's not in vocabulary (sorted by LEARNING_ORDER)
  for (const note of between) {
    if (!vocabSet.has(note)) {
      return note;
    }
  }

  return null; // No notes between or all already in vocabulary
}

/**
 * Queue an unlock (doesn't apply immediately).
 */
export function queueUnlock(
  state: ToneQuizState,
  unlock: PendingUnlock
): ToneQuizState {
  // Check if already queued
  const alreadyQueued = state.pendingUnlocks.some(
    (u) => u.type === unlock.type && u.value === unlock.value
  );
  if (alreadyQueued) return state;

  // Check if already unlocked/in vocab
  if (unlock.type === "single-note-pair") {
    if (state.unlockedSingleNotePairs.includes(unlock.value)) return state;
  } else {
    if (state.learningVocabulary.includes(unlock.value as FullTone)) return state;
  }

  return {
    ...state,
    pendingUnlocks: [...state.pendingUnlocks, unlock],
  };
}

/**
 * Process pending unlocks if cooldown allows.
 * Returns updated state with unlock applied (if any).
 */
export function processPendingUnlocks(state: ToneQuizState): ToneQuizState {
  if (state.pendingUnlocks.length === 0) return state;
  if (state.questionsSinceLastUnlock < UNLOCK_COOLDOWN) return state;

  // Pop first item from queue
  const [unlock, ...remaining] = state.pendingUnlocks;

  let newState: ToneQuizState = {
    ...state,
    pendingUnlocks: remaining,
    questionsSinceLastUnlock: 0,
  };

  if (unlock.type === "single-note-pair") {
    // Silent unlock - just add to unlocked pairs
    newState = {
      ...newState,
      unlockedSingleNotePairs: [...newState.unlockedSingleNotePairs, unlock.value],
    };
  } else {
    // Note unlock - add to vocabulary (triggers introduction screen in UI)
    newState = {
      ...newState,
      learningVocabulary: [...newState.learningVocabulary, unlock.value as FullTone],
    };
  }

  return newState;
}

/**
 * Check all pairs for newly earned unlocks and queue them.
 * Called after recording each question.
 */
export function checkAndQueueUnlocks(state: ToneQuizState): ToneQuizState {
  let newState = state;
  const vocab = state.learningVocabulary;

  // Check each pair in vocabulary
  for (let i = 0; i < vocab.length; i++) {
    for (let j = i + 1; j < vocab.length; j++) {
      const a = vocab[i];
      const b = vocab[j];
      const normalized = normalizePair(a, b);

      if (!isSingleNotePairUnlocked(newState, a, b)) {
        // Check if two-tone mastery achieved
        const twoToneResults = getPairTwoToneResults(newState, a, b);
        if (isMastered(twoToneResults)) {
          newState = queueUnlock(newState, {
            type: "single-note-pair",
            value: normalized,
          });
        }
      } else {
        // Single-note is unlocked, check for single-note mastery
        const singleNoteResults = getPairSingleNoteResults(newState, a, b);
        if (isMastered(singleNoteResults)) {
          const nextNote = getNextNoteToBetween(newState, a, b);
          if (nextNote) {
            newState = queueUnlock(newState, {
              type: "note",
              value: nextNote,
            });
          }
        }
      }
    }
  }

  // Process pending unlocks if cooldown allows
  newState = processPendingUnlocks(newState);

  return newState;
}

/**
 * Count how many questions have been asked for each target note.
 * Used to select the least practiced note.
 */
export function getTargetQuestionCounts(
  state: ToneQuizState
): Record<FullTone, number> {
  const counts: Partial<Record<FullTone, number>> = {};
  for (const target of state.learningVocabulary) {
    counts[target as FullTone] = 0;
    const targetPerf = state.performance[target];
    if (targetPerf) {
      for (const other of Object.keys(targetPerf)) {
        counts[target as FullTone]! += targetPerf[other].length;
      }
    }
  }
  return counts as Record<FullTone, number>;
}

/**
 * Select the least practiced note from vocabulary.
 * Breaks ties randomly.
 */
export function selectLeastPracticedNote(state: ToneQuizState): FullTone {
  const counts = getTargetQuestionCounts(state);
  const vocab = state.learningVocabulary;

  let minCount = Infinity;
  let candidates: FullTone[] = [];

  for (const note of vocab) {
    const count = counts[note] ?? 0;
    if (count < minCount) {
      minCount = count;
      candidates = [note];
    } else if (count === minCount) {
      candidates.push(note);
    }
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Get all adjacent pairs in vocabulary (notes that are neighbors in the learning set).
 */
export function getAdjacentVocabPairs(
  vocabulary: FullTone[]
): Array<[FullTone, FullTone]> {
  const pairs: Array<[FullTone, FullTone]> = [];
  const seen = new Set<string>();

  for (const note of vocabulary) {
    const [lower, upper] = getAdjacentNotesInVocabulary(note, vocabulary);

    if (lower) {
      const key = [note, lower].sort().join("-");
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push([note, lower]);
      }
    }
    if (upper && upper !== lower) {
      const key = [note, upper].sort().join("-");
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push([note, upper]);
      }
    }
  }

  return pairs;
}

/**
 * Get the next note to add to vocabulary, or null if all notes learned.
 */
export function getNextNoteToLearn(state: ToneQuizState): FullTone | null {
  for (const note of LEARNING_ORDER) {
    if (!state.learningVocabulary.includes(note)) {
      return note;
    }
  }
  return null;
}

// Session timeout for detecting new sessions (5 minutes)
const SESSION_TIMEOUT = 5 * 60 * 1000;

/**
 * Check if we should start a new session based on inactivity.
 * Returns updated state if a new session started, otherwise unchanged.
 */
export function maybeStartNewSession(
  state: ToneQuizState,
  now: number
): ToneQuizState {
  const lastActivity = state.lastPlayedAt ?? 0;
  const timeSinceActivity = now - lastActivity;

  if (timeSinceActivity > SESSION_TIMEOUT || !state.session?.sessionStartTime) {
    return {
      ...state,
      session: {
        sessionStartTime: now,
        previousSessionEnd: lastActivity || null,
      },
    };
  }

  return state;
}

/**
 * Calculate repeat probability based on session freshness.
 * High when returning after a break, decays during active practice.
 *
 * Starting probability based on gap:
 * - 24+ hours: 100%
 * - 0 hours: ~50%
 *
 * Decay during session:
 * - 0 min: starting probability
 * - 5 min: 50% of starting
 * - 15 min: 10%
 * - Never below 10%
 */
export function getRepeatProbability(state: ToneQuizState, now: number): number {
  const MIN_PROB = 0.1;

  // Calculate starting probability based on gap since last session
  const gapMs = state.session.sessionStartTime
    ? state.session.sessionStartTime - (state.session.previousSessionEnd ?? 0)
    : Infinity;
  const gapHours = gapMs / (1000 * 60 * 60);
  const startingProb = Math.min(1.0, 0.5 + gapHours / 48); // 50% at 0h, 100% at 24h+

  // Decay based on session time
  const sessionMinutes = (now - state.session.sessionStartTime) / (1000 * 60);

  if (sessionMinutes <= 5) {
    // Linear decay from starting to 50% of starting
    return startingProb * (1 - 0.5 * (sessionMinutes / 5));
  }
  if (sessionMinutes <= 15) {
    // Linear decay from 50% of starting to 10%
    const midPoint = startingProb * 0.5;
    return midPoint - (midPoint - MIN_PROB) * ((sessionMinutes - 5) / 10);
  }
  return MIN_PROB;
}

/**
 * Select the most urgent pair to review based on FSRS retrievability.
 * Only considers cards that are due (hours since review >= scheduled interval).
 * Returns the pair with lowest retrievability (most likely to be forgotten).
 */
export function selectMostUrgentPair(
  state: ToneQuizState
): { target: FullTone; other: FullTone } | null {
  const now = Date.now();
  const pairs = Object.entries(state.pairCards)
    .filter(([, pc]) => pc.card !== null)
    .map(([key, pc]) => {
      const [target, other] = key.split("-") as [FullTone, FullTone];
      const hours = pc.lastReviewedAt
        ? (now - pc.lastReviewedAt) / (1000 * 60 * 60)
        : Infinity;
      const retrievability = deck.getRetrievability(pc.card!, hours);
      const isDue = hours >= pc.card!.I; // Due when hours elapsed >= scheduled interval
      return { target, other, retrievability, isDue };
    })
    .filter((p) => p.isDue); // Only consider cards that are due

  if (pairs.length === 0) return null;

  // Sort by retrievability (lowest = most urgent)
  pairs.sort((a, b) => a.retrievability - b.retrievability);
  return { target: pairs[0].target, other: pairs[0].other };
}

/**
 * Record a review for a target-other pair in FSRS.
 * Uses hours as the time unit (faster decay than typical flashcards).
 */
export function recordPairReview(
  state: ToneQuizState,
  target: FullTone,
  other: FullTone,
  grade: Grade
): ToneQuizState {
  const key = `${target}-${other}`;
  const now = Date.now();
  const existing = state.pairCards[key];

  let newCard: Card;
  if (!existing?.card) {
    newCard = deck.newCard(grade);
  } else {
    const hours = existing.lastReviewedAt
      ? (now - existing.lastReviewedAt) / (1000 * 60 * 60)
      : 0;
    newCard = deck.gradeCard(existing.card, hours, grade);
  }

  return {
    ...state,
    pairCards: {
      ...state.pairCards,
      [key]: {
        card: newCard,
        lastReviewedAt: now,
        reviewCount: (existing?.reviewCount ?? 0) + 1,
      },
    },
  };
}

/**
 * Record a question result and update learning state.
 */
export function recordQuestion(
  state: ToneQuizState,
  record: QuestionRecord
): ToneQuizState {
  let newState: ToneQuizState = {
    ...state,
    history: [...state.history, record],
    lastPlayedAt: record.timestamp,
    questionsSinceLastUnlock: state.questionsSinceLastUnlock + 1,
  };

  // Only update performance and FSRS state if this was first in streak
  if (record.wasFirstInStreak) {
    const target = record.targetNote as FullTone;
    const other = record.otherNote as FullTone;
    const questionType = record.questionType ?? "two-note";

    if (questionType === "single-note") {
      // Track single-note performance: target is the played note, other is the alternative
      if (!newState.singleNotePerformance[target]) {
        newState.singleNotePerformance[target] = {};
      }
      if (!newState.singleNotePerformance[target][other]) {
        newState.singleNotePerformance[target][other] = [];
      }
      newState.singleNotePerformance[target][other] = [
        ...newState.singleNotePerformance[target][other],
        record.correct,
      ];
    } else {
      // Track two-note performance
      if (!newState.performance[target]) {
        newState.performance[target] = {};
      }
      if (!newState.performance[target][other]) {
        newState.performance[target][other] = [];
      }
      newState.performance[target][other] = [
        ...newState.performance[target][other],
        record.correct,
      ];
    }

    // Update FSRS state for this pair (both question types)
    const grade = record.correct ? Grade.GOOD : Grade.AGAIN;
    newState = recordPairReview(newState, target, other, grade);
  }

  // Check for newly earned unlocks and process pending unlocks
  newState = checkAndQueueUnlocks(newState);

  return newState;
}

/**
 * Check if a note was just introduced by comparing prev and current state.
 * This is used by the UI to show the introduction screen.
 */
export function getLastIntroducedNote(
  prevState: ToneQuizState,
  currentState: ToneQuizState
): FullTone | null {
  const prevVocab = new Set(prevState.learningVocabulary);
  for (const note of currentState.learningVocabulary) {
    if (!prevVocab.has(note)) {
      return note;
    }
  }
  return null;
}

/**
 * Select target note, respecting stickiness.
 * Stays on same target until user gets STREAK_LENGTH correct in a row.
 * Returns [target, octave, isNewTarget, isFirstOnTarget, updatedState, introducedNote]
 * where introducedNote is the newly added vocabulary note (or null).
 *
 * Note: With the new unlock system, note introductions happen through the
 * pendingUnlocks queue in recordQuestion. The introducedNote return value
 * is now always null - use getLastIntroducedNote() to detect introductions.
 */
export function selectTargetNote(
  state: ToneQuizState,
  pickOctave: (note: FullTone) => number
): [FullTone, number, boolean, boolean, ToneQuizState, FullTone | null] {
  // Check if we should continue with current target (haven't got 3 correct yet)
  if (
    state.currentTarget &&
    state.currentTargetOctave !== null &&
    state.correctStreak < STREAK_LENGTH
  ) {
    const isFirst = state.isFirstOnTarget;
    return [
      state.currentTarget,
      state.currentTargetOctave,
      false,
      isFirst,
      { ...state, isFirstOnTarget: false },
      null,
    ];
  }

  // Got 3 correct in a row (or first time) - pick a new target
  // Pick the least practiced note from vocabulary
  const newTarget = selectLeastPracticedNote(state);
  const newOctave = pickOctave(newTarget);

  // Only count as "new target" if it actually changed
  const actuallyChanged = newTarget !== state.currentTarget;

  return [
    newTarget,
    newOctave,
    actuallyChanged,
    true, // First question on new target (for familiarity tracking)
    {
      ...state,
      currentTarget: newTarget,
      currentTargetOctave: newOctave,
      correctStreak: 0,
      isFirstOnTarget: false,
    },
    null, // Note introductions now happen via unlock system
  ];
}

/**
 * Update streak after answering a question.
 * Correct: increment streak. Wrong: reset to 0.
 */
export function updateStreak(state: ToneQuizState, wasCorrect: boolean): ToneQuizState {
  if (wasCorrect) {
    return { ...state, correctStreak: state.correctStreak + 1 };
  } else {
    return { ...state, correctStreak: 0 };
  }
}

/**
 * Randomly order which note plays first.
 */
export function randomizeOrder<T>(a: T, b: T): [T, T] {
  return Math.random() < 0.5 ? [a, b] : [b, a];
}

// ============================================================================
// Vocabulary-Based Note and Octave Selection Functions
// ============================================================================

/**
 * Pick a random octave from available octaves (3, 4, or 5).
 */
export function pickRandomOctave(): number {
  return AVAILABLE_OCTAVES[Math.floor(Math.random() * AVAILABLE_OCTAVES.length)];
}

/**
 * Select two different notes from the vocabulary for a two-note question.
 * Returns [noteA, noteB] where both are from the learning vocabulary.
 */
export function selectVocabPair(state: ToneQuizState): [FullTone, FullTone] {
  const vocab = state.learningVocabulary;
  if (vocab.length < 2) {
    throw new Error("Vocabulary must have at least 2 notes");
  }

  // Pick first note randomly
  const idx1 = Math.floor(Math.random() * vocab.length);
  const noteA = vocab[idx1];

  // Pick second note randomly (different from first)
  let idx2 = Math.floor(Math.random() * (vocab.length - 1));
  if (idx2 >= idx1) idx2++; // Shift to skip idx1
  const noteB = vocab[idx2];

  return [noteA, noteB];
}

/**
 * Get the pitch value for a note at a given octave.
 * Pitch = semitones + octave * 12
 */
export function getNotePitch(note: FullTone, octave: number): number {
  return NOTE_SEMITONES[note] + octave * 12;
}

/**
 * Get all valid octave pairs for two notes where one must be higher than the other.
 * Returns array of [higherOctave, lowerOctave] pairs where:
 * - Both octaves are in {3, 4, 5}
 * - |octave1 - octave2| <= 1 (same or adjacent octaves)
 * - Higher note's pitch > lower note's pitch
 *
 * @param higherNote - The note that should be higher in pitch
 * @param lowerNote - The note that should be lower in pitch
 * @returns Array of valid [higherOctave, lowerOctave] pairs
 */
export function getValidOctavePairs(
  higherNote: FullTone,
  lowerNote: FullTone
): Array<[number, number]> {
  const validPairs: Array<[number, number]> = [];

  for (const higherOctave of AVAILABLE_OCTAVES) {
    for (const lowerOctave of AVAILABLE_OCTAVES) {
      // Must be same or adjacent octaves (no 3+5 pairs)
      if (Math.abs(higherOctave - lowerOctave) > 1) continue;

      const higherPitch = getNotePitch(higherNote, higherOctave);
      const lowerPitch = getNotePitch(lowerNote, lowerOctave);

      // Higher note must actually be higher in pitch
      if (higherPitch > lowerPitch) {
        validPairs.push([higherOctave, lowerOctave]);
      }
    }
  }

  return validPairs;
}

/**
 * Select octaves for a two-note question where one note should be higher.
 * Randomly selects from valid octave combinations.
 *
 * @param higherNote - The note that should be higher in pitch
 * @param lowerNote - The note that should be lower in pitch
 * @returns [higherOctave, lowerOctave] or null if no valid combination exists
 */
export function selectOctavesForPair(
  higherNote: FullTone,
  lowerNote: FullTone
): [number, number] | null {
  const validPairs = getValidOctavePairs(higherNote, lowerNote);
  if (validPairs.length === 0) return null;
  return validPairs[Math.floor(Math.random() * validPairs.length)];
}

