/**
 * Note Identification Memory State Management
 *
 * Progressive spaced repetition for learning note identification through three question types:
 * - octaveId: "What octave is this note in?" (single note, answer 3/4/5)
 * - noteSequence: "What note is this?" (plays note in 3→4→5, answer note family)
 * - fullNote: "What note is this?" (single note, answer full note like A4)
 *
 * Full note cards are gated behind prerequisites (octaveId + noteSequence reliably learned).
 * Cards retire when their training is superseded by full note mastery.
 */

import { Card, Grade, createDeck } from "./fsrs.js";
import { NOTE_FREQUENCIES } from "../audio.js";

export type QuestionType = "octaveId" | "noteSequence" | "fullNote";

export interface NoteIdCard {
  id: string; // e.g., "octaveId:A4", "noteSequence:A", "fullNote:A4"
  questionType: QuestionType;
  note?: string; // For octaveId and fullNote (e.g., "A4")
  noteFamily?: string; // For noteSequence (e.g., "A")
  card: Card | null;
  lastReviewedAt: number | null;
  reviewCount: number;
  retired: boolean;
}

export interface NoteIdReviewRecord {
  cardId: string;
  timestamp: number;
  grade: Grade;
  wasNew: boolean;
  guessHistory?: (string | number)[];
  timeMs?: number;
  replayTimesMs?: number[];
}

export interface NoteIdMemoryState {
  cards: NoteIdCard[];
  history: NoteIdReviewRecord[];
  sessionCount: number;
}

export const NOTE_NAMES = [
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
export const OCTAVES = [3, 4, 5];

// All notes across all octaves
export const ALL_NOTES: string[] = [];
for (const octave of OCTAVES) {
  for (const name of NOTE_NAMES) {
    ALL_NOTES.push(`${name}${octave}`);
  }
}

/**
 * Introduction order for paired octaveId + noteSequence cards.
 * Each entry represents a pairing: the octave 4 note (for octaveId) and its family (for noteSequence).
 * Non-sharps first, then sharps.
 */
export const PAIRED_INTRODUCTION_ORDER = [
  // Non-sharps (well separated)
  { note: "C4", family: "C" },
  { note: "A4", family: "A" },
  { note: "F4", family: "F" },
  { note: "D4", family: "D" },
  { note: "G4", family: "G" },
  { note: "B4", family: "B" },
  { note: "E4", family: "E" },
  // Sharps
  { note: "C#4", family: "C#" },
  { note: "F#4", family: "F#" },
  { note: "D#4", family: "D#" },
  { note: "G#4", family: "G#" },
  { note: "A#4", family: "A#" },
];

/**
 * Introduction order for octave 3 and 5 octaveId cards (after all octave 4 notes are introduced).
 * Note sequences are already introduced via paired introduction.
 */
export const OCTAVE_3_INTRODUCTION_ORDER = [
  // Non-sharps
  "C3",
  "A3",
  "F3",
  "D3",
  "G3",
  "B3",
  "E3",
  // Sharps
  "C#3",
  "F#3",
  "D#3",
  "G#3",
  "A#3",
];

export const OCTAVE_5_INTRODUCTION_ORDER = [
  // Non-sharps
  "C5",
  "A5",
  "F5",
  "D5",
  "G5",
  "B5",
  "E5",
  // Sharps
  "C#5",
  "F#5",
  "D#5",
  "G#5",
  "A#5",
];

const STORAGE_KEY = "ear-trainer:note-id-memory-v1";

const deck = createDeck();

/**
 * Extract note family from full note (e.g., "A4" → "A", "C#3" → "C#")
 */
export function getNoteFamily(note: string): string {
  return note.replace(/\d+$/, "");
}

/**
 * Extract octave from full note (e.g., "A4" → 4)
 */
export function getOctave(note: string): number {
  const match = note.match(/(\d)$/);
  return match ? parseInt(match[1], 10) : 4;
}

/**
 * Get the frequency for a note.
 */
export function getFrequencyForNote(note: string): number {
  return Math.round(NOTE_FREQUENCIES[note] ?? 0);
}

function createInitialState(): NoteIdMemoryState {
  const cards: NoteIdCard[] = [];

  // Create octaveId cards for all 36 notes
  for (const note of ALL_NOTES) {
    cards.push({
      id: `octaveId:${note}`,
      questionType: "octaveId",
      note,
      card: null,
      lastReviewedAt: null,
      reviewCount: 0,
      retired: false,
    });
  }

  // Create noteSequence cards for all 12 note families
  for (const family of NOTE_NAMES) {
    cards.push({
      id: `noteSequence:${family}`,
      questionType: "noteSequence",
      noteFamily: family,
      card: null,
      lastReviewedAt: null,
      reviewCount: 0,
      retired: false,
    });
  }

  // Create fullNote cards for all 36 notes
  for (const note of ALL_NOTES) {
    cards.push({
      id: `fullNote:${note}`,
      questionType: "fullNote",
      note,
      card: null,
      lastReviewedAt: null,
      reviewCount: 0,
      retired: false,
    });
  }

  return {
    cards,
    history: [],
    sessionCount: 0,
  };
}

export function loadState(): NoteIdMemoryState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.cards && parsed.history !== undefined) {
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return createInitialState();
}

export function saveState(state: NoteIdMemoryState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable
  }
}

function daysSinceReview(card: NoteIdCard): number {
  if (!card.lastReviewedAt) return Infinity;
  return (Date.now() - card.lastReviewedAt) / (1000 * 60 * 60 * 24);
}

/**
 * Check if a card is reliably learned (retrievability > 0.9 tomorrow).
 */
export function isReliablyLearned(
  state: NoteIdMemoryState,
  cardId: string
): boolean {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card?.card || !card.lastReviewedAt) return false;
  const days = daysSinceReview(card);
  return deck.getRetrievability(card.card, days + 1) > 0.9;
}

/**
 * Check if a full note card can be introduced (prerequisites met).
 */
export function canIntroduceFullNote(
  state: NoteIdMemoryState,
  note: string
): boolean {
  const family = getNoteFamily(note);
  const octaveIdReliable = isReliablyLearned(state, `octaveId:${note}`);
  const noteSeqReliable = isReliablyLearned(state, `noteSequence:${family}`);
  return octaveIdReliable && noteSeqReliable;
}

/**
 * Check and apply retirements based on full note mastery.
 */
export function checkRetirements(state: NoteIdMemoryState): NoteIdMemoryState {
  const updatedCards = state.cards.map((card) => {
    if (card.retired) return card;

    if (card.questionType === "octaveId" && card.note) {
      // Retire octaveId when fullNote for same note is reliably learned
      if (isReliablyLearned(state, `fullNote:${card.note}`)) {
        return { ...card, retired: true };
      }
    }

    if (card.questionType === "noteSequence" && card.noteFamily) {
      // Retire noteSequence when all 3 fullNotes in family are reliably learned
      const allFullNotesLearned = OCTAVES.every((octave) => {
        const fullNoteId = `fullNote:${card.noteFamily}${octave}`;
        return isReliablyLearned(state, fullNoteId);
      });
      if (allFullNotesLearned) {
        return { ...card, retired: true };
      }
    }

    return card;
  });

  return { ...state, cards: updatedCards };
}

/**
 * Get cards that have been introduced (have card state).
 */
export function getIntroducedCards(state: NoteIdMemoryState): NoteIdCard[] {
  return state.cards.filter((c) => c.card !== null);
}

/**
 * Get cards that are due for review (introduced, not retired, sorted by urgency).
 */
export function getDueCards(state: NoteIdMemoryState): NoteIdCard[] {
  return state.cards
    .filter((c) => c.card !== null && !c.retired && c.lastReviewedAt !== null)
    .sort((a, b) => {
      const daysA = daysSinceReview(a);
      const daysB = daysSinceReview(b);
      const rA = a.card ? deck.getRetrievability(a.card, daysA) : 1;
      const rB = b.card ? deck.getRetrievability(b.card, daysB) : 1;
      return rA - rB; // Lower retrievability = more urgent
    });
}

/**
 * Get the next pair of octaveId + noteSequence cards to introduce.
 * Returns null if all paired cards are introduced.
 */
function getNextPairedIntroduction(
  state: NoteIdMemoryState
): { octaveIdCardId: string; noteSeqCardId: string } | null {
  for (const pair of PAIRED_INTRODUCTION_ORDER) {
    const octaveIdCard = state.cards.find(
      (c) => c.id === `octaveId:${pair.note}`
    );
    const noteSeqCard = state.cards.find(
      (c) => c.id === `noteSequence:${pair.family}`
    );

    // If both are not yet introduced, return this pair
    if (octaveIdCard?.card === null || noteSeqCard?.card === null) {
      return {
        octaveIdCardId: `octaveId:${pair.note}`,
        noteSeqCardId: `noteSequence:${pair.family}`,
      };
    }
  }
  return null;
}

/**
 * Get the next octave 3 or 5 octaveId card to introduce.
 * Returns null if all are introduced.
 */
function getNextOctaveIdIntroduction(state: NoteIdMemoryState): string | null {
  // First all octave 3, then all octave 5
  for (const note of OCTAVE_3_INTRODUCTION_ORDER) {
    const card = state.cards.find((c) => c.id === `octaveId:${note}`);
    if (card?.card === null) {
      return `octaveId:${note}`;
    }
  }
  for (const note of OCTAVE_5_INTRODUCTION_ORDER) {
    const card = state.cards.find((c) => c.id === `octaveId:${note}`);
    if (card?.card === null) {
      return `octaveId:${note}`;
    }
  }
  return null;
}

/**
 * Get full note cards that can be introduced (prerequisites met, not yet introduced).
 */
function getIntroducibleFullNotes(state: NoteIdMemoryState): string[] {
  const result: string[] = [];
  for (const note of ALL_NOTES) {
    const card = state.cards.find((c) => c.id === `fullNote:${note}`);
    if (card?.card === null && canIntroduceFullNote(state, note)) {
      result.push(`fullNote:${note}`);
    }
  }
  return result;
}

export interface SessionCards {
  newCards: NoteIdCard[];
  reviewCards: NoteIdCard[];
  isFirstSession: boolean;
  allIntroduced: boolean;
}

const MAX_SESSION_CARDS = 10;
const MAX_NEW_CARDS_PER_SESSION = 4;

/**
 * Select cards for a session: mix of review cards and new introductions.
 */
export function selectSessionCards(state: NoteIdMemoryState): SessionCards {
  // Apply retirements first
  state = checkRetirements(state);

  const introducedCards = getIntroducedCards(state).filter((c) => !c.retired);
  const isFirstSession = introducedCards.length === 0;

  // Get due review cards
  const dueCards = getDueCards(state);

  // Determine new cards to introduce
  const newCardIds: string[] = [];

  // First: try to introduce paired octaveId + noteSequence
  const nextPair = getNextPairedIntroduction(state);
  if (nextPair && newCardIds.length < MAX_NEW_CARDS_PER_SESSION) {
    // Add octaveId if not introduced
    const octaveCard = state.cards.find((c) => c.id === nextPair.octaveIdCardId);
    if (octaveCard?.card === null) {
      newCardIds.push(nextPair.octaveIdCardId);
    }
    // Add noteSequence if not introduced
    const noteSeqCard = state.cards.find(
      (c) => c.id === nextPair.noteSeqCardId
    );
    if (noteSeqCard?.card === null) {
      newCardIds.push(nextPair.noteSeqCardId);
    }
  }

  // Second: try to introduce octave 3/5 octaveId cards
  if (newCardIds.length < MAX_NEW_CARDS_PER_SESSION && !nextPair) {
    const nextOctaveId = getNextOctaveIdIntroduction(state);
    if (nextOctaveId) {
      newCardIds.push(nextOctaveId);
    }
  }

  // Third: introduce eligible fullNote cards
  const introducibleFullNotes = getIntroducibleFullNotes(state);
  for (const cardId of introducibleFullNotes) {
    if (newCardIds.length >= MAX_NEW_CARDS_PER_SESSION) break;
    newCardIds.push(cardId);
  }

  // Convert IDs to cards
  const newCards = newCardIds
    .map((id) => state.cards.find((c) => c.id === id))
    .filter((c): c is NoteIdCard => c !== undefined);

  // Calculate how many review cards to include
  const reviewCount = Math.max(0, MAX_SESSION_CARDS - newCards.length);
  const reviewCards = dueCards
    .filter((c) => !newCardIds.includes(c.id))
    .slice(0, reviewCount);

  // Check if all cards are introduced
  const allOctaveIdsIntroduced = ALL_NOTES.every((note) => {
    const card = state.cards.find((c) => c.id === `octaveId:${note}`);
    return card?.card !== null;
  });
  const allNoteSeqsIntroduced = NOTE_NAMES.every((family) => {
    const card = state.cards.find((c) => c.id === `noteSequence:${family}`);
    return card?.card !== null;
  });
  const allFullNotesIntroduced = ALL_NOTES.every((note) => {
    const card = state.cards.find((c) => c.id === `fullNote:${note}`);
    return card?.card !== null;
  });
  const allIntroduced =
    allOctaveIdsIntroduced && allNoteSeqsIntroduced && allFullNotesIntroduced;

  return {
    newCards,
    reviewCards,
    isFirstSession,
    allIntroduced,
  };
}

export interface ReviewData {
  guessHistory?: (string | number)[];
  timeMs?: number;
  replayTimesMs?: number[];
}

/**
 * Record a review for a card.
 */
export function recordReview(
  state: NoteIdMemoryState,
  cardId: string,
  grade: Grade,
  data: ReviewData = {}
): NoteIdMemoryState {
  const now = Date.now();
  const cardIndex = state.cards.findIndex((c) => c.id === cardId);

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

  const newHistory: NoteIdReviewRecord = {
    cardId,
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
  state: NoteIdMemoryState
): NoteIdMemoryState {
  return {
    ...state,
    sessionCount: state.sessionCount + 1,
  };
}

export function getStats(state: NoteIdMemoryState): {
  introducedOctaveId: number;
  introducedNoteSequence: number;
  introducedFullNote: number;
  retiredCards: number;
  totalCards: number;
  sessionsCompleted: number;
  totalReviews: number;
} {
  const octaveIdIntroduced = state.cards.filter(
    (c) => c.questionType === "octaveId" && c.card !== null
  ).length;
  const noteSeqIntroduced = state.cards.filter(
    (c) => c.questionType === "noteSequence" && c.card !== null
  ).length;
  const fullNoteIntroduced = state.cards.filter(
    (c) => c.questionType === "fullNote" && c.card !== null
  ).length;
  const retiredCount = state.cards.filter((c) => c.retired).length;

  return {
    introducedOctaveId: octaveIdIntroduced,
    introducedNoteSequence: noteSeqIntroduced,
    introducedFullNote: fullNoteIntroduced,
    retiredCards: retiredCount,
    totalCards: state.cards.length,
    sessionsCompleted: state.sessionCount,
    totalReviews: state.history.length,
  };
}

/**
 * Get nearby note families for choice generation (sorted chromatically).
 */
export function getNearbyFamilies(
  targetFamily: string,
  count: number = 4,
  allowedFamilies?: string[]
): string[] {
  const targetIndex = NOTE_NAMES.indexOf(targetFamily);
  if (targetIndex === -1) return [targetFamily];

  const allowedSet = allowedFamilies
    ? new Set([...allowedFamilies, targetFamily])
    : null;

  const choices = [targetFamily];
  let offset = 1;

  while (choices.length < count && offset < NOTE_NAMES.length) {
    const rightIdx = (targetIndex + offset) % NOTE_NAMES.length;
    if (!allowedSet || allowedSet.has(NOTE_NAMES[rightIdx])) {
      choices.push(NOTE_NAMES[rightIdx]);
    }

    if (choices.length < count) {
      const leftIdx =
        (targetIndex - offset + NOTE_NAMES.length) % NOTE_NAMES.length;
      if (!allowedSet || allowedSet.has(NOTE_NAMES[leftIdx])) {
        choices.push(NOTE_NAMES[leftIdx]);
      }
    }
    offset++;
  }

  // Sort by chromatic order
  return choices.sort(
    (a, b) => NOTE_NAMES.indexOf(a) - NOTE_NAMES.indexOf(b)
  );
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
  const octaveNotes = ALL_NOTES.filter((n) => getOctave(n) === octave);
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
 * Get introduced note families (noteSequence cards with state).
 */
export function getIntroducedFamilies(state: NoteIdMemoryState): string[] {
  return state.cards
    .filter((c) => c.questionType === "noteSequence" && c.card !== null)
    .map((c) => c.noteFamily!)
    .filter((f) => f !== undefined);
}

/**
 * Get introduced notes for a specific question type.
 */
export function getIntroducedNotesForType(
  state: NoteIdMemoryState,
  questionType: "octaveId" | "fullNote"
): string[] {
  return state.cards
    .filter((c) => c.questionType === questionType && c.card !== null)
    .map((c) => c.note!)
    .filter((n) => n !== undefined);
}

export function clearAllProgress(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage may be unavailable
  }
}
