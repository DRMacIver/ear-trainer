/**
 * Note-Frequency Mapping State Management
 *
 * Manages spaced repetition for memorizing the bidirectional mapping
 * between musical notes (C4-B4) and their frequencies using FSRS algorithm.
 */

import { Card, Grade, createDeck } from "./fsrs.js";
import { NOTE_FREQUENCIES } from "../audio.js";

// All note-frequency mappings for octave 4
export interface NoteFreqMapping {
  note: string; // e.g., "A4"
  frequency: number; // e.g., 440 (rounded to nearest Hz)
}

// Direction of the quiz question
export type QuizDirection = "freqToNote" | "noteToFreq";

// A single flashcard (one direction of a mapping)
export interface NoteFreqCard {
  note: string;
  direction: QuizDirection;
  card: Card | null; // null = not yet introduced
  lastReviewedAt: number | null;
  reviewCount: number;
}

export interface NoteFreqReviewRecord {
  note: string;
  direction: QuizDirection;
  timestamp: number;
  grade: Grade;
  wasNew: boolean;
  guessHistory?: string[] | number[]; // Wrong guesses (notes or frequencies)
  timeMs?: number;
  replayTimesMs?: number[];
}

export interface NoteFreqMemoryState {
  mappings: NoteFreqMapping[];
  cards: NoteFreqCard[];
  history: NoteFreqReviewRecord[];
  sessionCount: number;
}

// Generate mappings for octave 4
const NOTE_NAMES_IN_ORDER = [
  "C4",
  "C#4",
  "D4",
  "D#4",
  "E4",
  "F4",
  "F#4",
  "G4",
  "G#4",
  "A4",
  "A#4",
  "B4",
];

export const ALL_MAPPINGS: NoteFreqMapping[] = NOTE_NAMES_IN_ORDER.map(
  (note) => ({
    note,
    frequency: Math.round(NOTE_FREQUENCIES[note]),
  })
);

// Introduction order: start well-separated then fill gaps
// C4, F4, A4 first (spread across the octave), then fill in
export const INTRODUCTION_ORDER = [
  "C4",
  "A4",
  "F4", // First 3: well separated
  "D4",
  "G4",
  "B4", // Next 3: fill major gaps
  "E4",
  "C#4",
  "F#4", // Next 3: fill smaller gaps
  "D#4",
  "G#4",
  "A#4", // Final 3: remaining notes
];

const STORAGE_KEY = "ear-trainer:note-freq-memory";

const deck = createDeck();

function createInitialState(): NoteFreqMemoryState {
  const cards: NoteFreqCard[] = [];

  // Create two cards per mapping (one for each direction)
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

/**
 * Get notes that have been introduced (both directions have card state).
 */
export function getIntroducedNotes(state: NoteFreqMemoryState): string[] {
  const introduced = new Set<string>();

  for (const card of state.cards) {
    if (card.card !== null) {
      // Only count as introduced if both directions are introduced
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

/**
 * Get days since last review for a card.
 */
function daysSinceReview(card: NoteFreqCard): number {
  if (!card.lastReviewedAt) return Infinity;
  const now = Date.now();
  return (now - card.lastReviewedAt) / (1000 * 60 * 60 * 24);
}

/**
 * Get cards that are due for review (introduced cards sorted by urgency).
 */
export function getDueCards(state: NoteFreqMemoryState): NoteFreqCard[] {
  const now = Date.now();
  return state.cards
    .filter((c) => {
      if (!c.card || !c.lastReviewedAt) return false;
      const days = (now - c.lastReviewedAt) / (1000 * 60 * 60 * 24);
      return days >= 0;
    })
    .sort((a, b) => {
      const daysA = daysSinceReview(a);
      const daysB = daysSinceReview(b);
      const rA = a.card ? deck.getRetrievability(a.card, daysA) : 1;
      const rB = b.card ? deck.getRetrievability(b.card, daysB) : 1;
      return rA - rB;
    });
}

export interface SessionCards {
  newNotes: string[]; // Notes to introduce (both directions for each)
  reviewCards: NoteFreqCard[]; // Individual cards to review
  isFirstSession: boolean;
  isComplete: boolean;
}

const MAX_NEW_MAPPINGS_PER_SESSION = 4;

/**
 * Select cards for a session.
 * - First session: introduce first 3 notes from INTRODUCTION_ORDER
 * - Later sessions: up to 4 new notes + reviews
 */
export function selectSessionCards(state: NoteFreqMemoryState): SessionCards {
  const introduced = getIntroducedNotes(state);
  const newNotes = getNewNotes(state);
  const isFirstSession = introduced.length === 0;

  // All notes introduced
  if (newNotes.length === 0) {
    const dueCards = getDueCards(state);
    return {
      newNotes: [],
      reviewCards: dueCards.slice(0, 8), // Review up to 8 cards
      isFirstSession: false,
      isComplete: true,
    };
  }

  // First session: introduce first 3 well-separated notes
  if (isFirstSession) {
    const notesToIntroduce = newNotes.slice(0, 3);
    return {
      newNotes: notesToIntroduce,
      reviewCards: [],
      isFirstSession: true,
      isComplete: false,
    };
  }

  // Normal session: introduce up to 4 new notes + reviews
  const notesToIntroduce = newNotes.slice(0, MAX_NEW_MAPPINGS_PER_SESSION);

  // Get due cards for review (excluding cards for notes we're introducing)
  const dueCards = getDueCards(state).filter(
    (c) => !notesToIntroduce.includes(c.note)
  );

  // Aim for a total of ~8-10 cards in session
  const targetTotal = 10;
  const newCardCount = notesToIntroduce.length * 2; // 2 directions per note
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

/**
 * Record a review result for a specific card.
 */
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

/**
 * Increment session count.
 */
export function incrementSessionCount(
  state: NoteFreqMemoryState
): NoteFreqMemoryState {
  return {
    ...state,
    sessionCount: state.sessionCount + 1,
  };
}

/**
 * Get statistics about learning progress.
 */
export function getStats(state: NoteFreqMemoryState): {
  introducedNotes: number;
  totalNotes: number;
  introducedCards: number;
  totalCards: number;
  sessionsCompleted: number;
  totalReviews: number;
} {
  const introducedCards = state.cards.filter((c) => c.card !== null).length;
  return {
    introducedNotes: getIntroducedNotes(state).length,
    totalNotes: ALL_MAPPINGS.length,
    introducedCards,
    totalCards: state.cards.length,
    sessionsCompleted: state.sessionCount,
    totalReviews: state.history.length,
  };
}

/**
 * Get the frequency for a note (rounded to nearest Hz).
 */
export function getFrequencyForNote(note: string): number {
  const mapping = ALL_MAPPINGS.find((m) => m.note === note);
  return mapping?.frequency ?? 0;
}

/**
 * Get nearby notes for choice generation (returns notes sorted chromatically).
 */
export function getNearbyNotes(
  targetNote: string,
  count: number = 4
): string[] {
  const targetIndex = NOTE_NAMES_IN_ORDER.indexOf(targetNote);
  if (targetIndex === -1) return [targetNote];

  const choices = [targetNote];
  let offset = 1;

  // Add notes alternating above and below
  while (choices.length < count && offset < NOTE_NAMES_IN_ORDER.length) {
    if (targetIndex + offset < NOTE_NAMES_IN_ORDER.length) {
      choices.push(NOTE_NAMES_IN_ORDER[targetIndex + offset]);
    }
    if (choices.length < count && targetIndex - offset >= 0) {
      choices.push(NOTE_NAMES_IN_ORDER[targetIndex - offset]);
    }
    offset++;
  }

  // Sort chromatically
  return choices.sort(
    (a, b) => NOTE_NAMES_IN_ORDER.indexOf(a) - NOTE_NAMES_IN_ORDER.indexOf(b)
  );
}

/**
 * Get nearby frequencies for choice generation (returns frequencies sorted ascending).
 */
export function getNearbyFrequencies(
  targetFreq: number,
  count: number = 4
): number[] {
  const allFreqs = ALL_MAPPINGS.map((m) => m.frequency).sort((a, b) => a - b);
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

/**
 * Clear all progress and start fresh.
 */
export function clearAllProgress(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage may be unavailable
  }
}
