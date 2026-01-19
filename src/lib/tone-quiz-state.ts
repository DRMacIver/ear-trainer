/**
 * State management for the tone quiz exercise.
 * Tracks play history and learning progress for continuous play sessions.
 */

const STORAGE_KEY = "tone-quiz-state";

/** Full tones (no sharps/flats) in chromatic order */
export const FULL_TONES = ["C", "D", "E", "F", "G", "A", "B"] as const;
export type FullTone = (typeof FULL_TONES)[number];

/** Order to introduce notes: C and G first (well separated), then fill in */
export const LEARNING_ORDER: FullTone[] = ["C", "G", "E", "A", "D", "F", "B"];

/** Number of recent attempts to consider for familiarity */
const FAMILIARITY_WINDOW = 4;
/** Minimum correct in window to be considered familiar with a pairing */
const FAMILIARITY_THRESHOLD = 3;
/** Number of questions to repeat the same target */
export const STREAK_LENGTH = 3;

export interface QuestionRecord {
  timestamp: number;
  noteA: string; // Note played first (with octave, e.g., "C4")
  noteB: string; // Note played second (with octave, e.g., "D4")
  targetNote: string; // Which note we asked about (without octave, e.g., "C")
  otherNote: string; // The other note family (without octave)
  correct: boolean;
  wasFirstInStreak: boolean; // Only first-in-streak counts for familiarity
  timeMs?: number;
}

export interface ToneQuizState {
  history: QuestionRecord[];
  lastPlayedAt: number | null;

  // Learning state
  learningVocabulary: FullTone[]; // Notes currently being learned
  performance: Record<string, Record<string, boolean[]>>; // target -> other -> results

  // Sticky target state
  currentTarget: FullTone | null;
  currentTargetOctave: number | null;
  streakCount: number;
}

function createInitialState(): ToneQuizState {
  return {
    history: [],
    lastPlayedAt: null,
    learningVocabulary: ["C", "G"], // Start with C and G
    performance: {},
    currentTarget: null,
    currentTargetOctave: null,
    streakCount: 0,
  };
}

export function loadState(): ToneQuizState {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return createInitialState();
  }
  const parsed = JSON.parse(stored) as Partial<ToneQuizState>;
  // Merge with defaults for backwards compatibility
  return {
    ...createInitialState(),
    ...parsed,
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
 * Get the chromatic distance between two notes (0-6, wrapping).
 */
export function getNoteDistance(a: FullTone, b: FullTone): number {
  const idxA = FULL_TONES.indexOf(a);
  const idxB = FULL_TONES.indexOf(b);
  const diff = Math.abs(idxA - idxB);
  return Math.min(diff, FULL_TONES.length - diff);
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
 * Check if all notes in vocabulary are familiar.
 */
export function allVocabularyFamiliar(state: ToneQuizState): boolean {
  return state.learningVocabulary.every((note) => isNoteFamiliar(state, note));
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

/**
 * Record a question result and update learning state.
 */
export function recordQuestion(
  state: ToneQuizState,
  record: QuestionRecord
): ToneQuizState {
  const newState = {
    ...state,
    history: [...state.history, record],
    lastPlayedAt: record.timestamp,
  };

  // Only update performance if this was first in streak
  if (record.wasFirstInStreak) {
    const target = record.targetNote as FullTone;
    const other = record.otherNote as FullTone;

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

  return newState;
}

/**
 * Select an "other" note for a question about the target.
 * Starts with distant notes, gets closer as user improves.
 */
export function selectOtherNote(
  state: ToneQuizState,
  target: FullTone
): FullTone {
  // Get all other notes sorted by distance from target (farthest first)
  const others = FULL_TONES.filter((n) => n !== target).sort(
    (a, b) => getNoteDistance(target, b) - getNoteDistance(target, a)
  );

  // Find the closest note we're NOT yet familiar with
  for (let i = others.length - 1; i >= 0; i--) {
    if (!isFamiliarWith(state, target, others[i])) {
      // Return a note at this distance or farther (with some randomness)
      const candidates = others.slice(0, i + 1);
      // Bias towards farther notes if we're not familiar with closer ones
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
  }

  // Familiar with all - pick randomly, slight bias to adjacent for challenge
  const [lower, upper] = getAdjacentNotes(target);
  if (Math.random() < 0.4) {
    return Math.random() < 0.5 ? lower : upper;
  }
  return others[Math.floor(Math.random() * others.length)];
}

/**
 * Select target note, respecting stickiness.
 * Returns [target, octave, isNewTarget, updatedState]
 */
export function selectTargetNote(
  state: ToneQuizState,
  pickOctave: (note: FullTone) => number
): [FullTone, number, boolean, ToneQuizState] {
  // Check if we should continue the streak
  if (
    state.currentTarget &&
    state.currentTargetOctave !== null &&
    state.streakCount < STREAK_LENGTH
  ) {
    return [
      state.currentTarget,
      state.currentTargetOctave,
      false,
      { ...state, streakCount: state.streakCount + 1 },
    ];
  }

  // Check if we should add a new note to vocabulary
  let newVocabulary = state.learningVocabulary;
  if (allVocabularyFamiliar(state)) {
    const nextNote = getNextNoteToLearn(state);
    if (nextNote) {
      newVocabulary = [...state.learningVocabulary, nextNote];
    }
  }

  // Pick a new target from vocabulary
  // Bias towards notes that aren't fully familiar yet
  const unfamiliar = newVocabulary.filter((n) => !isNoteFamiliar(state, n));
  const candidates = unfamiliar.length > 0 ? unfamiliar : newVocabulary;
  const newTarget = candidates[Math.floor(Math.random() * candidates.length)];
  const newOctave = pickOctave(newTarget);

  return [
    newTarget,
    newOctave,
    true,
    {
      ...state,
      learningVocabulary: newVocabulary,
      currentTarget: newTarget,
      currentTargetOctave: newOctave,
      streakCount: 1,
    },
  ];
}

/**
 * Randomly order which note plays first.
 */
export function randomizeOrder<T>(a: T, b: T): [T, T] {
  return Math.random() < 0.5 ? [a, b] : [b, a];
}
