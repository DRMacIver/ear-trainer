/**
 * State management for the tone quiz exercise.
 * Tracks play history and learning progress for continuous play sessions.
 */

import { Card, Grade, createDeck } from "./fsrs.js";

const STORAGE_KEY = "tone-quiz-state";
const deck = createDeck();

export { Grade };

/** Full tones (no sharps/flats) in chromatic order */
export const FULL_TONES = ["C", "D", "E", "F", "G", "A", "B"] as const;
export type FullTone = (typeof FULL_TONES)[number];

/** Order to introduce notes: C and G first (well separated), then fill in */
export const LEARNING_ORDER: FullTone[] = ["C", "G", "E", "A", "D", "F", "B"];

/** Number of recent attempts to consider for familiarity */
const FAMILIARITY_WINDOW = 4;
/** Minimum correct in window to be considered familiar with a pairing */
const FAMILIARITY_THRESHOLD = 3;
/** Number of consecutive correct answers needed to move to next target */
export const STREAK_LENGTH = 3;

/** Probability of selecting the next candidate note as "other" */
const CANDIDATE_SELECTION_CHANCE = 0.2;
/** Consecutive correct needed against each closest note to introduce candidate */
const CANDIDATE_STREAK_THRESHOLD = 5;
/** Maximum questions without introduction before forcing it */
const MAX_QUESTIONS_WITHOUT_INTRODUCTION = 30;

export type QuestionType = "two-note" | "single-note";

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

  // Candidate introduction tracking
  candidateStreaks: Record<string, number>; // "target-candidate" -> consecutive correct
  questionsSinceLastIntroduction: number;

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
    candidateStreaks: {},
    questionsSinceLastIntroduction: 0,
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
  const parsed = JSON.parse(stored) as Partial<ToneQuizState>;
  // Merge with defaults for backwards compatibility
  const initial = createInitialState();
  return {
    ...initial,
    ...parsed,
    // Ensure new fields have defaults (migration from older state)
    singleNotePerformance: parsed.singleNotePerformance ?? {},
    pairCards: parsed.pairCards ?? {},
    session: parsed.session ?? {
      sessionStartTime: Date.now(),
      previousSessionEnd: parsed.lastPlayedAt ?? null,
    },
  };
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

/**
 * Check if the candidate is ready to be introduced based on streak performance.
 * Requires CANDIDATE_STREAK_THRESHOLD consecutive correct against each of the
 * two closest vocabulary notes.
 */
export function isCandidateReadyByStreak(
  state: ToneQuizState,
  candidate: FullTone
): boolean {
  const closest = getClosestVocabularyNotes(state.learningVocabulary, candidate);
  if (closest.length < 2) return false; // Need at least 2 vocabulary notes

  return closest.every((target) => {
    const key = `${target}-${candidate}`;
    return (state.candidateStreaks[key] ?? 0) >= CANDIDATE_STREAK_THRESHOLD;
  });
}

/**
 * Check if the user is familiar with distinguishing target from other.
 */
export function isFamiliarWith(
  state: ToneQuizState,
  target: FullTone,
  other: FullTone
): boolean {
  const results = state.performance[target]?.[other] ?? [];
  if (results.length < FAMILIARITY_WINDOW) return false;
  const recent = results.slice(-FAMILIARITY_WINDOW);
  const correct = recent.filter(Boolean).length;
  return correct >= FAMILIARITY_THRESHOLD;
}

/**
 * Check if a note is fully familiar (can distinguish from both adjacent notes).
 */
export function isNoteFamiliar(state: ToneQuizState, note: FullTone): boolean {
  const [lower, upper] = getAdjacentNotes(note);
  return isFamiliarWith(state, note, lower) && isFamiliarWith(state, note, upper);
}

/**
 * Check if a note is ready for single-note questions.
 * A note is ready when the user can distinguish it from both adjacent notes.
 */
export function isReadyForSingleNote(state: ToneQuizState, note: FullTone): boolean {
  return isNoteFamiliar(state, note);
}

/**
 * Check if a pair of notes is ready for single-note questions.
 * A pair is ready when the user can distinguish between them in two-note mode.
 */
export function isPairReadyForSingleNote(
  state: ToneQuizState,
  noteA: FullTone,
  noteB: FullTone
): boolean {
  // Can ask "Is this A or B?" when user is familiar with A vs B in both directions
  return isFamiliarWith(state, noteA, noteB) && isFamiliarWith(state, noteB, noteA);
}

/**
 * Check if user is familiar with identifying a note in single-note questions.
 * Tracks: "when `played` was played, and choice was `played` vs `alternative`, was it correct?"
 */
export function isSingleNoteFamiliarWith(
  state: ToneQuizState,
  played: FullTone,
  alternative: FullTone
): boolean {
  const results = state.singleNotePerformance[played]?.[alternative] ?? [];
  if (results.length < FAMILIARITY_WINDOW) return false;
  const recent = results.slice(-FAMILIARITY_WINDOW);
  const correct = recent.filter(Boolean).length;
  return correct >= FAMILIARITY_THRESHOLD;
}

/**
 * Check if a pair is familiar for single-note questions in both directions.
 */
export function isSingleNotePairFamiliar(
  state: ToneQuizState,
  noteA: FullTone,
  noteB: FullTone
): boolean {
  return (
    isSingleNoteFamiliarWith(state, noteA, noteB) &&
    isSingleNoteFamiliarWith(state, noteB, noteA)
  );
}

/**
 * Get all pairs in vocabulary that are ready for single-note questions.
 */
export function getReadySingleNotePairs(
  state: ToneQuizState
): Array<[FullTone, FullTone]> {
  const pairs: Array<[FullTone, FullTone]> = [];
  const vocab = state.learningVocabulary;

  for (let i = 0; i < vocab.length; i++) {
    for (let j = i + 1; j < vocab.length; j++) {
      if (isPairReadyForSingleNote(state, vocab[i], vocab[j])) {
        pairs.push([vocab[i], vocab[j]]);
      }
    }
  }

  return pairs;
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
 * Check if all vocabulary notes are single-note-familiar with their vocab neighbors.
 * Used to gate introduction of new notes.
 * Each note must be distinguishable from the notes on either side of it
 * within the learning set (not chromatic neighbors).
 */
export function areAllVocabSingleNotesFamiliar(state: ToneQuizState): boolean {
  const vocab = state.learningVocabulary;

  // Need at least 2 notes to have neighbors
  if (vocab.length < 2) {
    return true;
  }

  // Check that each note is single-note-familiar with its vocab neighbors
  for (const note of vocab) {
    const [lower, upper] = getAdjacentNotesInVocabulary(note, vocab);

    // Must be familiar with lower neighbor (bidirectionally)
    if (lower && !isSingleNotePairFamiliar(state, note, lower)) {
      return false;
    }

    // Must be familiar with upper neighbor (bidirectionally)
    // Note: for 2-note vocab, upper === lower, so this is redundant but harmless
    if (upper && upper !== lower && !isSingleNotePairFamiliar(state, note, upper)) {
      return false;
    }
  }

  return true;
}

/**
 * Select a pair for single-note question.
 * Prioritizes:
 * 1. Adjacent pairs (neighbors in learning set) that aren't familiar
 * 2. Other unfamiliar pairs
 * 3. Any ready pair
 * Returns null if no pairs are ready for single-note questions.
 */
export function selectSingleNotePair(
  state: ToneQuizState
): { noteA: FullTone; noteB: FullTone } | null {
  const readyPairs = getReadySingleNotePairs(state);

  if (readyPairs.length === 0) return null;

  const vocab = state.learningVocabulary;
  const adjacentPairs = getAdjacentVocabPairs(vocab);

  // Filter to adjacent pairs that are also ready
  const readyAdjacentPairs = adjacentPairs.filter(([a, b]) =>
    readyPairs.some(
      ([ra, rb]) => (ra === a && rb === b) || (ra === b && rb === a)
    )
  );

  // Priority 1: Unfamiliar adjacent pairs
  const unfamiliarAdjacent = readyAdjacentPairs.filter(
    ([a, b]) => !isSingleNotePairFamiliar(state, a, b)
  );
  if (unfamiliarAdjacent.length > 0) {
    const [noteA, noteB] =
      unfamiliarAdjacent[Math.floor(Math.random() * unfamiliarAdjacent.length)];
    return { noteA, noteB };
  }

  // Priority 2: Any unfamiliar pairs
  const unfamiliarPairs = readyPairs.filter(
    ([a, b]) => !isSingleNotePairFamiliar(state, a, b)
  );
  if (unfamiliarPairs.length > 0) {
    const [noteA, noteB] =
      unfamiliarPairs[Math.floor(Math.random() * unfamiliarPairs.length)];
    return { noteA, noteB };
  }

  // Priority 3: Any ready pair
  const [noteA, noteB] =
    readyPairs[Math.floor(Math.random() * readyPairs.length)];
  return { noteA, noteB };
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
    questionsSinceLastIntroduction: state.questionsSinceLastIntroduction + 1,
    candidateStreaks: { ...state.candidateStreaks },
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
      // Track two-note performance (existing logic)
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

      // Track candidate streaks when the "other" note is the next candidate
      const candidate = getNextNoteToLearn(state);
      if (candidate && other === candidate) {
        const key = `${target}-${candidate}`;
        if (record.correct) {
          newState.candidateStreaks[key] = (newState.candidateStreaks[key] ?? 0) + 1;
        } else {
          // Reset streak on wrong answer
          newState.candidateStreaks[key] = 0;
        }
      }
    }

    // Update FSRS state for this pair (both question types)
    const grade = record.correct ? Grade.GOOD : Grade.AGAIN;
    newState = recordPairReview(newState, target, other, grade);
  }

  return newState;
}

/**
 * Check if note `a` is higher than note `b` in chromatic order.
 */
function isHigherNote(a: FullTone, b: FullTone): boolean {
  return FULL_TONES.indexOf(a) > FULL_TONES.indexOf(b);
}

/**
 * Select from candidates using distance-weighted random selection.
 * Candidates should already be sorted by distance (farthest first).
 */
function selectWeighted(candidates: FullTone[]): FullTone {
  if (candidates.length === 0) {
    throw new Error("No candidates to select from");
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  // Weight by position (farther = more likely)
  const weights = candidates.map((_, idx) => idx + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;
  for (let j = 0; j < candidates.length; j++) {
    random -= weights[j];
    if (random <= 0) {
      return candidates[j];
    }
  }
  return candidates[candidates.length - 1];
}

/** Probability of selecting an unfamiliar vocab neighbor to unlock single-note questions */
const VOCAB_NEIGHBOR_PRIORITY_CHANCE = 0.3;

/**
 * Select an "other" note for a question about the target.
 * Prioritizes vocab neighbors to unlock single-note questions.
 * Ensures 50% higher / 50% lower to prevent pitch-based guessing.
 * 20% chance to select the next candidate note (for introduction testing).
 */
export function selectOtherNote(
  state: ToneQuizState,
  target: FullTone
): FullTone {
  // 30% chance to prioritize unfamiliar vocab neighbors
  // This helps unlock single-note questions (which require vocab neighbor familiarity)
  if (Math.random() < VOCAB_NEIGHBOR_PRIORITY_CHANCE) {
    const [lowerVocab, upperVocab] = getAdjacentNotesInVocabulary(
      target,
      state.learningVocabulary
    );
    const unfamiliarVocabNeighbors: FullTone[] = [];
    if (lowerVocab && !isFamiliarWith(state, target, lowerVocab)) {
      unfamiliarVocabNeighbors.push(lowerVocab);
    }
    if (
      upperVocab &&
      upperVocab !== lowerVocab &&
      !isFamiliarWith(state, target, upperVocab)
    ) {
      unfamiliarVocabNeighbors.push(upperVocab);
    }
    if (unfamiliarVocabNeighbors.length > 0) {
      // Pick randomly from unfamiliar vocab neighbors
      return unfamiliarVocabNeighbors[
        Math.floor(Math.random() * unfamiliarVocabNeighbors.length)
      ];
    }
  }

  // 20% chance to select the next candidate note (if one exists)
  const candidate = getNextNoteToLearn(state);
  if (candidate && candidate !== target && Math.random() < CANDIDATE_SELECTION_CHANCE) {
    return candidate;
  }

  // First decide: should the other note be higher or lower?
  const wantHigher = Math.random() < 0.5;

  // Split notes into higher and lower groups
  const allOthers = FULL_TONES.filter((n) => n !== target);
  const higherNotes = allOthers.filter((n) => isHigherNote(n, target));
  const lowerNotes = allOthers.filter((n) => !isHigherNote(n, target));

  // Pick the group we want, fall back to the other if empty
  let pool = wantHigher ? higherNotes : lowerNotes;
  if (pool.length === 0) {
    pool = wantHigher ? lowerNotes : higherNotes;
  }

  // Sort by distance from target (farthest first)
  pool = [...pool].sort(
    (a, b) => getNoteDistance(target, b) - getNoteDistance(target, a)
  );

  // Find the closest note we're NOT yet familiar with
  for (let i = pool.length - 1; i >= 0; i--) {
    if (!isFamiliarWith(state, target, pool[i])) {
      // Return a note at this distance or farther (with some randomness)
      const candidates = pool.slice(0, i + 1);
      return selectWeighted(candidates);
    }
  }

  // Familiar with all in this direction - pick randomly from pool
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Select target note, respecting stickiness.
 * Stays on same target until user gets STREAK_LENGTH correct in a row.
 * Returns [target, octave, isNewTarget, isFirstOnTarget, updatedState, introducedNote]
 * where introducedNote is the newly added vocabulary note (or null).
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
  // Check if we should add a new note to vocabulary
  let newVocabulary = state.learningVocabulary;
  let introducedNote: FullTone | null = null;
  const nextNote = getNextNoteToLearn(state);

  if (nextNote) {
    // Introduce new note if:
    // 1. Candidate has 5 consecutive correct against each of its two closest vocabulary notes
    // 2. OR 30 questions have passed without a new introduction
    // AND user is reliable on single-note questions for all current vocab pairs
    const readyByStreak = isCandidateReadyByStreak(state, nextNote);
    const readyByTime =
      state.questionsSinceLastIntroduction >= MAX_QUESTIONS_WITHOUT_INTRODUCTION;
    const singleNoteReliable = areAllVocabSingleNotesFamiliar(state);

    if ((readyByStreak || readyByTime) && singleNoteReliable) {
      newVocabulary = [...state.learningVocabulary, nextNote];
      introducedNote = nextNote;
    }
  }

  // Pick a new target from vocabulary
  // If we just introduced a note, that should be the target
  // Otherwise, bias towards notes that aren't fully familiar yet
  let newTarget: FullTone;
  if (introducedNote) {
    newTarget = introducedNote;
  } else {
    const unfamiliar = newVocabulary.filter((n) => !isNoteFamiliar(state, n));
    const candidates = unfamiliar.length > 0 ? unfamiliar : newVocabulary;
    newTarget = candidates[Math.floor(Math.random() * candidates.length)];
  }
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
      learningVocabulary: newVocabulary,
      currentTarget: newTarget,
      currentTargetOctave: newOctave,
      correctStreak: 0,
      isFirstOnTarget: false,
      // Reset candidate tracking when a new note is introduced
      candidateStreaks: introducedNote ? {} : state.candidateStreaks,
      questionsSinceLastIntroduction: introducedNote
        ? 0
        : state.questionsSinceLastIntroduction,
    },
    introducedNote,
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
