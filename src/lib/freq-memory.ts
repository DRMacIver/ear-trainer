/**
 * Frequency Memorization State Management
 *
 * Manages spaced repetition for memorizing frequencies from 100Hz to 1100Hz
 * in 50Hz intervals using FSRS algorithm.
 */

import { Card, Grade, createDeck } from "./fsrs.js";

// All frequencies to learn (21 total)
export const ALL_FREQUENCIES = Array.from(
  { length: 21 },
  (_, i) => 100 + i * 50
);

const STORAGE_KEY = "ear-trainer:freq-memory";

export interface ReviewRecord {
  frequency: number;
  timestamp: number; // Unix timestamp
  grade: Grade;
  wasNew: boolean;
}

export interface FrequencyCard {
  frequency: number;
  card: Card | null; // null = not yet introduced
  lastReviewedAt: number | null; // Unix timestamp
  reviewCount: number;
}

export interface FreqMemoryState {
  cards: FrequencyCard[];
  history: ReviewRecord[];
  sessionCount: number;
}

const deck = createDeck();

function createInitialState(): FreqMemoryState {
  return {
    cards: ALL_FREQUENCIES.map((freq) => ({
      frequency: freq,
      card: null,
      lastReviewedAt: null,
      reviewCount: 0,
    })),
    history: [],
    sessionCount: 0,
  };
}

export function loadState(): FreqMemoryState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate structure
      if (parsed.cards && parsed.history !== undefined) {
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return createInitialState();
}

export function saveState(state: FreqMemoryState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable
  }
}

/**
 * Get frequencies that have been introduced (have card state).
 */
export function getIntroducedFrequencies(state: FreqMemoryState): number[] {
  return state.cards
    .filter((c) => c.card !== null)
    .map((c) => c.frequency);
}

/**
 * Get frequencies that haven't been introduced yet.
 */
export function getNewFrequencies(state: FreqMemoryState): number[] {
  return state.cards
    .filter((c) => c.card === null)
    .map((c) => c.frequency);
}

/**
 * Get days since last review for a frequency.
 */
function daysSinceReview(card: FrequencyCard): number {
  if (!card.lastReviewedAt) return Infinity;
  const now = Date.now();
  return (now - card.lastReviewedAt) / (1000 * 60 * 60 * 24);
}

/**
 * Get cards that are due for review (retrievability below threshold).
 * Returns sorted by urgency (lowest retrievability first).
 */
export function getDueCards(state: FreqMemoryState): FrequencyCard[] {
  const now = Date.now();
  return state.cards
    .filter((c) => {
      if (!c.card || !c.lastReviewedAt) return false;
      const days = (now - c.lastReviewedAt) / (1000 * 60 * 60 * 24);
      // Due if days >= interval (but we'll include all introduced for flexibility)
      return days >= 0;
    })
    .sort((a, b) => {
      // Sort by retrievability (lowest first = most urgent)
      const daysA = daysSinceReview(a);
      const daysB = daysSinceReview(b);
      const rA = a.card ? deck.getRetrievability(a.card, daysA) : 1;
      const rB = b.card ? deck.getRetrievability(b.card, daysB) : 1;
      return rA - rB;
    });
}

/**
 * Find the best "splitting" frequency for introducing new cards.
 * Returns the most familiar introduced frequency that has uninstructed
 * frequencies on both sides.
 */
function findSplittingFrequency(state: FreqMemoryState): number | null {
  const introduced = new Set(getIntroducedFrequencies(state));
  const newFreqs = new Set(getNewFrequencies(state));

  // Find introduced frequencies that have new frequencies on both sides
  const candidates: { freq: number; familiarity: number }[] = [];

  for (const freq of introduced) {
    const hasNewBelow = ALL_FREQUENCIES.some(
      (f) => f < freq && newFreqs.has(f)
    );
    const hasNewAbove = ALL_FREQUENCIES.some(
      (f) => f > freq && newFreqs.has(f)
    );

    if (hasNewBelow && hasNewAbove) {
      const card = state.cards.find((c) => c.frequency === freq);
      // Familiarity = review count (higher = more familiar)
      candidates.push({
        freq,
        familiarity: card?.reviewCount ?? 0,
      });
    }
  }

  if (candidates.length === 0) return null;

  // Return the most familiar one
  candidates.sort((a, b) => b.familiarity - a.familiarity);
  return candidates[0].freq;
}

/**
 * Find two new frequencies to introduce, one on each side of the splitting freq.
 */
function findNewFrequenciesToIntroduce(
  state: FreqMemoryState,
  splittingFreq: number
): [number, number] | null {
  const newFreqs = getNewFrequencies(state);

  // Find closest new frequency below splitting
  const below = newFreqs
    .filter((f) => f < splittingFreq)
    .sort((a, b) => b - a)[0]; // Highest one below

  // Find closest new frequency above splitting
  const above = newFreqs
    .filter((f) => f > splittingFreq)
    .sort((a, b) => a - b)[0]; // Lowest one above

  if (below === undefined || above === undefined) return null;

  return [below, above];
}

export interface SessionCards {
  newCards: number[]; // Frequencies to introduce
  reviewCards: number[]; // Frequencies to review (includes splitting)
  splittingCard: number | null; // The card between new ones
  isFirstSession: boolean;
  isComplete: boolean; // All cards learned
}

/**
 * Select cards for a session based on the rules:
 * - First session: 100, 550, 1100
 * - Other sessions: 2 new + 3 reviews (one must be splitting)
 * - Final sessions: do best effort
 */
export function selectSessionCards(state: FreqMemoryState): SessionCards {
  const introduced = getIntroducedFrequencies(state);
  const newFreqs = getNewFrequencies(state);

  // Check if complete
  if (newFreqs.length === 0) {
    // All cards introduced, just do reviews
    const dueCards = getDueCards(state);
    const reviewFreqs = dueCards.slice(0, 5).map((c) => c.frequency);
    return {
      newCards: [],
      reviewCards: reviewFreqs,
      splittingCard: null,
      isFirstSession: false,
      isComplete: true,
    };
  }

  // First session: introduce 100, 550, 1100
  if (introduced.length === 0) {
    return {
      newCards: [100, 550, 1100],
      reviewCards: [],
      splittingCard: null,
      isFirstSession: true,
      isComplete: false,
    };
  }

  // Find splitting frequency
  const splittingFreq = findSplittingFrequency(state);

  if (splittingFreq === null) {
    // Can't find a proper split - just introduce remaining and review
    const toIntroduce = newFreqs.slice(0, 2);
    const dueCards = getDueCards(state);
    const reviewFreqs = dueCards
      .filter((c) => !toIntroduce.includes(c.frequency))
      .slice(0, 3)
      .map((c) => c.frequency);

    return {
      newCards: toIntroduce,
      reviewCards: reviewFreqs,
      splittingCard: null,
      isFirstSession: false,
      isComplete: false,
    };
  }

  // Find two new frequencies around the split
  const newPair = findNewFrequenciesToIntroduce(state, splittingFreq);

  if (newPair === null) {
    // Can't find a pair - introduce what we can
    const toIntroduce = newFreqs.slice(0, Math.min(2, newFreqs.length));
    const dueCards = getDueCards(state);
    const reviewFreqs = dueCards
      .filter((c) => !toIntroduce.includes(c.frequency))
      .slice(0, 3)
      .map((c) => c.frequency);

    // Include splitting freq in reviews if possible
    if (!reviewFreqs.includes(splittingFreq)) {
      reviewFreqs.unshift(splittingFreq);
      if (reviewFreqs.length > 3) reviewFreqs.pop();
    }

    return {
      newCards: toIntroduce,
      reviewCards: reviewFreqs,
      splittingCard: splittingFreq,
      isFirstSession: false,
      isComplete: false,
    };
  }

  // Normal session: 2 new cards + 3 reviews
  const [newBelow, newAbove] = newPair;

  // Get other review cards (not the splitting one)
  const dueCards = getDueCards(state);
  const otherReviews = dueCards
    .filter((c) => c.frequency !== splittingFreq)
    .slice(0, 2)
    .map((c) => c.frequency);

  // Ensure we have the splitting card first, then others
  const reviewCards = [splittingFreq, ...otherReviews];

  return {
    newCards: [newBelow, newAbove],
    reviewCards: reviewCards.slice(0, 3),
    splittingCard: splittingFreq,
    isFirstSession: false,
    isComplete: false,
  };
}

/**
 * Record a review result for a frequency.
 */
export function recordReview(
  state: FreqMemoryState,
  frequency: number,
  grade: Grade
): FreqMemoryState {
  const now = Date.now();
  const cardIndex = state.cards.findIndex((c) => c.frequency === frequency);

  if (cardIndex === -1) return state;

  const existingCard = state.cards[cardIndex];
  const wasNew = existingCard.card === null;

  let newCard: Card;
  if (wasNew) {
    // First time seeing this card
    newCard = deck.newCard(grade);
  } else {
    // Review existing card
    const days = daysSinceReview(existingCard);
    newCard = deck.gradeCard(existingCard.card!, days, grade);
  }

  // Update card
  const updatedCards = [...state.cards];
  updatedCards[cardIndex] = {
    ...existingCard,
    card: newCard,
    lastReviewedAt: now,
    reviewCount: existingCard.reviewCount + 1,
  };

  // Add to history
  const newHistory: ReviewRecord = {
    frequency,
    timestamp: now,
    grade,
    wasNew,
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
  state: FreqMemoryState
): FreqMemoryState {
  return {
    ...state,
    sessionCount: state.sessionCount + 1,
  };
}

/**
 * Get statistics about learning progress.
 */
export function getStats(state: FreqMemoryState): {
  introduced: number;
  total: number;
  sessionsCompleted: number;
  totalReviews: number;
} {
  return {
    introduced: getIntroducedFrequencies(state).length,
    total: ALL_FREQUENCIES.length,
    sessionsCompleted: state.sessionCount,
    totalReviews: state.history.length,
  };
}
