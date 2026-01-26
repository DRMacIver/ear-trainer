/**
 * Note-Frequency Mapping State Management
 *
 * Manages spaced repetition for memorizing the bidirectional mapping
 * between musical notes (C3-B5) and their frequencies using FSRS algorithm.
 */

import { Card, Grade, createDeck } from "./fsrs.js";
import { NOTE_FREQUENCIES } from "../audio.js";

export interface NoteFreqMapping {
  note: string; // e.g., "A4"
  frequency: number; // rounded to nearest Hz
  octave: number; // 3, 4, or 5
}

export type QuizDirection = "freqToNote" | "noteToFreq";

export interface NoteFreqCard {
  note: string;
  direction: QuizDirection;
  card: Card | null;
  lastReviewedAt: number | null;
  reviewCount: number;
}

export interface NoteFreqReviewRecord {
  note: string;
  direction: QuizDirection;
  timestamp: number;
  grade: Grade;
  wasNew: boolean;
  guessHistory?: string[] | number[];
  timeMs?: number;
  replayTimesMs?: number[];
}

export interface NoteFreqMemoryState {
  mappings: NoteFreqMapping[];
  cards: NoteFreqCard[];
  history: NoteFreqReviewRecord[];
  sessionCount: number;
}

const NOTE_NAMES = [
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
const OCTAVES = [3, 4, 5];

function generateAllMappings(): NoteFreqMapping[] {
  const mappings: NoteFreqMapping[] = [];
  for (const octave of OCTAVES) {
    for (const name of NOTE_NAMES) {
      const note = `${name}${octave}`;
      mappings.push({
        note,
        frequency: Math.round(NOTE_FREQUENCIES[note]),
        octave,
      });
    }
  }
  return mappings;
}

export const ALL_MAPPINGS = generateAllMappings();

// Introduction order: start with octave 4 non-sharps, then sharps, then expand
export const INTRODUCTION_ORDER = [
  // Octave 4 non-sharps (well separated)
  "C4",
  "A4",
  "F4",
  "D4",
  "G4",
  "B4",
  "E4",
  // Octave 4 sharps
  "C#4",
  "F#4",
  "D#4",
  "G#4",
  "A#4",
  // Octave 3 non-sharps
  "C3",
  "A3",
  "F3",
  "D3",
  "G3",
  "B3",
  "E3",
  // Octave 3 sharps
  "C#3",
  "F#3",
  "D#3",
  "G#3",
  "A#3",
  // Octave 5 non-sharps
  "C5",
  "A5",
  "F5",
  "D5",
  "G5",
  "B5",
  "E5",
  // Octave 5 sharps
  "C#5",
  "F#5",
  "D#5",
  "G#5",
  "A#5",
];

const STORAGE_KEY = "ear-trainer:note-freq-memory-v2";

const deck = createDeck();

function createInitialState(): NoteFreqMemoryState {
  const cards: NoteFreqCard[] = [];

  for (const mapping of ALL_MAPPINGS) {
    cards.push({
      note: mapping.note,
      direction: "freqToNote",
      card: null,
      lastReviewedAt: null,
      reviewCount: 0,
    });
    cards.push({
      note: mapping.note,
      direction: "noteToFreq",
      card: null,
      lastReviewedAt: null,
      reviewCount: 0,
    });
  }

  return {
    mappings: ALL_MAPPINGS,
    cards,
    history: [],
    sessionCount: 0,
  };
}

export function loadState(): NoteFreqMemoryState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.cards && parsed.history !== undefined && parsed.mappings) {
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return createInitialState();
}

export function saveState(state: NoteFreqMemoryState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable
  }
}

export function getOctave(note: string): number {
  const match = note.match(/(\d)$/);
  return match ? parseInt(match[1], 10) : 4;
}

/**
 * Get notes that have been introduced (both directions have card state).
 */
export function getIntroducedNotes(state: NoteFreqMemoryState): string[] {
  const introduced = new Set<string>();

  for (const card of state.cards) {
    if (card.card !== null) {
      const otherDirection = state.cards.find(
        (c) => c.note === card.note && c.direction !== card.direction
      );
      if (otherDirection?.card !== null) {
        introduced.add(card.note);
      }
    }
  }

  return Array.from(introduced);
}

/**
 * Get notes that haven't been introduced yet.
 */
export function getNewNotes(state: NoteFreqMemoryState): string[] {
  const introduced = new Set(getIntroducedNotes(state));
  return INTRODUCTION_ORDER.filter((note) => !introduced.has(note));
}

function daysSinceReview(card: NoteFreqCard): number {
  if (!card.lastReviewedAt) return Infinity;
  return (Date.now() - card.lastReviewedAt) / (1000 * 60 * 60 * 24);
}

export function getDueCards(state: NoteFreqMemoryState): NoteFreqCard[] {
  return state.cards
    .filter((c) => c.card !== null && c.lastReviewedAt !== null)
    .sort((a, b) => {
      const daysA = daysSinceReview(a);
      const daysB = daysSinceReview(b);
      const rA = a.card ? deck.getRetrievability(a.card, daysA) : 1;
      const rB = b.card ? deck.getRetrievability(b.card, daysB) : 1;
      return rA - rB;
    });
}

export interface SessionCards {
  newNotes: string[];
  reviewCards: NoteFreqCard[];
  isFirstSession: boolean;
  isComplete: boolean;
}

const MAX_NEW_NOTES_PER_SESSION = 4;

export function selectSessionCards(state: NoteFreqMemoryState): SessionCards {
  const introduced = getIntroducedNotes(state);
  const newNotes = getNewNotes(state);
  const isFirstSession = introduced.length === 0;

  if (newNotes.length === 0) {
    const dueCards = getDueCards(state);
    return {
      newNotes: [],
      reviewCards: dueCards.slice(0, 10),
      isFirstSession: false,
      isComplete: true,
    };
  }

  if (isFirstSession) {
    return {
      newNotes: newNotes.slice(0, 3),
      reviewCards: [],
      isFirstSession: true,
      isComplete: false,
    };
  }

  const notesToIntroduce = newNotes.slice(0, MAX_NEW_NOTES_PER_SESSION);
  const dueCards = getDueCards(state).filter(
    (c) => !notesToIntroduce.includes(c.note)
  );

  const targetTotal = 10;
  const newCardCount = notesToIntroduce.length * 2;
  const reviewCount = Math.max(0, targetTotal - newCardCount);

  return {
    newNotes: notesToIntroduce,
    reviewCards: dueCards.slice(0, reviewCount),
    isFirstSession: false,
    isComplete: false,
  };
}

export interface ReviewData {
  guessHistory?: string[] | number[];
  timeMs?: number;
  replayTimesMs?: number[];
}

export function recordReview(
  state: NoteFreqMemoryState,
  note: string,
  direction: QuizDirection,
  grade: Grade,
  data: ReviewData = {}
): NoteFreqMemoryState {
  const now = Date.now();
  const cardIndex = state.cards.findIndex(
    (c) => c.note === note && c.direction === direction
  );

  if (cardIndex === -1) return state;

  const existingCard = state.cards[cardIndex];
  const wasNew = existingCard.card === null;

  let newCard: Card;
  if (wasNew) {
    newCard = deck.newCard(grade);
  } else {
    const days = daysSinceReview(existingCard);
    newCard = deck.gradeCard(existingCard.card!, days, grade);
  }

  const updatedCards = [...state.cards];
  updatedCards[cardIndex] = {
    ...existingCard,
    card: newCard,
    lastReviewedAt: now,
    reviewCount: existingCard.reviewCount + 1,
  };

  const newHistory: NoteFreqReviewRecord = {
    note,
    direction,
    timestamp: now,
    grade,
    wasNew,
    guessHistory:
      data.guessHistory && data.guessHistory.length > 0
        ? data.guessHistory
        : undefined,
    timeMs: data.timeMs,
    replayTimesMs:
      data.replayTimesMs && data.replayTimesMs.length > 0
        ? data.replayTimesMs
        : undefined,
  };

  return {
    ...state,
    cards: updatedCards,
    history: [...state.history, newHistory],
  };
}

export function incrementSessionCount(
  state: NoteFreqMemoryState
): NoteFreqMemoryState {
  return {
    ...state,
    sessionCount: state.sessionCount + 1,
  };
}

export function getStats(state: NoteFreqMemoryState): {
  introducedNotes: number;
  totalNotes: number;
  sessionsCompleted: number;
  totalReviews: number;
} {
  return {
    introducedNotes: getIntroducedNotes(state).length,
    totalNotes: ALL_MAPPINGS.length,
    sessionsCompleted: state.sessionCount,
    totalReviews: state.history.length,
  };
}

export function getFrequencyForNote(note: string): number {
  const mapping = ALL_MAPPINGS.find((m) => m.note === note);
  if (mapping) return mapping.frequency;
  return Math.round(NOTE_FREQUENCIES[note] ?? 0);
}

/**
 * Get nearby notes for choice generation (same octave, sorted chromatically).
 */
export function getNearbyNotes(
  targetNote: string,
  count: number = 4,
  allowedNotes?: string[]
): string[] {
  const octave = getOctave(targetNote);
  const octaveNotes = ALL_MAPPINGS.filter((m) => m.octave === octave).map(
    (m) => m.note
  );
  const targetIndex = octaveNotes.indexOf(targetNote);
  if (targetIndex === -1) return [targetNote];

  const allowedSet = allowedNotes
    ? new Set([...allowedNotes, targetNote])
    : null;

  const choices = [targetNote];
  let offset = 1;

  while (choices.length < count && offset < octaveNotes.length) {
    if (targetIndex + offset < octaveNotes.length) {
      const note = octaveNotes[targetIndex + offset];
      if (!allowedSet || allowedSet.has(note)) {
        choices.push(note);
      }
    }
    if (choices.length < count && targetIndex - offset >= 0) {
      const note = octaveNotes[targetIndex - offset];
      if (!allowedSet || allowedSet.has(note)) {
        choices.push(note);
      }
    }
    offset++;
  }

  return choices.sort(
    (a, b) => octaveNotes.indexOf(a) - octaveNotes.indexOf(b)
  );
}

/**
 * Get nearby frequencies for choice generation (same octave, sorted ascending).
 */
export function getNearbyFrequencies(
  targetFreq: number,
  count: number = 4,
  allowedNotes?: string[]
): number[] {
  const targetMapping = ALL_MAPPINGS.find((m) => m.frequency === targetFreq);
  if (!targetMapping) return [targetFreq];

  const octaveNotes = ALL_MAPPINGS.filter(
    (m) => m.octave === targetMapping.octave
  );

  let allFreqs: number[];
  if (allowedNotes) {
    const allowedSet = new Set([...allowedNotes, targetMapping.note]);
    allFreqs = octaveNotes
      .filter((m) => allowedSet.has(m.note))
      .map((m) => m.frequency)
      .sort((a, b) => a - b);
  } else {
    allFreqs = octaveNotes.map((m) => m.frequency).sort((a, b) => a - b);
  }

  const targetIndex = allFreqs.indexOf(targetFreq);
  if (targetIndex === -1) return [targetFreq];

  const choices = [targetFreq];
  let offset = 1;

  while (choices.length < count && offset < allFreqs.length) {
    if (targetIndex + offset < allFreqs.length) {
      choices.push(allFreqs[targetIndex + offset]);
    }
    if (choices.length < count && targetIndex - offset >= 0) {
      choices.push(allFreqs[targetIndex - offset]);
    }
    offset++;
  }

  return choices.sort((a, b) => a - b);
}

export function clearAllProgress(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage may be unavailable
  }
}
