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
  guessHistory?: number[]; // Wrong guesses before correct answer (empty = first try)
  timeMs?: number; // Time taken in ms (excluding time tabbed away)
  replayTimesMs?: number[]; // Times replay was pressed (ms from start, excluding tabbed time)
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
 * Select 3 well-separated cards most in need of review.
 * "Well separated" means we try to spread them across the frequency range.
 */
function selectWellSeparatedUrgentCards(
  state: FreqMemoryState
): FrequencyCard[] {
  const dueCards = getDueCards(state);
  if (dueCards.length < 3) return dueCards;

  // Divide the frequency range into 3 regions
  const minFreq = ALL_FREQUENCIES[0];
  const maxFreq = ALL_FREQUENCIES[ALL_FREQUENCIES.length - 1];
  const range = maxFreq - minFreq;
  const regionSize = range / 3;

  const regions = [
    { min: minFreq, max: minFreq + regionSize },
    { min: minFreq + regionSize, max: minFreq + 2 * regionSize },
    { min: minFreq + 2 * regionSize, max: maxFreq + 1 },
  ];

  // Pick the most urgent card from each region
  const selected: FrequencyCard[] = [];
  for (const region of regions) {
    const inRegion = dueCards.filter(
      (c) => c.frequency >= region.min && c.frequency < region.max
    );
    // Find most urgent in this region that isn't already selected
    const candidate = inRegion.find(
      (c) => !selected.some((s) => s.frequency === c.frequency)
    );
    if (candidate) {
      selected.push(candidate);
    }
  }

  // If we don't have 3, fill from most urgent overall
  for (const card of dueCards) {
    if (selected.length >= 3) break;
    if (!selected.some((s) => s.frequency === card.frequency)) {
      selected.push(card);
    }
  }

  return selected;
}

/**
 * Find familiar cards in a gap between two frequencies.
 * Returns cards sorted by familiarity (most familiar first).
 */
function getFamiliarCardsInGap(
  state: FreqMemoryState,
  lowFreq: number,
  highFreq: number,
  exclude: number[]
): FrequencyCard[] {
  return state.cards
    .filter(
      (c) =>
        c.card !== null &&
        c.frequency > lowFreq &&
        c.frequency < highFreq &&
        !exclude.includes(c.frequency)
    )
    .sort((a, b) => b.reviewCount - a.reviewCount); // Most familiar first
}

/**
 * Select session cards for review-only mode (all or nearly all introduced).
 * Picks 3 well-separated urgent cards, then fills gaps with familiar pairs.
 */
function selectReviewSessionCards(state: FreqMemoryState): number[] {
  const anchors = selectWellSeparatedUrgentCards(state);
  const anchorFreqs = anchors.map((c) => c.frequency).sort((a, b) => a - b);

  if (anchorFreqs.length < 3) {
    // Not enough cards, just return what we have
    return anchorFreqs;
  }

  const result: number[] = [];
  const used = new Set(anchorFreqs);

  // For each gap between anchors, pick a familiar pair
  const gaps = [
    { low: ALL_FREQUENCIES[0] - 1, high: anchorFreqs[0] },
    { low: anchorFreqs[0], high: anchorFreqs[1] },
    { low: anchorFreqs[1], high: anchorFreqs[2] },
    { low: anchorFreqs[2], high: ALL_FREQUENCIES[ALL_FREQUENCIES.length - 1] + 1 },
  ];

  // Interleave: anchor, filler, anchor, filler, anchor, fillers
  // But we want: pick pairs in gaps between the 3 anchors
  // Let's pick 1 from each of the 2 middle gaps (between anchor pairs)

  for (let i = 1; i <= 2; i++) {
    const gap = gaps[i];
    const familiar = getFamiliarCardsInGap(
      state,
      gap.low,
      gap.high,
      Array.from(used)
    );
    // Pick up to 1 from this gap
    if (familiar.length > 0) {
      result.push(familiar[0].frequency);
      used.add(familiar[0].frequency);
    }
  }

  // Build final order: interleave anchors and fillers
  // anchor[0], filler[0], anchor[1], filler[1], anchor[2]
  const finalOrder: number[] = [];
  finalOrder.push(anchorFreqs[0]);
  if (result[0]) finalOrder.push(result[0]);
  finalOrder.push(anchorFreqs[1]);
  if (result[1]) finalOrder.push(result[1]);
  finalOrder.push(anchorFreqs[2]);

  return finalOrder;
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
 * Find the best new frequency to introduce in a gap between two introduced frequencies.
 * Prefers frequencies near the midpoint, avoiding those within 50Hz of familiar notes.
 */
function findBestNewFreqInGap(
  newFreqs: number[],
  introducedFreqs: number[],
  lowBound: number,
  highBound: number
): number | null {
  // Find new frequencies in this gap
  const candidates = newFreqs.filter((f) => f > lowBound && f < highBound);
  if (candidates.length === 0) return null;

  const midpoint = (lowBound + highBound) / 2;

  // Sort by distance from midpoint
  candidates.sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint));

  // Try to find one that's not within 50Hz of any introduced frequency
  for (const candidate of candidates) {
    const tooClose = introducedFreqs.some(
      (f) => Math.abs(f - candidate) <= 50
    );
    if (!tooClose) return candidate;
  }

  // If all are too close, just return the one nearest the midpoint
  return candidates[0];
}

/**
 * Find two new frequencies to introduce, one on each side of the splitting freq.
 * Tries to pick frequencies near the midpoint of gaps, avoiding those within 50Hz
 * of already-introduced frequencies.
 */
function findNewFrequenciesToIntroduce(
  state: FreqMemoryState,
  splittingFreq: number
): [number, number] | null {
  const newFreqs = getNewFrequencies(state);
  const introduced = getIntroducedFrequencies(state);

  // Find the bounds for the gaps on each side of splitting
  // Below: from the next introduced freq below splitting, to splitting
  const introducedBelow = introduced
    .filter((f) => f < splittingFreq)
    .sort((a, b) => b - a); // Descending
  const lowerBound = introducedBelow[0] ?? ALL_FREQUENCIES[0];

  // Above: from splitting to the next introduced freq above
  const introducedAbove = introduced
    .filter((f) => f > splittingFreq)
    .sort((a, b) => a - b); // Ascending
  const upperBound =
    introducedAbove[0] ?? ALL_FREQUENCIES[ALL_FREQUENCIES.length - 1];

  // Find best new frequency in each gap
  const below = findBestNewFreqInGap(
    newFreqs,
    introduced,
    lowerBound,
    splittingFreq
  );
  const above = findBestNewFreqInGap(
    newFreqs,
    introduced,
    splittingFreq,
    upperBound
  );

  if (below === null || above === null) return null;

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

  // Check if complete or nearly complete (0 or 1 new cards left)
  if (newFreqs.length <= 1) {
    // Use well-separated anchors + familiar fillers strategy
    const reviewFreqs = selectReviewSessionCards(state);

    // If there's one new card left, add it to the session
    const newCards = newFreqs.length === 1 ? [newFreqs[0]] : [];

    return {
      newCards,
      reviewCards: reviewFreqs,
      splittingCard: null,
      isFirstSession: false,
      isComplete: newFreqs.length === 0,
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

export interface ReviewData {
  guessHistory?: number[];
  timeMs?: number;
  replayTimesMs?: number[];
}

/**
 * Record a review result for a frequency.
 */
export function recordReview(
  state: FreqMemoryState,
  frequency: number,
  grade: Grade,
  data: ReviewData = {}
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
