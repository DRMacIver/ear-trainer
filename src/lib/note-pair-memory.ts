/**
 * Note Pair Ordering Memory State Management
 *
 * SRS exercise where two notes play in sequence and the user identifies which note came first.
 * Each distinct pair of notes (ignoring octaves and order) generates multiple cards with
 * different octave combinations and orderings.
 */

import { Card, Grade, createDeck } from "./fsrs.js";
import { NOTE_FREQUENCIES } from "../audio.js";

export interface NotePairCard {
  id: string; // e.g., "C4-F3" (first note is what plays first)
  noteA: string; // First note to play, with octave (e.g., "C4")
  noteB: string; // Second note to play, with octave (e.g., "F3")
  pair: string; // Canonical pair name, sorted (e.g., "C-F")
  sameOctave: boolean; // Whether both notes are in the same octave
  card: Card | null; // FSRS state
  lastReviewedAt: number | null;
  reviewCount: number;
}

export interface NotePairReviewRecord {
  cardId: string;
  timestamp: number;
  grade: Grade;
  wasNew: boolean;
  guessHistory?: string[];
  timeMs?: number;
  replayTimesMs?: number[];
}

export interface NotePairMemoryState {
  cards: NotePairCard[];
  history: NotePairReviewRecord[];
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

export const NON_SHARP_NOTES = ["C", "D", "E", "F", "G", "A", "B"];
export const SHARP_NOTES = ["C#", "D#", "F#", "G#", "A#"];
export const OCTAVES = [3, 4, 5];

const STORAGE_KEY = "ear-trainer:note-pair-memory-v1";

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

/**
 * Get canonical pair name (alphabetically sorted by note family).
 */
export function getPairName(noteA: string, noteB: string): string {
  const familyA = getNoteFamily(noteA);
  const familyB = getNoteFamily(noteB);
  const sorted = [familyA, familyB].sort(
    (a, b) => NOTE_NAMES.indexOf(a) - NOTE_NAMES.indexOf(b)
  );
  return sorted.join("-");
}

/**
 * Get the semitone distance between two note families.
 */
export function getSemitoneDistance(familyA: string, familyB: string): number {
  const idxA = NOTE_NAMES.indexOf(familyA);
  const idxB = NOTE_NAMES.indexOf(familyB);
  const diff = Math.abs(idxA - idxB);
  return Math.min(diff, 12 - diff); // Shortest distance around the circle
}

/**
 * Initial well-separated pairs to introduce.
 * Using perfect 4ths and a tritone for maximum distinction.
 */
export const INITIAL_PAIRS: [string, string][] = [
  ["C", "F"], // Perfect 4th (5 semitones)
  ["D", "G"], // Perfect 4th (5 semitones)
  ["E", "A"], // Perfect 4th (5 semitones)
  ["B", "F"], // Tritone (6 semitones - very distinct)
];

/**
 * Generate 6 cards for a pair: 2 same-octave cards (introduced first) and 4 different-octave cards.
 */
export function generateCardsForPair(
  familyA: string,
  familyB: string
): NotePairCard[] {
  const pair = getPairName(`${familyA}4`, `${familyB}4`);

  return [
    // Same-octave cards (introduced first)
    {
      id: `${familyA}4-${familyB}4`,
      noteA: `${familyA}4`,
      noteB: `${familyB}4`,
      pair,
      sameOctave: true,
      card: null,
      lastReviewedAt: null,
      reviewCount: 0,
    },
    {
      id: `${familyB}4-${familyA}4`,
      noteA: `${familyB}4`,
      noteB: `${familyA}4`,
      pair,
      sameOctave: true,
      card: null,
      lastReviewedAt: null,
      reviewCount: 0,
    },
    // Different-octave cards (introduced later)
    {
      id: `${familyA}4-${familyB}3`,
      noteA: `${familyA}4`,
      noteB: `${familyB}3`,
      pair,
      sameOctave: false,
      card: null,
      lastReviewedAt: null,
      reviewCount: 0,
    },
    {
      id: `${familyB}3-${familyA}4`,
      noteA: `${familyB}3`,
      noteB: `${familyA}4`,
      pair,
      sameOctave: false,
      card: null,
      lastReviewedAt: null,
      reviewCount: 0,
    },
    {
      id: `${familyA}3-${familyB}5`,
      noteA: `${familyA}3`,
      noteB: `${familyB}5`,
      pair,
      sameOctave: false,
      card: null,
      lastReviewedAt: null,
      reviewCount: 0,
    },
    {
      id: `${familyB}5-${familyA}3`,
      noteA: `${familyB}5`,
      noteB: `${familyA}3`,
      pair,
      sameOctave: false,
      card: null,
      lastReviewedAt: null,
      reviewCount: 0,
    },
  ];
}

/**
 * Generate all possible pairs between note families.
 * Returns all unique pairs.
 */
export function getAllPossiblePairs(): [string, string][] {
  const pairs: [string, string][] = [];
  const seenPairs = new Set<string>();

  for (let i = 0; i < NOTE_NAMES.length; i++) {
    for (let j = i + 1; j < NOTE_NAMES.length; j++) {
      const familyA = NOTE_NAMES[i];
      const familyB = NOTE_NAMES[j];
      const pairName = getPairName(`${familyA}4`, `${familyB}4`);

      if (!seenPairs.has(pairName)) {
        seenPairs.add(pairName);
        pairs.push([familyA, familyB]);
      }
    }
  }

  return pairs;
}

function createInitialState(): NotePairMemoryState {
  // Generate cards for all possible pairs
  const cards: NotePairCard[] = [];
  const allPairs = getAllPossiblePairs();

  for (const [familyA, familyB] of allPairs) {
    cards.push(...generateCardsForPair(familyA, familyB));
  }

  return {
    cards,
    history: [],
    sessionCount: 0,
  };
}

export function loadState(): NotePairMemoryState {
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

export function saveState(state: NotePairMemoryState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable
  }
}

function daysSinceReview(card: NotePairCard): number {
  if (!card.lastReviewedAt) return Infinity;
  return (Date.now() - card.lastReviewedAt) / (1000 * 60 * 60 * 24);
}

/**
 * Get retrievability for a card.
 */
export function getRetrievability(card: NotePairCard): number {
  if (!card.card || !card.lastReviewedAt) return 0;
  const days = daysSinceReview(card);
  return deck.getRetrievability(card.card, days);
}

/**
 * Check if a card is reliably learned (retrievability > 0.9 tomorrow).
 */
export function isReliablyLearned(
  state: NotePairMemoryState,
  cardId: string
): boolean {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card?.card || !card.lastReviewedAt) return false;
  const days = daysSinceReview(card);
  return deck.getRetrievability(card.card, days + 1) > 0.9;
}

/**
 * Get cards that have been introduced (have card state).
 */
export function getIntroducedCards(state: NotePairMemoryState): NotePairCard[] {
  return state.cards.filter((c) => c.card !== null);
}

/**
 * Get unique pairs that have been introduced.
 */
export function getIntroducedPairs(state: NotePairMemoryState): Set<string> {
  const pairs = new Set<string>();
  for (const card of state.cards) {
    if (card.card !== null) {
      pairs.add(card.pair);
    }
  }
  return pairs;
}

/**
 * Get all note families that have appeared in introduced pairs.
 */
export function getIntroducedFamilies(state: NotePairMemoryState): Set<string> {
  const families = new Set<string>();
  const introducedPairs = getIntroducedPairs(state);

  for (const pairName of introducedPairs) {
    const [familyA, familyB] = pairName.split("-");
    families.add(familyA);
    families.add(familyB);
  }

  return families;
}

/**
 * Count how many pairs a note family appears in (among introduced pairs).
 */
export function countPairAppearances(
  state: NotePairMemoryState,
  family: string
): number {
  const introducedPairs = getIntroducedPairs(state);
  let count = 0;
  for (const pairName of introducedPairs) {
    if (pairName.includes(family)) {
      count++;
    }
  }
  return count;
}

/**
 * Check if a sharp note can be introduced.
 * A sharp can be introduced when its base note has appeared in 3+ pairs with good performance.
 */
export function canIntroduceSharp(
  state: NotePairMemoryState,
  sharpNote: string
): boolean {
  if (!sharpNote.includes("#")) return false;

  const baseNote = sharpNote.replace("#", "");
  const pairCount = countPairAppearances(state, baseNote);

  if (pairCount < 3) return false;

  // Check that base note has good average retrievability
  const introducedPairs = getIntroducedPairs(state);
  const relevantCards = state.cards.filter(
    (c) =>
      c.card !== null &&
      introducedPairs.has(c.pair) &&
      c.pair.includes(baseNote)
  );

  if (relevantCards.length === 0) return false;

  const avgRetrievability =
    relevantCards.reduce((sum, c) => sum + getRetrievability(c), 0) /
    relevantCards.length;

  return avgRetrievability > 0.7;
}

/**
 * Check if the note-sharp pair is well studied.
 * Required before the sharp can appear in other pairs.
 */
export function isNoteSharpPairWellStudied(
  state: NotePairMemoryState,
  sharpNote: string
): boolean {
  const baseNote = sharpNote.replace("#", "");
  const pairName = getPairName(`${baseNote}4`, `${sharpNote}4`);

  // Get all cards for this pair
  const pairCards = state.cards.filter((c) => c.pair === pairName);

  // Check if all cards have retrievability > 0.8
  for (const card of pairCards) {
    if (!card.card || !card.lastReviewedAt) return false;
    if (getRetrievability(card) < 0.8) return false;
  }

  return true;
}

/**
 * Check if a sharp is ready to appear in non-base pairs.
 */
export function isSharpReadyForOtherPairs(
  state: NotePairMemoryState,
  sharpNote: string
): boolean {
  return (
    canIntroduceSharp(state, sharpNote) &&
    isNoteSharpPairWellStudied(state, sharpNote)
  );
}

/**
 * Check if same-octave cards for a pair are well-learned.
 * Required before different-octave cards can be introduced.
 */
export function areSameOctaveCardsWellLearned(
  state: NotePairMemoryState,
  pairName: string
): boolean {
  const sameOctaveCards = state.cards.filter(
    (c) => c.pair === pairName && c.sameOctave
  );

  // All same-octave cards must be introduced and have high retrievability
  for (const card of sameOctaveCards) {
    if (!card.card || !card.lastReviewedAt) return false;
    if (getRetrievability(card) < 0.8) return false;
  }

  return sameOctaveCards.length > 0;
}

/**
 * Get different-octave cards that are ready to be introduced.
 * A pair's different-octave cards are ready when its same-octave cards are well-learned.
 */
export function getReadyDifferentOctaveCards(
  state: NotePairMemoryState
): NotePairCard[] {
  const introducedPairs = getIntroducedPairs(state);
  const readyCards: NotePairCard[] = [];

  for (const pairName of introducedPairs) {
    if (areSameOctaveCardsWellLearned(state, pairName)) {
      // Find unintroduced different-octave cards for this pair
      const diffOctaveCards = state.cards.filter(
        (c) => c.pair === pairName && !c.sameOctave && c.card === null
      );
      readyCards.push(...diffOctaveCards);
    }
  }

  return readyCards;
}

/**
 * Get cards that are due for review (introduced, sorted by urgency).
 */
export function getDueCards(state: NotePairMemoryState): NotePairCard[] {
  return state.cards
    .filter((c) => c.card !== null && c.lastReviewedAt !== null)
    .sort((a, b) => {
      const rA = getRetrievability(a);
      const rB = getRetrievability(b);
      return rA - rB; // Lower retrievability = more urgent
    });
}

/**
 * Select the next pair to introduce based on rules.
 */
export function selectNextPairToIntroduce(
  state: NotePairMemoryState
): [string, string] | null {
  const introducedPairs = getIntroducedPairs(state);
  const introducedFamilies = getIntroducedFamilies(state);

  // First: try initial pairs
  for (const [familyA, familyB] of INITIAL_PAIRS) {
    const pairName = getPairName(`${familyA}4`, `${familyB}4`);
    if (!introducedPairs.has(pairName)) {
      return [familyA, familyB];
    }
  }

  // Second: check if any sharps can be introduced (note-sharp pairs first)
  for (const sharpNote of SHARP_NOTES) {
    const baseNote = sharpNote.replace("#", "");

    // Check if sharp's note-base pair can be introduced
    if (canIntroduceSharp(state, sharpNote)) {
      const pairName = getPairName(`${baseNote}4`, `${sharpNote}4`);
      if (!introducedPairs.has(pairName)) {
        return [baseNote, sharpNote];
      }
    }

    // Check if sharp is ready for other pairs
    if (isSharpReadyForOtherPairs(state, sharpNote)) {
      // Find a pair with another introduced family
      for (const otherFamily of introducedFamilies) {
        if (otherFamily === baseNote || otherFamily === sharpNote) continue;
        const pairName = getPairName(`${otherFamily}4`, `${sharpNote}4`);
        if (!introducedPairs.has(pairName)) {
          // Prefer pairs with good separation
          if (getSemitoneDistance(otherFamily, sharpNote) >= 3) {
            return [otherFamily, sharpNote];
          }
        }
      }
    }
  }

  // Third: introduce new non-sharp pairs
  // Prioritize notes with fewer pair appearances
  const allNonSharpPairs: [string, string][] = [];
  for (let i = 0; i < NON_SHARP_NOTES.length; i++) {
    for (let j = i + 1; j < NON_SHARP_NOTES.length; j++) {
      const familyA = NON_SHARP_NOTES[i];
      const familyB = NON_SHARP_NOTES[j];
      const pairName = getPairName(`${familyA}4`, `${familyB}4`);

      if (!introducedPairs.has(pairName)) {
        allNonSharpPairs.push([familyA, familyB]);
      }
    }
  }

  // Sort by preference: well-separated, notes with fewer appearances
  allNonSharpPairs.sort((pairA, pairB) => {
    const [a1, a2] = pairA;
    const [b1, b2] = pairB;

    // Prefer pairs with better separation
    const sepA = getSemitoneDistance(a1, a2);
    const sepB = getSemitoneDistance(b1, b2);
    if (sepA !== sepB) return sepB - sepA;

    // Prefer notes with fewer appearances
    const countA =
      countPairAppearances(state, a1) + countPairAppearances(state, a2);
    const countB =
      countPairAppearances(state, b1) + countPairAppearances(state, b2);
    return countA - countB;
  });

  if (allNonSharpPairs.length > 0) {
    return allNonSharpPairs[0];
  }

  // Fourth: any remaining sharp pairs
  const allPairs = getAllPossiblePairs();
  for (const [familyA, familyB] of allPairs) {
    const pairName = getPairName(`${familyA}4`, `${familyB}4`);
    if (!introducedPairs.has(pairName)) {
      // Check if this pair can be introduced
      const hasSharpA = familyA.includes("#");
      const hasSharpB = familyB.includes("#");

      if (hasSharpA && !isSharpReadyForOtherPairs(state, familyA)) continue;
      if (hasSharpB && !isSharpReadyForOtherPairs(state, familyB)) continue;

      return [familyA, familyB];
    }
  }

  return null;
}

export interface SessionCards {
  newCards: NotePairCard[];
  reviewCards: NotePairCard[];
  isFirstSession: boolean;
  allIntroduced: boolean;
}

const MAX_SESSION_CARDS = 10;
const MIN_SESSION_CARDS = 6;
const MAX_NEW_CARDS_PER_SESSION = 4;

/**
 * Check if we need to introduce new cards.
 */
function needsNewCards(state: NotePairMemoryState): boolean {
  const dueCards = getDueCards(state);

  // If we have few due cards, introduce more
  if (dueCards.length < MIN_SESSION_CARDS) {
    return true;
  }

  // If all due cards have high retrievability, introduce more
  const allHighRetrievability = dueCards.every(
    (c) => getRetrievability(c) > 0.9
  );
  if (allHighRetrievability) {
    return true;
  }

  return false;
}

/**
 * Select cards for a session.
 */
export function selectSessionCards(state: NotePairMemoryState): SessionCards {
  const introducedCards = getIntroducedCards(state);
  const isFirstSession = introducedCards.length === 0;

  const newCards: NotePairCard[] = [];

  // For first session, introduce same-octave cards for first 2 pairs
  if (isFirstSession) {
    for (let i = 0; i < 2 && i < INITIAL_PAIRS.length; i++) {
      const [familyA, familyB] = INITIAL_PAIRS[i];
      const pairName = getPairName(`${familyA}4`, `${familyB}4`);
      // Only same-octave cards for first session
      const sameOctaveCards = state.cards.filter(
        (c) => c.pair === pairName && c.sameOctave
      );
      newCards.push(...sameOctaveCards);
    }
  } else if (needsNewCards(state)) {
    // First: try to introduce different-octave cards for well-learned pairs
    const readyDiffOctave = getReadyDifferentOctaveCards(state);
    if (
      readyDiffOctave.length > 0 &&
      newCards.length < MAX_NEW_CARDS_PER_SESSION
    ) {
      // Introduce different-octave cards for one pair at a time
      const firstPair = readyDiffOctave[0].pair;
      const pairDiffCards = readyDiffOctave.filter((c) => c.pair === firstPair);
      newCards.push(...pairDiffCards.slice(0, MAX_NEW_CARDS_PER_SESSION));
    }

    // Second: if still need cards, introduce same-octave cards for a new pair
    if (newCards.length < MAX_NEW_CARDS_PER_SESSION) {
      const nextPair = selectNextPairToIntroduce(state);
      if (nextPair) {
        const [familyA, familyB] = nextPair;
        const pairName = getPairName(`${familyA}4`, `${familyB}4`);
        // Only same-octave cards for new pairs
        const sameOctaveCards = state.cards.filter(
          (c) => c.pair === pairName && c.sameOctave && c.card === null
        );
        newCards.push(...sameOctaveCards);
      }
    }
  }

  // Get due review cards
  const dueCards = getDueCards(state);
  const reviewCount = Math.max(0, MAX_SESSION_CARDS - newCards.length);
  const reviewCards = dueCards
    .filter((c) => !newCards.some((n) => n.id === c.id))
    .slice(0, reviewCount);

  // Check if all cards are introduced
  const allIntroduced = state.cards.every((c) => c.card !== null);

  return {
    newCards,
    reviewCards,
    isFirstSession,
    allIntroduced,
  };
}

export interface ReviewData {
  guessHistory?: string[];
  timeMs?: number;
  replayTimesMs?: number[];
}

/**
 * Record a review for a card.
 */
export function recordReview(
  state: NotePairMemoryState,
  cardId: string,
  grade: Grade,
  data: ReviewData = {}
): NotePairMemoryState {
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

  const newHistory: NotePairReviewRecord = {
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
  state: NotePairMemoryState
): NotePairMemoryState {
  return {
    ...state,
    sessionCount: state.sessionCount + 1,
  };
}

export function getStats(state: NotePairMemoryState): {
  introducedPairs: number;
  totalPairs: number;
  introducedCards: number;
  totalCards: number;
  sessionsCompleted: number;
  totalReviews: number;
} {
  const introducedPairs = getIntroducedPairs(state).size;
  const allPairs = getAllPossiblePairs();
  const introducedCardCount = state.cards.filter((c) => c.card !== null).length;

  return {
    introducedPairs,
    totalPairs: allPairs.length,
    introducedCards: introducedCardCount,
    totalCards: state.cards.length,
    sessionsCompleted: state.sessionCount,
    totalReviews: state.history.length,
  };
}

export function clearAllProgress(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage may be unavailable
  }
}
