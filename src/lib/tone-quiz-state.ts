/**
 * State management for the tone quiz exercise.
 * Tracks play history for continuous play sessions.
 */

const STORAGE_KEY = "tone-quiz-state";

/** Full tones (no sharps/flats) */
export const FULL_TONES = ["C", "D", "E", "F", "G", "A", "B"] as const;
export type FullTone = (typeof FULL_TONES)[number];

export interface QuestionRecord {
  timestamp: number;
  noteA: string; // Note played first (with octave, e.g., "C4")
  noteB: string; // Note played second (with octave, e.g., "D4")
  targetNote: string; // Which note we asked about (without octave, e.g., "C")
  correct: boolean;
  timeMs?: number; // How long they took to answer
}

export interface ToneQuizState {
  history: QuestionRecord[];
  lastPlayedAt: number | null;
}

export function loadState(): ToneQuizState {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return {
      history: [],
      lastPlayedAt: null,
    };
  }
  return JSON.parse(stored) as ToneQuizState;
}

export function saveState(state: ToneQuizState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearState(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function recordQuestion(
  state: ToneQuizState,
  record: QuestionRecord
): ToneQuizState {
  return {
    ...state,
    history: [...state.history, record],
    lastPlayedAt: record.timestamp,
  };
}

/**
 * Pick two different random full tones.
 */
export function pickRandomPair(): [FullTone, FullTone] {
  const shuffled = [...FULL_TONES].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

/**
 * Pick which note to ask about (randomly one of the two).
 */
export function pickTargetNote(noteA: FullTone, noteB: FullTone): FullTone {
  return Math.random() < 0.5 ? noteA : noteB;
}

/**
 * Randomly order which note plays first.
 */
export function randomizeOrder<T>(a: T, b: T): [T, T] {
  return Math.random() < 0.5 ? [a, b] : [b, a];
}
