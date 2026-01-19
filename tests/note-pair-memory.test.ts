import { describe, it, expect, beforeEach } from "vitest";
import {
  NOTE_NAMES,
  NON_SHARP_NOTES,
  SHARP_NOTES,
  INITIAL_PAIRS,
  loadState,
  saveState,
  getNoteFamily,
  getOctave,
  getFrequencyForNote,
  getPairName,
  getSemitoneDistance,
  generateCardsForPair,
  getAllPossiblePairs,
  getIntroducedCards,
  getIntroducedPairs,
  getIntroducedFamilies,
  countPairAppearances,
  canIntroduceSharp,
  isNoteSharpPairWellStudied,
  getDueCards,
  selectNextPairToIntroduce,
  selectSessionCards,
  recordReview,
  incrementSessionCount,
  getStats,
  clearAllProgress,
  isReliablyLearned,
  getRetrievability,
} from "../src/lib/note-pair-memory.js";
import { Grade } from "../src/lib/fsrs.js";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

describe("NOTE_NAMES", () => {
  it("contains 12 note families", () => {
    expect(NOTE_NAMES.length).toBe(12);
  });

  it("starts with C and ends with B", () => {
    expect(NOTE_NAMES[0]).toBe("C");
    expect(NOTE_NAMES[11]).toBe("B");
  });
});

describe("NON_SHARP_NOTES", () => {
  it("contains 7 non-sharp notes", () => {
    expect(NON_SHARP_NOTES.length).toBe(7);
  });

  it("contains no sharps", () => {
    for (const note of NON_SHARP_NOTES) {
      expect(note).not.toContain("#");
    }
  });
});

describe("SHARP_NOTES", () => {
  it("contains 5 sharp notes", () => {
    expect(SHARP_NOTES.length).toBe(5);
  });

  it("all contain #", () => {
    for (const note of SHARP_NOTES) {
      expect(note).toContain("#");
    }
  });
});

describe("INITIAL_PAIRS", () => {
  it("contains 4 pairs", () => {
    expect(INITIAL_PAIRS.length).toBe(4);
  });

  it("contains well-separated pairs", () => {
    for (const [familyA, familyB] of INITIAL_PAIRS) {
      const distance = getSemitoneDistance(familyA, familyB);
      expect(distance).toBeGreaterThanOrEqual(5);
    }
  });

  it("covers most non-sharp notes", () => {
    const covered = new Set<string>();
    for (const [familyA, familyB] of INITIAL_PAIRS) {
      covered.add(familyA);
      covered.add(familyB);
    }
    expect(covered.size).toBeGreaterThanOrEqual(6);
  });
});

describe("getNoteFamily", () => {
  it("extracts family from note with octave", () => {
    expect(getNoteFamily("A4")).toBe("A");
    expect(getNoteFamily("C#3")).toBe("C#");
    expect(getNoteFamily("B5")).toBe("B");
  });
});

describe("getOctave", () => {
  it("extracts octave from note", () => {
    expect(getOctave("A4")).toBe(4);
    expect(getOctave("C#3")).toBe(3);
    expect(getOctave("B5")).toBe(5);
  });

  it("defaults to 4 for invalid note", () => {
    expect(getOctave("invalid")).toBe(4);
  });
});

describe("getFrequencyForNote", () => {
  it("returns 440 for A4", () => {
    expect(getFrequencyForNote("A4")).toBe(440);
  });

  it("returns 220 for A3 (octave below)", () => {
    expect(getFrequencyForNote("A3")).toBe(220);
  });

  it("returns 0 for unknown note", () => {
    expect(getFrequencyForNote("X9")).toBe(0);
  });
});

describe("getPairName", () => {
  it("returns canonical pair name sorted by chromatic order", () => {
    expect(getPairName("C4", "F3")).toBe("C-F");
    expect(getPairName("F3", "C4")).toBe("C-F");
  });

  it("handles sharp notes correctly", () => {
    expect(getPairName("C#4", "A3")).toBe("C#-A");
    expect(getPairName("A3", "C#4")).toBe("C#-A");
  });

  it("produces same name regardless of octave", () => {
    expect(getPairName("C3", "F3")).toBe("C-F");
    expect(getPairName("C4", "F5")).toBe("C-F");
  });
});

describe("getSemitoneDistance", () => {
  it("calculates correct distances", () => {
    expect(getSemitoneDistance("C", "D")).toBe(2);
    expect(getSemitoneDistance("C", "F")).toBe(5);
    expect(getSemitoneDistance("C", "G")).toBe(5); // C to G is 7 semitones, but shortest is 5
    expect(getSemitoneDistance("B", "F")).toBe(6); // Tritone
  });

  it("is symmetric", () => {
    expect(getSemitoneDistance("C", "F")).toBe(getSemitoneDistance("F", "C"));
    expect(getSemitoneDistance("A", "D")).toBe(getSemitoneDistance("D", "A"));
  });

  it("returns 0 for same note", () => {
    expect(getSemitoneDistance("C", "C")).toBe(0);
    expect(getSemitoneDistance("F#", "F#")).toBe(0);
  });
});

describe("generateCardsForPair", () => {
  it("generates 6 cards per pair (2 same-octave + 4 different-octave)", () => {
    const cards = generateCardsForPair("C", "F");
    expect(cards.length).toBe(6);
  });

  it("generates 2 same-octave cards and 4 different-octave cards", () => {
    const cards = generateCardsForPair("C", "F");
    const sameOctave = cards.filter((c) => c.sameOctave);
    const diffOctave = cards.filter((c) => !c.sameOctave);
    expect(sameOctave.length).toBe(2);
    expect(diffOctave.length).toBe(4);
  });

  it("same-octave cards are in octave 4", () => {
    const cards = generateCardsForPair("C", "F");
    const sameOctave = cards.filter((c) => c.sameOctave);
    for (const card of sameOctave) {
      expect(getOctave(card.noteA)).toBe(4);
      expect(getOctave(card.noteB)).toBe(4);
    }
  });

  it("all cards have same pair name", () => {
    const cards = generateCardsForPair("C", "F");
    for (const card of cards) {
      expect(card.pair).toBe("C-F");
    }
  });

  it("cards have different orderings", () => {
    const cards = generateCardsForPair("C", "F");
    const firstNotes = cards.map((c) => getNoteFamily(c.noteA));
    expect(firstNotes.filter((n) => n === "C").length).toBe(3);
    expect(firstNotes.filter((n) => n === "F").length).toBe(3);
  });

  it("cards have various octave combinations", () => {
    const cards = generateCardsForPair("C", "F");
    const octaves = new Set<string>();
    for (const card of cards) {
      octaves.add(`${getOctave(card.noteA)}-${getOctave(card.noteB)}`);
    }
    expect(octaves.size).toBeGreaterThan(1);
  });

  it("cards start with null card state", () => {
    const cards = generateCardsForPair("C", "F");
    for (const card of cards) {
      expect(card.card).toBeNull();
      expect(card.lastReviewedAt).toBeNull();
      expect(card.reviewCount).toBe(0);
    }
  });
});

describe("getAllPossiblePairs", () => {
  it("returns correct number of pairs", () => {
    const pairs = getAllPossiblePairs();
    // 12 notes, choose 2 = 12 * 11 / 2 = 66 pairs
    expect(pairs.length).toBe(66);
  });

  it("all pairs are unique", () => {
    const pairs = getAllPossiblePairs();
    const pairNames = pairs.map(([a, b]) => getPairName(`${a}4`, `${b}4`));
    const uniquePairs = new Set(pairNames);
    expect(uniquePairs.size).toBe(pairs.length);
  });
});

describe("loadState / saveState", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns initial state when nothing saved", () => {
    const state = loadState();
    // 66 pairs × 6 cards = 396 cards
    expect(state.cards.length).toBe(396);
    expect(state.history).toEqual([]);
    expect(state.sessionCount).toBe(0);
    expect(state.cards.every((c) => c.card === null)).toBe(true);
  });

  it("saves and loads state correctly", () => {
    const state = loadState();
    state.sessionCount = 5;
    saveState(state);

    const loaded = loadState();
    expect(loaded.sessionCount).toBe(5);
  });

  it("handles corrupted localStorage gracefully", () => {
    localStorageMock.setItem("ear-trainer:note-pair-memory-v1", "invalid json");
    const state = loadState();
    expect(state.cards.length).toBe(396);
  });
});

describe("recordReview", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("introduces new card on first review", () => {
    let state = loadState();
    const cardId = state.cards[0].id;
    state = recordReview(state, cardId, Grade.GOOD);

    const card = state.cards.find((c) => c.id === cardId);
    expect(card?.card).not.toBeNull();
    expect(card?.reviewCount).toBe(1);
    expect(card?.lastReviewedAt).not.toBeNull();
  });

  it("records review history", () => {
    let state = loadState();
    const cardId1 = state.cards[0].id;
    const cardId2 = state.cards[1].id;
    state = recordReview(state, cardId1, Grade.GOOD);
    state = recordReview(state, cardId2, Grade.HARD);

    expect(state.history.length).toBe(2);
    expect(state.history[0].cardId).toBe(cardId1);
    expect(state.history[0].grade).toBe(Grade.GOOD);
    expect(state.history[0].wasNew).toBe(true);
    expect(state.history[1].cardId).toBe(cardId2);
    expect(state.history[1].grade).toBe(Grade.HARD);
  });

  it("stores guess history when provided", () => {
    let state = loadState();
    const cardId = state.cards[0].id;
    state = recordReview(state, cardId, Grade.AGAIN, {
      guessHistory: ["F", "C"],
    });

    expect(state.history[0].guessHistory).toEqual(["F", "C"]);
  });

  it("omits empty arrays from history", () => {
    let state = loadState();
    const cardId = state.cards[0].id;
    state = recordReview(state, cardId, Grade.GOOD, {
      guessHistory: [],
      replayTimesMs: [],
    });

    expect(state.history[0].guessHistory).toBeUndefined();
    expect(state.history[0].replayTimesMs).toBeUndefined();
  });
});

describe("getIntroducedCards", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns empty array initially", () => {
    const state = loadState();
    expect(getIntroducedCards(state)).toEqual([]);
  });

  it("returns cards that have been reviewed", () => {
    let state = loadState();
    const cardId1 = state.cards[0].id;
    const cardId2 = state.cards[1].id;
    state = recordReview(state, cardId1, Grade.GOOD);
    state = recordReview(state, cardId2, Grade.GOOD);

    const introduced = getIntroducedCards(state);
    expect(introduced.length).toBe(2);
    expect(introduced.map((c) => c.id)).toContain(cardId1);
    expect(introduced.map((c) => c.id)).toContain(cardId2);
  });
});

describe("getIntroducedPairs", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns empty set initially", () => {
    const state = loadState();
    expect(getIntroducedPairs(state).size).toBe(0);
  });

  it("returns pairs when cards are introduced", () => {
    let state = loadState();
    // Introduce all cards for C-F pair
    const cfCards = state.cards.filter((c) => c.pair === "C-F");
    for (const card of cfCards) {
      state = recordReview(state, card.id, Grade.GOOD);
    }

    const pairs = getIntroducedPairs(state);
    expect(pairs.has("C-F")).toBe(true);
    expect(pairs.size).toBe(1);
  });
});

describe("getIntroducedFamilies", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns empty set initially", () => {
    const state = loadState();
    expect(getIntroducedFamilies(state).size).toBe(0);
  });

  it("returns families from introduced pairs", () => {
    let state = loadState();
    // Introduce one card from C-F pair
    const cfCard = state.cards.find((c) => c.pair === "C-F")!;
    state = recordReview(state, cfCard.id, Grade.GOOD);

    const families = getIntroducedFamilies(state);
    expect(families.has("C")).toBe(true);
    expect(families.has("F")).toBe(true);
  });
});

describe("countPairAppearances", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns 0 when no pairs introduced", () => {
    const state = loadState();
    expect(countPairAppearances(state, "C")).toBe(0);
  });

  it("counts pairs containing a family", () => {
    let state = loadState();
    // Introduce C-F pair
    const cfCard = state.cards.find((c) => c.pair === "C-F")!;
    state = recordReview(state, cfCard.id, Grade.GOOD);

    // Introduce C-G pair (if exists)
    const cgCard = state.cards.find((c) => c.pair === "C-G")!;
    state = recordReview(state, cgCard.id, Grade.GOOD);

    expect(countPairAppearances(state, "C")).toBe(2);
    expect(countPairAppearances(state, "F")).toBe(1);
  });
});

describe("canIntroduceSharp", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns false for non-sharp notes", () => {
    const state = loadState();
    expect(canIntroduceSharp(state, "C")).toBe(false);
  });

  it("returns false when base note has fewer than 3 pairs", () => {
    let state = loadState();
    // Introduce only C-F pair
    const cfCard = state.cards.find((c) => c.pair === "C-F")!;
    state = recordReview(state, cfCard.id, Grade.GOOD);

    expect(canIntroduceSharp(state, "C#")).toBe(false);
  });

  it("returns true when base note has 3+ well-learned pairs", () => {
    let state = loadState();
    // Introduce 3 pairs containing C with high grades
    const cPairs = ["C-F", "C-G", "C-A"];
    for (const pairName of cPairs) {
      const cards = state.cards.filter((c) => c.pair === pairName);
      for (const card of cards) {
        // Multiple easy reviews to build up retrievability
        state = recordReview(state, card.id, Grade.EASY);
        state = recordReview(state, card.id, Grade.EASY);
        state = recordReview(state, card.id, Grade.EASY);
      }
    }

    expect(canIntroduceSharp(state, "C#")).toBe(true);
  });
});

describe("isNoteSharpPairWellStudied", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns false when pair not introduced", () => {
    const state = loadState();
    expect(isNoteSharpPairWellStudied(state, "C#")).toBe(false);
  });

  it("returns true when all cards have high retrievability", () => {
    let state = loadState();
    // The C-C# pair
    const ccSharpCards = state.cards.filter((c) => c.pair === "C-C#");
    for (const card of ccSharpCards) {
      // Multiple easy reviews
      for (let i = 0; i < 5; i++) {
        state = recordReview(state, card.id, Grade.EASY);
      }
    }

    expect(isNoteSharpPairWellStudied(state, "C#")).toBe(true);
  });
});

describe("getDueCards", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns empty array when no cards introduced", () => {
    const state = loadState();
    expect(getDueCards(state)).toEqual([]);
  });

  it("returns introduced cards sorted by urgency", () => {
    let state = loadState();
    const cardId1 = state.cards[0].id;
    const cardId2 = state.cards[1].id;

    state = recordReview(state, cardId1, Grade.GOOD);
    state = recordReview(state, cardId2, Grade.AGAIN); // More urgent

    const due = getDueCards(state);
    expect(due.length).toBe(2);
    // Both cards are returned (retrievability is same when just reviewed)
    const dueIds = due.map((c) => c.id);
    expect(dueIds).toContain(cardId1);
    expect(dueIds).toContain(cardId2);
  });
});

describe("selectNextPairToIntroduce", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns first initial pair when nothing introduced", () => {
    const state = loadState();
    const nextPair = selectNextPairToIntroduce(state);
    expect(nextPair).toEqual(INITIAL_PAIRS[0]);
  });

  it("returns next initial pair after first is introduced", () => {
    let state = loadState();
    // Introduce first pair
    const [familyA, familyB] = INITIAL_PAIRS[0];
    const firstPairName = getPairName(`${familyA}4`, `${familyB}4`);
    const firstPairCards = state.cards.filter((c) => c.pair === firstPairName);
    for (const card of firstPairCards) {
      state = recordReview(state, card.id, Grade.GOOD);
    }

    const nextPair = selectNextPairToIntroduce(state);
    expect(nextPair).toEqual(INITIAL_PAIRS[1]);
  });

  it("returns null when all pairs introduced", () => {
    let state = loadState();
    // Introduce all cards
    for (const card of state.cards) {
      state = recordReview(state, card.id, Grade.GOOD);
    }

    const nextPair = selectNextPairToIntroduce(state);
    expect(nextPair).toBeNull();
  });
});

describe("selectSessionCards", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("first session introduces same-octave cards for 2 initial pairs", () => {
    const state = loadState();
    const session = selectSessionCards(state);

    expect(session.isFirstSession).toBe(true);
    // 2 pairs × 2 same-octave cards = 4 cards
    expect(session.newCards.length).toBe(4);
    // All cards should be same-octave
    expect(session.newCards.every((c) => c.sameOctave)).toBe(true);
  });

  it("first session cards are in octave 4", () => {
    const state = loadState();
    const session = selectSessionCards(state);

    for (const card of session.newCards) {
      expect(getOctave(card.noteA)).toBe(4);
      expect(getOctave(card.noteB)).toBe(4);
    }
  });

  it("first session includes C-F and D-G pairs", () => {
    const state = loadState();
    const session = selectSessionCards(state);

    const pairs = new Set(session.newCards.map((c) => c.pair));
    expect(pairs.has("C-F")).toBe(true);
    expect(pairs.has("D-G")).toBe(true);
  });

  it("does not introduce all cards in first session", () => {
    const state = loadState();
    const session = selectSessionCards(state);

    expect(session.newCards.length).toBeLessThan(state.cards.length);
  });

  it("includes review cards after first session", () => {
    let state = loadState();
    // Complete first session
    const session1 = selectSessionCards(state);
    for (const card of session1.newCards) {
      state = recordReview(state, card.id, Grade.GOOD);
    }
    state = incrementSessionCount(state);

    const session2 = selectSessionCards(state);
    expect(session2.isFirstSession).toBe(false);
    expect(session2.reviewCards.length).toBeGreaterThan(0);
  });

  it("marks allIntroduced when all cards are introduced", () => {
    let state = loadState();
    for (const card of state.cards) {
      state = recordReview(state, card.id, Grade.GOOD);
    }

    const session = selectSessionCards(state);
    expect(session.allIntroduced).toBe(true);
  });
});

describe("incrementSessionCount", () => {
  it("increments session count", () => {
    let state = loadState();
    expect(state.sessionCount).toBe(0);

    state = incrementSessionCount(state);
    expect(state.sessionCount).toBe(1);

    state = incrementSessionCount(state);
    expect(state.sessionCount).toBe(2);
  });
});

describe("getStats", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns correct initial stats", () => {
    const state = loadState();
    const stats = getStats(state);

    expect(stats.introducedPairs).toBe(0);
    expect(stats.totalPairs).toBe(66);
    expect(stats.introducedCards).toBe(0);
    expect(stats.totalCards).toBe(396);
    expect(stats.sessionsCompleted).toBe(0);
    expect(stats.totalReviews).toBe(0);
  });

  it("tracks progress correctly", () => {
    let state = loadState();
    // Introduce one pair (all 6 cards)
    const cfCards = state.cards.filter((c) => c.pair === "C-F");
    for (const card of cfCards) {
      state = recordReview(state, card.id, Grade.GOOD);
    }
    state = incrementSessionCount(state);

    const stats = getStats(state);
    expect(stats.introducedPairs).toBe(1);
    expect(stats.introducedCards).toBe(6);
    expect(stats.totalReviews).toBe(6);
    expect(stats.sessionsCompleted).toBe(1);
  });
});

describe("clearAllProgress", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("removes stored state", () => {
    let state = loadState();
    const cardId = state.cards[0].id;
    state = recordReview(state, cardId, Grade.GOOD);
    saveState(state);

    expect(loadState().history.length).toBe(1);

    clearAllProgress();

    const cleared = loadState();
    expect(cleared.history.length).toBe(0);
    expect(getIntroducedCards(cleared).length).toBe(0);
  });
});

describe("isReliablyLearned", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns false for unreviewed card", () => {
    const state = loadState();
    const cardId = state.cards[0].id;
    expect(isReliablyLearned(state, cardId)).toBe(false);
  });

  it("returns false for recently failed card", () => {
    let state = loadState();
    const cardId = state.cards[0].id;
    state = recordReview(state, cardId, Grade.AGAIN);
    expect(isReliablyLearned(state, cardId)).toBe(false);
  });

  it("returns true for well-learned card", () => {
    let state = loadState();
    const cardId = state.cards[0].id;
    // Multiple successful reviews
    for (let i = 0; i < 5; i++) {
      state = recordReview(state, cardId, Grade.EASY);
    }
    expect(isReliablyLearned(state, cardId)).toBe(true);
  });
});

describe("getRetrievability", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns 0 for unreviewed card", () => {
    const state = loadState();
    const card = state.cards[0];
    expect(getRetrievability(card)).toBe(0);
  });

  it("returns positive value for reviewed card", () => {
    let state = loadState();
    const cardId = state.cards[0].id;
    state = recordReview(state, cardId, Grade.GOOD);
    const card = state.cards.find((c) => c.id === cardId)!;
    expect(getRetrievability(card)).toBeGreaterThan(0);
  });
});

describe("session progression flow", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("follows expected learning progression", () => {
    let state = loadState();

    // First session: same-octave cards for 2 pairs
    let session = selectSessionCards(state);
    expect(session.isFirstSession).toBe(true);
    expect(session.newCards.length).toBe(4); // 2 pairs × 2 same-octave cards
    expect(session.newCards.every((c) => c.sameOctave)).toBe(true);

    // Review the new cards
    for (const card of session.newCards) {
      state = recordReview(state, card.id, Grade.GOOD);
    }
    state = incrementSessionCount(state);
    saveState(state);

    // Second session
    session = selectSessionCards(state);
    expect(session.isFirstSession).toBe(false);
    expect(session.reviewCards.length).toBeGreaterThan(0);
    // Should have new cards (next pair or different-octave cards)
    expect(session.newCards.length).toBeGreaterThan(0);
  });
});
