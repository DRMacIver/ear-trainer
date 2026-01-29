import { describe, it, expect, beforeEach } from "vitest";
import {
  loadState,
  saveState,
  clearState,
  recordQuestion,
  updateStreak,
  randomizeOrder,
  selectTargetNote,
  getAdjacentNotes,
  getAdjacentNotesInVocabulary,
  getAdjacentVocabPairs,
  getNoteDistance,
  getNextNoteToLearn,
  getClosestVocabularyNotes,
  maybeStartNewSession,
  getRepeatProbability,
  recordPairReview,
  selectMostUrgentPair,
  getTargetQuestionCounts,
  selectLeastPracticedNote,
  selectVocabPair,
  getValidOctavePairs,
  selectOctavesForPair,
  pickRandomOctave,
  getNotePitch,
  // Pair utility functions
  normalizePair,
  getScalePosition,
  getNotesBetween,
  getPairTwoToneResults,
  getPairSingleNoteResults,
  isMastered,
  isSingleNotePairUnlocked,
  getUnlockedSingleNotePairs,
  getNextNoteToBetween,
  queueUnlock,
  processPendingUnlocks,
  checkAndQueueUnlocks,
  getLastIntroducedNote,
  // Variant system functions
  makeVariantKey,
  parseVariantKey,
  getAllTwoToneVariantsForPair,
  getAllSingleNoteVariantsForPair,
  getInitialVariant,
  isVariantUnlocked,
  getUnlockedVariantsForPair,
  getUnlockedTwoToneVariants,
  getUnlockedSingleNoteVariants,
  getNextVariantToUnlock,
  recordVariantResult,
  checkNoteUnlock,
  // Ordering question functions
  getVocabInChromaticOrder,
  shouldTriggerOrdering,
  recordOrderingResult,
  enterOrderingMode,
  incrementOrderingInterval,
  ORDERING_INTERVAL,
  ORDERING_STRUGGLE_WINDOW,
  ORDERING_EXIT_STREAK,
  NOTE_SEMITONES,
  AVAILABLE_OCTAVES,
  MASTERY_WINDOW,
  UNLOCK_COOLDOWN,
  PAIR_COMPLETION_STREAK,
  NOTE_UNLOCK_COOLDOWN,
  Grade,
  FullTone,
  FULL_TONES,
  LEARNING_ORDER,
  STREAK_LENGTH,
} from "../src/lib/tone-quiz-state.js";

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

describe("FULL_TONES", () => {
  it("contains 7 natural notes", () => {
    expect(FULL_TONES.length).toBe(7);
    expect(FULL_TONES).toEqual(["C", "D", "E", "F", "G", "A", "B"]);
  });
});

describe("LEARNING_ORDER", () => {
  it("starts with C and G (well-separated notes)", () => {
    expect(LEARNING_ORDER[0]).toBe("C");
    expect(LEARNING_ORDER[1]).toBe("G");
  });

  it("contains all full tones", () => {
    expect(LEARNING_ORDER.length).toBe(7);
    for (const tone of FULL_TONES) {
      expect(LEARNING_ORDER).toContain(tone);
    }
  });
});

describe("loadState / saveState / clearState", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns initial state when nothing saved", () => {
    const state = loadState();
    expect(state.history).toEqual([]);
    expect(state.learningVocabulary).toEqual(["C", "G"]);
    expect(state.currentTarget).toBeNull();
    expect(state.correctStreak).toBe(0);
    // New variant system fields
    expect(state.unlockedVariants).toEqual(["C-G:two-note:4-4"]);
    expect(state.pairStreaks).toEqual({});
    expect(state.recentSingleNoteResults).toEqual([]);
  });

  it("saves and loads state correctly", () => {
    const state = loadState();
    state.correctStreak = 2;
    state.learningVocabulary = ["C", "G", "E"];
    saveState(state);

    const loaded = loadState();
    expect(loaded.correctStreak).toBe(2);
    expect(loaded.learningVocabulary).toEqual(["C", "G", "E"]);
  });

  it("clearState resets to initial state", () => {
    const state = loadState();
    state.correctStreak = 5;
    saveState(state);

    clearState();
    const cleared = loadState();
    expect(cleared.correctStreak).toBe(0);
    expect(cleared.learningVocabulary).toEqual(["C", "G"]);
  });
});

describe("getAdjacentNotes", () => {
  it("returns adjacent notes for middle note", () => {
    const [lower, upper] = getAdjacentNotes("D");
    expect(lower).toBe("C");
    expect(upper).toBe("E");
  });

  it("wraps at lower boundary", () => {
    const [lower, upper] = getAdjacentNotes("C");
    expect(lower).toBe("B");
    expect(upper).toBe("D");
  });

  it("wraps at upper boundary", () => {
    const [lower, upper] = getAdjacentNotes("B");
    expect(lower).toBe("A");
    expect(upper).toBe("C");
  });
});

describe("getAdjacentNotesInVocabulary", () => {
  it("returns null for both when note not in vocabulary", () => {
    const [lower, upper] = getAdjacentNotesInVocabulary("D", ["C", "G"]);
    expect(lower).toBeNull();
    expect(upper).toBeNull();
  });

  it("returns null for both when vocabulary has only one note", () => {
    const [lower, upper] = getAdjacentNotesInVocabulary("C", ["C"]);
    expect(lower).toBeNull();
    expect(upper).toBeNull();
  });

  it("returns same note for both when vocabulary has two notes", () => {
    // With ["C", "G"], C's only neighbor is G in both directions
    const [lower, upper] = getAdjacentNotesInVocabulary("C", ["C", "G"]);
    expect(lower).toBe("G");
    expect(upper).toBe("G");
  });

  it("returns different neighbors for three-note vocabulary", () => {
    // With ["C", "G", "E"], C's neighbors are E (up) and G (down via wrap)
    // FULL_TONES order: C D E F G A B
    // From C: up -> D, E (E is in vocab), down -> B, A, G (G is in vocab)
    const [lower, upper] = getAdjacentNotesInVocabulary("C", ["C", "G", "E"]);
    expect(lower).toBe("G"); // Going down from C, G is closest in vocab
    expect(upper).toBe("E"); // Going up from C, E is closest in vocab
  });

  it("handles note in the middle of vocabulary", () => {
    // With ["C", "D", "E"], D's neighbors are C (down) and E (up)
    const [lower, upper] = getAdjacentNotesInVocabulary("D", ["C", "D", "E"]);
    expect(lower).toBe("C");
    expect(upper).toBe("E");
  });

  it("handles wrapping correctly for G in [C, G, E]", () => {
    // From G: up -> A, B, C (C is in vocab), down -> F, E (E is in vocab)
    const [lower, upper] = getAdjacentNotesInVocabulary("G", ["C", "G", "E"]);
    expect(lower).toBe("E"); // Going down from G
    expect(upper).toBe("C"); // Going up from G (wraps to C)
  });
});

describe("getAdjacentVocabPairs", () => {
  it("returns empty array for single-note vocabulary", () => {
    const pairs = getAdjacentVocabPairs(["C"]);
    expect(pairs).toEqual([]);
  });

  it("returns single pair for two-note vocabulary", () => {
    const pairs = getAdjacentVocabPairs(["C", "G"]);
    expect(pairs.length).toBe(1);
    // The pair should contain C and G
    expect(pairs[0].sort()).toEqual(["C", "G"]);
  });

  it("returns all adjacent pairs for three-note vocabulary", () => {
    // For ["C", "G", "E"]:
    // C's neighbors: G (down), E (up) -> pairs [C,G], [C,E]
    // G's neighbors: E (down), C (up) -> pairs [G,E], [G,C] (C already seen)
    // E's neighbors: C (down), G (up) -> pairs [E,C], [E,G] (both already seen)
    const pairs = getAdjacentVocabPairs(["C", "G", "E"]);
    // Should have 3 unique pairs
    expect(pairs.length).toBe(3);

    const pairStrings = pairs.map(([a, b]) => [a, b].sort().join("-")).sort();
    expect(pairStrings).toEqual(["C-E", "C-G", "E-G"]);
  });

  it("identifies adjacent pairs in larger vocabulary", () => {
    // For ["C", "D", "G"]:
    // C's neighbors: G (down via wrap), D (up)
    // D's neighbors: C (down), G (up, skipping E/F)
    // G's neighbors: D (down, skipping F/E), C (up via wrap)
    const pairs = getAdjacentVocabPairs(["C", "D", "G"]);
    expect(pairs.length).toBe(3);
  });
});

describe("getNoteDistance", () => {
  it("returns 0 for same note", () => {
    expect(getNoteDistance("C", "C")).toBe(0);
  });

  it("returns 1 for adjacent notes", () => {
    expect(getNoteDistance("C", "D")).toBe(1);
    expect(getNoteDistance("D", "C")).toBe(1);
  });

  it("returns correct distance with wrapping", () => {
    // C to G is 4 forward, 3 backward -> min is 3
    expect(getNoteDistance("C", "G")).toBe(3);
    // C to B is 1 backward (wrapping)
    expect(getNoteDistance("C", "B")).toBe(1);
  });
});

describe("updateStreak", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("increments streak on correct answer", () => {
    let state = loadState();
    state.correctStreak = 0;

    state = updateStreak(state, true);
    expect(state.correctStreak).toBe(1);

    state = updateStreak(state, true);
    expect(state.correctStreak).toBe(2);
  });

  it("resets streak on wrong answer", () => {
    let state = loadState();
    state.correctStreak = 5;

    state = updateStreak(state, false);
    expect(state.correctStreak).toBe(0);
  });
});

describe("recordQuestion", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("adds record to history", () => {
    let state = loadState();
    state = recordQuestion(state, {
      timestamp: Date.now(),
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: true,
    });

    expect(state.history.length).toBe(1);
    expect(state.history[0].correct).toBe(true);
  });

  it("updates performance only for first-in-streak questions", () => {
    let state = loadState();

    // First question counts
    state = recordQuestion(state, {
      timestamp: Date.now(),
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: true,
    });

    expect(state.performance["C"]?.["G"]?.length).toBe(1);

    // Retry (not first in streak) should not update performance
    state = recordQuestion(state, {
      timestamp: Date.now(),
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: false,
      wasFirstInStreak: false,
    });

    // Performance should still only have 1 entry
    expect(state.performance["C"]?.["G"]?.length).toBe(1);
  });

  it("increments questionsSinceLastUnlock", () => {
    let state = loadState();
    expect(state.questionsSinceLastUnlock).toBe(0);

    state = recordQuestion(state, {
      timestamp: Date.now(),
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: true,
    });

    expect(state.questionsSinceLastUnlock).toBe(1);
  });
});

describe("Retry behavior - wasFirstInStreak tracking", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("retry questions (wasFirstInStreak=false) do not affect performance stats", () => {
    let state = loadState();

    // Original question - counts for performance
    state = recordQuestion(state, {
      timestamp: Date.now(),
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: false,
      wasFirstInStreak: true,
    });

    expect(state.performance["C"]["G"]).toEqual([false]);

    // Retry 1 - wrong again, should not add to performance
    state = recordQuestion(state, {
      timestamp: Date.now(),
      noteA: "G4",
      noteB: "C4",
      targetNote: "C",
      otherNote: "G",
      correct: false,
      wasFirstInStreak: false,
    });

    expect(state.performance["C"]["G"]).toEqual([false]);

    // Retry 2 - correct, should not add to performance
    state = recordQuestion(state, {
      timestamp: Date.now(),
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: false,
    });

    // Performance still only has the original wrong answer
    expect(state.performance["C"]["G"]).toEqual([false]);
  });

  it("history records all attempts including retries", () => {
    let state = loadState();

    // Original question
    state = recordQuestion(state, {
      timestamp: Date.now(),
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: false,
      wasFirstInStreak: true,
    });

    // Retry
    state = recordQuestion(state, {
      timestamp: Date.now(),
      noteA: "G4",
      noteB: "C4",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: false,
    });

    // History should have both records
    expect(state.history.length).toBe(2);
    expect(state.history[0].correct).toBe(false);
    expect(state.history[0].wasFirstInStreak).toBe(true);
    expect(state.history[1].correct).toBe(true);
    expect(state.history[1].wasFirstInStreak).toBe(false);
  });
});

describe("randomizeOrder", () => {
  it("returns both elements", () => {
    const [a, b] = randomizeOrder("first", "second");
    expect([a, b].sort()).toEqual(["first", "second"]);
  });

  it("randomizes order (statistical test)", () => {
    let firstCount = 0;
    const iterations = 100;

    for (let i = 0; i < iterations; i++) {
      const [first] = randomizeOrder("A", "B");
      if (first === "A") firstCount++;
    }

    // Should be roughly 50/50, allow wide margin for randomness
    expect(firstCount).toBeGreaterThan(20);
    expect(firstCount).toBeLessThan(80);
  });
});

describe("selectTargetNote", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  const mockPickOctave = () => 4;

  it("selects from vocabulary", () => {
    const state = loadState();
    const [target, , , , ,] = selectTargetNote(state, mockPickOctave);
    expect(state.learningVocabulary).toContain(target);
  });

  it("sticks with current target until streak reached", () => {
    let state = loadState();
    state.currentTarget = "C";
    state.currentTargetOctave = 4;
    state.correctStreak = 1; // Less than STREAK_LENGTH (3)

    const [target, , isNew, , ,] = selectTargetNote(state, mockPickOctave);
    expect(target).toBe("C");
    expect(isNew).toBe(false);
  });

  it("picks new target after streak reached", () => {
    let state = loadState();
    state.currentTarget = "C";
    state.currentTargetOctave = 4;
    state.correctStreak = STREAK_LENGTH; // Reached streak threshold

    const [, , , , updatedState,] = selectTargetNote(state, mockPickOctave);
    expect(updatedState.correctStreak).toBe(0); // Reset for new target
  });
});

describe("getTargetQuestionCounts", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns zero counts for notes with no questions", () => {
    const state = loadState();
    const counts = getTargetQuestionCounts(state);
    expect(counts["C"]).toBe(0);
    expect(counts["G"]).toBe(0);
  });

  it("counts questions from performance data", () => {
    let state = loadState();
    state.performance = {
      C: {
        G: [true, false, true], // 3 questions
        D: [true, true], // 2 questions
      },
      G: {
        C: [true], // 1 question
      },
    };
    const counts = getTargetQuestionCounts(state);
    expect(counts["C"]).toBe(5); // 3 + 2
    expect(counts["G"]).toBe(1);
  });
});

describe("selectLeastPracticedNote", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("selects note with fewest questions", () => {
    let state = loadState();
    state.performance = {
      C: {
        G: [true, true, true, true, true], // 5 questions
      },
      // G has 0 questions
    };
    const selected = selectLeastPracticedNote(state);
    expect(selected).toBe("G");
  });

  it("breaks ties randomly", () => {
    const state = loadState();
    // Both C and G have 0 questions
    const results = new Set<string>();
    for (let i = 0; i < 50; i++) {
      results.add(selectLeastPracticedNote(state));
    }
    // Should select both at some point
    expect(results.has("C")).toBe(true);
    expect(results.has("G")).toBe(true);
  });
});

// ============================================================================
// New Unlock System Tests
// ============================================================================

describe("normalizePair", () => {
  it("normalizes pair to alphabetical order", () => {
    expect(normalizePair("C", "G")).toBe("C-G");
    expect(normalizePair("G", "C")).toBe("C-G");
    expect(normalizePair("A", "B")).toBe("A-B");
    expect(normalizePair("B", "A")).toBe("A-B");
  });
});

describe("getScalePosition", () => {
  it("returns correct positions for C Major scale", () => {
    expect(getScalePosition("C")).toBe(0);
    expect(getScalePosition("D")).toBe(1);
    expect(getScalePosition("E")).toBe(2);
    expect(getScalePosition("F")).toBe(3);
    expect(getScalePosition("G")).toBe(4);
    expect(getScalePosition("A")).toBe(5);
    expect(getScalePosition("B")).toBe(6);
  });
});

describe("getNotesBetween", () => {
  it("returns notes between C and G", () => {
    const between = getNotesBetween("C", "G");
    // C=0, G=4, notes between are D(1), E(2), F(3)
    // Sorted by LEARNING_ORDER: E, D, F (since E is before D in LEARNING_ORDER)
    expect(between).toContain("D");
    expect(between).toContain("E");
    expect(between).toContain("F");
    expect(between.length).toBe(3);
  });

  it("returns notes in LEARNING_ORDER preference", () => {
    const between = getNotesBetween("C", "G");
    // LEARNING_ORDER is C, G, E, A, D, F, B
    // So E should come before D, D before F
    expect(between).toEqual(["E", "D", "F"]);
  });

  it("returns empty array for adjacent notes", () => {
    const between = getNotesBetween("C", "D");
    expect(between).toEqual([]);
  });

  it("returns single note between C and E", () => {
    const between = getNotesBetween("C", "E");
    expect(between).toEqual(["D"]);
  });

  it("works regardless of argument order", () => {
    expect(getNotesBetween("G", "C")).toEqual(getNotesBetween("C", "G"));
  });
});

describe("getPairTwoToneResults and getPairSingleNoteResults", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("combines two-tone results from both directions", () => {
    let state = loadState();
    state.performance = {
      C: { G: [true, true, false] },
      G: { C: [true, false, true] },
    };
    const results = getPairTwoToneResults(state, "C", "G");
    // Combined: [true, true, false, true, false, true]
    expect(results.length).toBe(6);
    expect(results.filter(Boolean).length).toBe(4);
  });

  it("limits to last MASTERY_WINDOW results", () => {
    let state = loadState();
    // Create more than MASTERY_WINDOW (10) results
    state.performance = {
      C: { G: Array(8).fill(true) },
      G: { C: Array(8).fill(false) },
    };
    const results = getPairTwoToneResults(state, "C", "G");
    expect(results.length).toBe(MASTERY_WINDOW);
  });

  it("combines single-note results from both directions", () => {
    let state = loadState();
    state.singleNotePerformance = {
      C: { G: [true, true] },
      G: { C: [false, true] },
    };
    const results = getPairSingleNoteResults(state, "C", "G");
    expect(results.length).toBe(4);
  });
});

describe("isMastered", () => {
  it("returns false with insufficient data", () => {
    expect(isMastered([true, true, true])).toBe(false);
  });

  it("returns true with 9/10 correct", () => {
    const results = [true, true, true, true, true, true, true, true, true, false];
    expect(isMastered(results)).toBe(true);
  });

  it("returns true with 10/10 correct", () => {
    const results = Array(10).fill(true);
    expect(isMastered(results)).toBe(true);
  });

  it("returns false with 8/10 correct", () => {
    const results = [true, true, true, true, true, true, true, true, false, false];
    expect(isMastered(results)).toBe(false);
  });
});

describe("isSingleNotePairUnlocked and getUnlockedSingleNotePairs", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns false when no single-note variants are unlocked", () => {
    const state = loadState();
    // Initial state has only two-note variants
    expect(isSingleNotePairUnlocked(state, "C", "G")).toBe(false);
  });

  it("returns true when single-note variant is unlocked", () => {
    let state = loadState();
    state.unlockedVariants = [...state.unlockedVariants, "C-G:single-note:4"];
    expect(isSingleNotePairUnlocked(state, "C", "G")).toBe(true);
    expect(isSingleNotePairUnlocked(state, "G", "C")).toBe(true); // Order shouldn't matter
  });

  it("getUnlockedSingleNotePairs returns pairs as arrays", () => {
    let state = loadState();
    state.unlockedVariants = [
      "C-G:two-note:4-4",
      "C-G:single-note:4",
      "C-E:single-note:4",
    ];
    const pairs = getUnlockedSingleNotePairs(state);
    expect(pairs.length).toBe(2);
    expect(pairs).toContainEqual(["C", "G"]);
    expect(pairs).toContainEqual(["C", "E"]);
  });
});

describe("getNextNoteToBetween", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns first LEARNING_ORDER note between pair", () => {
    let state = loadState();
    state.learningVocabulary = ["C", "G"];
    const next = getNextNoteToBetween(state, "C", "G");
    // Between C and G: D, E, F. In LEARNING_ORDER: E comes first
    expect(next).toBe("E");
  });

  it("returns null if note already between in vocabulary", () => {
    let state = loadState();
    state.learningVocabulary = ["C", "E", "G"];
    const next = getNextNoteToBetween(state, "C", "G");
    expect(next).toBeNull();
  });

  it("returns null for adjacent notes with nothing between", () => {
    let state = loadState();
    state.learningVocabulary = ["C", "D"];
    const next = getNextNoteToBetween(state, "C", "D");
    expect(next).toBeNull();
  });
});

describe("queueUnlock", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("adds note unlock to pending queue", () => {
    let state = loadState();
    state = queueUnlock(state, { type: "note", value: "E" });
    expect(state.pendingUnlocks.length).toBe(1);
    expect(state.pendingUnlocks[0]).toEqual({ type: "note", value: "E" });
  });

  it("does not add duplicate unlock", () => {
    let state = loadState();
    state = queueUnlock(state, { type: "note", value: "E" });
    state = queueUnlock(state, { type: "note", value: "E" });
    expect(state.pendingUnlocks.length).toBe(1);
  });

  it("ignores single-note-pair type (deprecated)", () => {
    let state = loadState();
    state = queueUnlock(state, { type: "single-note-pair", value: "C-G" });
    expect(state.pendingUnlocks.length).toBe(0);
  });

  it("does not add note unlock if already in vocabulary", () => {
    let state = loadState();
    state = queueUnlock(state, { type: "note", value: "C" });
    expect(state.pendingUnlocks.length).toBe(0);
  });
});

describe("processPendingUnlocks", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("does nothing when queue is empty", () => {
    let state = loadState();
    state.questionsSinceLastUnlock = 100;
    const newState = processPendingUnlocks(state);
    expect(newState).toBe(state);
  });

  it("does nothing when cooldown not met", () => {
    let state = loadState();
    state.pendingUnlocks = [{ type: "note", value: "E" }];
    state.questionsSinceLastUnlock = UNLOCK_COOLDOWN - 1;
    const newState = processPendingUnlocks(state);
    expect(newState.pendingUnlocks.length).toBe(1);
  });

  it("processes note unlock when cooldown met", () => {
    let state = loadState();
    state.pendingUnlocks = [{ type: "note", value: "E" }];
    state.questionsSinceLastUnlock = UNLOCK_COOLDOWN;
    const newState = processPendingUnlocks(state);
    expect(newState.learningVocabulary).toContain("E");
    expect(newState.pendingUnlocks.length).toBe(0);
    expect(newState.questionsSinceLastUnlock).toBe(0);
    // Should also add initial variants for new note
    expect(newState.unlockedVariants).toContain("C-E:two-note:4-4");
    expect(newState.unlockedVariants).toContain("E-G:two-note:4-4");
  });

  it("skips deprecated single-note-pair type", () => {
    let state = loadState();
    state.pendingUnlocks = [{ type: "single-note-pair", value: "C-G" }];
    state.questionsSinceLastUnlock = UNLOCK_COOLDOWN;
    const newState = processPendingUnlocks(state);
    expect(newState.pendingUnlocks.length).toBe(0);
    // No single-note variant should be unlocked
    expect(newState.unlockedVariants.some(v => v.includes(":single-note:"))).toBe(false);
  });
});

describe("checkAndQueueUnlocks (legacy, now just processes pending)", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("processes pending note unlocks when cooldown met", () => {
    let state = loadState();
    state.pendingUnlocks = [{ type: "note", value: "E" }];
    state.questionsSinceLastUnlock = UNLOCK_COOLDOWN;
    const newState = checkAndQueueUnlocks(state);
    expect(newState.learningVocabulary).toContain("E");
    expect(newState.pendingUnlocks.length).toBe(0);
  });
});

describe("getLastIntroducedNote", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns null when vocabulary unchanged", () => {
    const prev = loadState();
    const curr = loadState();
    expect(getLastIntroducedNote(prev, curr)).toBeNull();
  });

  it("returns new note when vocabulary grew", () => {
    const prev = loadState();
    prev.learningVocabulary = ["C", "G"];
    const curr = loadState();
    curr.learningVocabulary = ["C", "G", "E"];
    expect(getLastIntroducedNote(prev, curr)).toBe("E");
  });
});

describe("getNextNoteToLearn", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns next note from LEARNING_ORDER not in vocabulary", () => {
    const state = loadState();
    // Initial vocabulary is ["C", "G"]
    // LEARNING_ORDER is ["C", "G", "E", "A", "D", "F", "B"]
    expect(getNextNoteToLearn(state)).toBe("E");
  });

  it("returns null when all notes learned", () => {
    let state = loadState();
    state.learningVocabulary = [...LEARNING_ORDER];
    expect(getNextNoteToLearn(state)).toBeNull();
  });
});

describe("getClosestVocabularyNotes", () => {
  it("returns two closest notes from vocabulary", () => {
    const vocabulary: FullTone[] = ["C", "G", "E"];
    const closest = getClosestVocabularyNotes(vocabulary, "D");
    expect(closest.length).toBe(2);
    // D is adjacent to C and E
    expect(closest).toContain("C");
    expect(closest).toContain("E");
  });

  it("excludes the candidate note itself", () => {
    const vocabulary: FullTone[] = ["C", "D", "E"];
    const closest = getClosestVocabularyNotes(vocabulary, "D");
    expect(closest).not.toContain("D");
  });
});


describe("maybeStartNewSession", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("starts a new session when no session exists", () => {
    let state = loadState();
    // Remove session to simulate old state
    state.session = undefined as unknown as typeof state.session;

    const now = Date.now();
    const updated = maybeStartNewSession(state, now);

    expect(updated.session.sessionStartTime).toBe(now);
    expect(updated.session.previousSessionEnd).toBeNull();
  });

  it("starts a new session after timeout (5+ minutes of inactivity)", () => {
    let state = loadState();
    const now = Date.now();
    state.lastPlayedAt = now - 6 * 60 * 1000; // 6 minutes ago
    state.session = {
      sessionStartTime: now - 10 * 60 * 1000, // Old session
      previousSessionEnd: null,
    };

    const updated = maybeStartNewSession(state, now);

    expect(updated.session.sessionStartTime).toBe(now);
    expect(updated.session.previousSessionEnd).toBe(state.lastPlayedAt);
  });

  it("does not start new session within timeout", () => {
    let state = loadState();
    const now = Date.now();
    state.lastPlayedAt = now - 2 * 60 * 1000; // 2 minutes ago
    state.session = {
      sessionStartTime: now - 5 * 60 * 1000,
      previousSessionEnd: null,
    };

    const updated = maybeStartNewSession(state, now);

    // Session should remain unchanged
    expect(updated.session.sessionStartTime).toBe(state.session.sessionStartTime);
  });
});

describe("getRepeatProbability", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns ~50% for immediate return (0 hour gap)", () => {
    let state = loadState();
    const now = Date.now();
    state.session = {
      sessionStartTime: now,
      previousSessionEnd: now, // No gap
    };

    const prob = getRepeatProbability(state, now);
    expect(prob).toBeCloseTo(0.5, 1);
  });

  it("returns 100% for 24+ hour gap", () => {
    let state = loadState();
    const now = Date.now();
    state.session = {
      sessionStartTime: now,
      previousSessionEnd: now - 24 * 60 * 60 * 1000, // 24 hours ago
    };

    const prob = getRepeatProbability(state, now);
    expect(prob).toBe(1.0);
  });

  it("returns ~75% for 12 hour gap", () => {
    let state = loadState();
    const now = Date.now();
    state.session = {
      sessionStartTime: now,
      previousSessionEnd: now - 12 * 60 * 60 * 1000, // 12 hours ago
    };

    const prob = getRepeatProbability(state, now);
    expect(prob).toBeCloseTo(0.75, 1);
  });

  it("decays to 50% of starting after 5 minutes of session time", () => {
    let state = loadState();
    const now = Date.now();
    const sessionStart = now - 5 * 60 * 1000; // 5 minutes ago
    state.session = {
      sessionStartTime: sessionStart,
      previousSessionEnd: sessionStart - 24 * 60 * 60 * 1000, // 24h gap
    };

    const prob = getRepeatProbability(state, now);
    // Started at 100%, should be 50% after 5 minutes
    expect(prob).toBeCloseTo(0.5, 1);
  });

  it("decays to 10% after 15+ minutes of session time", () => {
    let state = loadState();
    const now = Date.now();
    const sessionStart = now - 20 * 60 * 1000; // 20 minutes ago
    state.session = {
      sessionStartTime: sessionStart,
      previousSessionEnd: sessionStart - 24 * 60 * 60 * 1000,
    };

    const prob = getRepeatProbability(state, now);
    expect(prob).toBe(0.1);
  });

  it("never goes below 10%", () => {
    let state = loadState();
    const now = Date.now();
    const sessionStart = now - 60 * 60 * 1000; // 1 hour into session
    state.session = {
      sessionStartTime: sessionStart,
      previousSessionEnd: sessionStart,
    };

    const prob = getRepeatProbability(state, now);
    expect(prob).toBe(0.1);
  });
});

describe("recordPairReview", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("creates a new card for first review", () => {
    let state = loadState();
    expect(state.pairCards["C-G"]).toBeUndefined();

    state = recordPairReview(state, "C", "G", Grade.GOOD);

    expect(state.pairCards["C-G"]).toBeDefined();
    expect(state.pairCards["C-G"].card).not.toBeNull();
    expect(state.pairCards["C-G"].reviewCount).toBe(1);
    expect(state.pairCards["C-G"].lastReviewedAt).toBeDefined();
  });

  it("updates existing card on subsequent reviews", () => {
    let state = loadState();
    state = recordPairReview(state, "C", "G", Grade.GOOD);
    const firstCard = state.pairCards["C-G"].card;

    state = recordPairReview(state, "C", "G", Grade.GOOD);

    expect(state.pairCards["C-G"].reviewCount).toBe(2);
    // Card should be updated (stability should increase for correct answers)
    expect(state.pairCards["C-G"].card).not.toBe(firstCard);
  });

  it("handles AGAIN grade correctly", () => {
    let state = loadState();
    state = recordPairReview(state, "C", "G", Grade.AGAIN);

    expect(state.pairCards["C-G"]).toBeDefined();
    expect(state.pairCards["C-G"].card).not.toBeNull();
    // Card with AGAIN grade should have lower stability
    expect(state.pairCards["C-G"].card!.S).toBeLessThan(1);
  });

  it("tracks different pairs separately", () => {
    let state = loadState();
    state = recordPairReview(state, "C", "G", Grade.GOOD);
    state = recordPairReview(state, "G", "C", Grade.GOOD);
    state = recordPairReview(state, "C", "E", Grade.AGAIN);

    expect(Object.keys(state.pairCards)).toHaveLength(3);
    expect(state.pairCards["C-G"].reviewCount).toBe(1);
    expect(state.pairCards["G-C"].reviewCount).toBe(1);
    expect(state.pairCards["C-E"].reviewCount).toBe(1);
  });
});

describe("selectMostUrgentPair", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns null when no cards exist", () => {
    const state = loadState();
    expect(selectMostUrgentPair(state)).toBeNull();
  });

  it("returns null when all cards are null", () => {
    let state = loadState();
    state.pairCards = {
      "C-G": { card: null, lastReviewedAt: null, reviewCount: 0 },
    };
    expect(selectMostUrgentPair(state)).toBeNull();
  });

  it("returns null when no cards are due yet", () => {
    let state = loadState();
    const now = Date.now();

    // Create a card reviewed just now - not due yet
    state = recordPairReview(state, "C", "G", Grade.GOOD);
    state.pairCards["C-G"].lastReviewedAt = now;

    const pair = selectMostUrgentPair(state);
    expect(pair).toBeNull();
  });

  it("returns the most urgent due pair (lowest retrievability)", () => {
    let state = loadState();
    const now = Date.now();

    // Create a card that's due (reviewed long ago, past its interval)
    state = recordPairReview(state, "C", "E", Grade.GOOD);
    // FSRS GOOD on new card gives interval ~3 hours, so 10 hours ago is definitely due
    state.pairCards["C-E"].lastReviewedAt = now - 10 * 60 * 60 * 1000;

    // Create another due card, reviewed even longer ago (more urgent)
    state = recordPairReview(state, "C", "G", Grade.GOOD);
    state.pairCards["C-G"].lastReviewedAt = now - 24 * 60 * 60 * 1000; // 24 hours ago

    const pair = selectMostUrgentPair(state);

    expect(pair).not.toBeNull();
    // C-G should be more urgent since it was reviewed longer ago
    expect(pair!.target).toBe("C");
    expect(pair!.other).toBe("G");
  });

  it("ignores cards that are not due yet", () => {
    let state = loadState();
    const now = Date.now();

    // Create a card that's not due (reviewed recently)
    state = recordPairReview(state, "C", "G", Grade.GOOD);
    state.pairCards["C-G"].lastReviewedAt = now; // Just reviewed

    // Create a card that IS due
    state = recordPairReview(state, "C", "E", Grade.GOOD);
    state.pairCards["C-E"].lastReviewedAt = now - 10 * 60 * 60 * 1000; // 10 hours ago

    const pair = selectMostUrgentPair(state);

    expect(pair).not.toBeNull();
    // Only C-E should be considered since C-G isn't due
    expect(pair!.target).toBe("C");
    expect(pair!.other).toBe("E");
  });
});

describe("recordQuestion updates FSRS state", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("creates FSRS card for first-in-streak questions", () => {
    let state = loadState();

    state = recordQuestion(state, {
      timestamp: Date.now(),
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: true,
    });

    expect(state.pairCards["C-G"]).toBeDefined();
    expect(state.pairCards["C-G"].card).not.toBeNull();
    expect(state.pairCards["C-G"].reviewCount).toBe(1);
  });

  it("does not create FSRS card for retry questions", () => {
    let state = loadState();

    state = recordQuestion(state, {
      timestamp: Date.now(),
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: false,
    });

    expect(state.pairCards["C-G"]).toBeUndefined();
  });

  it("uses AGAIN grade for incorrect answers", () => {
    let state = loadState();

    state = recordQuestion(state, {
      timestamp: Date.now(),
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: false,
      wasFirstInStreak: true,
    });

    expect(state.pairCards["C-G"]).toBeDefined();
    // AGAIN grade results in low stability
    expect(state.pairCards["C-G"].card!.S).toBeLessThan(1);
  });
});


describe("recordQuestion for single-note questions", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("tracks single-note performance separately", () => {
    let state = loadState();

    state = recordQuestion(state, {
      timestamp: Date.now(),
      questionType: "single-note",
      noteA: "C4",
      noteB: "",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: true,
    });

    // Should track in singleNotePerformance, not performance
    expect(state.singleNotePerformance["C"]?.["G"]).toEqual([true]);
    expect(state.performance["C"]?.["G"]).toBeUndefined();
  });

  it("still updates FSRS for single-note questions", () => {
    let state = loadState();

    state = recordQuestion(state, {
      timestamp: Date.now(),
      questionType: "single-note",
      noteA: "C4",
      noteB: "",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: true,
    });

    expect(state.pairCards["C-G"]).toBeDefined();
    expect(state.pairCards["C-G"].card).not.toBeNull();
  });

  it("increments questionsSinceLastUnlock counter", () => {
    let state = loadState();
    expect(state.questionsSinceLastUnlock).toBe(0);

    state = recordQuestion(state, {
      timestamp: Date.now(),
      questionType: "two-note",
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: true,
    });

    expect(state.questionsSinceLastUnlock).toBe(1);
  });
});

// ============================================================================
// Vocabulary-Based Note and Octave Selection Tests
// ============================================================================

describe("NOTE_SEMITONES and AVAILABLE_OCTAVES", () => {
  it("NOTE_SEMITONES has correct values", () => {
    expect(NOTE_SEMITONES["C"]).toBe(0);
    expect(NOTE_SEMITONES["D"]).toBe(2);
    expect(NOTE_SEMITONES["E"]).toBe(4);
    expect(NOTE_SEMITONES["F"]).toBe(5);
    expect(NOTE_SEMITONES["G"]).toBe(7);
    expect(NOTE_SEMITONES["A"]).toBe(9);
    expect(NOTE_SEMITONES["B"]).toBe(11);
  });

  it("AVAILABLE_OCTAVES contains 3, 4, and 5", () => {
    expect(AVAILABLE_OCTAVES).toEqual([3, 4, 5]);
  });
});

describe("getNotePitch", () => {
  it("calculates correct pitch for notes", () => {
    // Pitch = semitones + octave * 12
    expect(getNotePitch("C", 4)).toBe(0 + 4 * 12); // 48
    expect(getNotePitch("G", 4)).toBe(7 + 4 * 12); // 55
    expect(getNotePitch("C", 5)).toBe(0 + 5 * 12); // 60
    expect(getNotePitch("G", 3)).toBe(7 + 3 * 12); // 43
  });

  it("correctly orders pitches across octaves", () => {
    expect(getNotePitch("G", 4)).toBeGreaterThan(getNotePitch("C", 4));
    expect(getNotePitch("C", 5)).toBeGreaterThan(getNotePitch("G", 4));
    expect(getNotePitch("G", 3)).toBeLessThan(getNotePitch("C", 4));
  });
});

describe("pickRandomOctave", () => {
  it("returns one of the available octaves (3, 4, or 5)", () => {
    const results = new Set<number>();
    for (let i = 0; i < 100; i++) {
      results.add(pickRandomOctave());
    }

    // Should only include valid octaves
    for (const octave of results) {
      expect([3, 4, 5]).toContain(octave);
    }

    // Should include all three octaves at some point (probabilistic)
    expect(results.size).toBe(3);
  });
});

describe("selectVocabPair", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns two different notes from vocabulary", () => {
    const state = loadState();
    const [noteA, noteB] = selectVocabPair(state);
    expect(noteA).not.toBe(noteB);
    expect(state.learningVocabulary).toContain(noteA);
    expect(state.learningVocabulary).toContain(noteB);
  });

  it("throws error if vocabulary has fewer than 2 notes", () => {
    const state = loadState();
    state.learningVocabulary = ["C"];
    expect(() => selectVocabPair(state)).toThrow();
  });

  it("selects from vocabulary of 3+ notes", () => {
    const state = loadState();
    state.learningVocabulary = ["C", "G", "E", "A"];

    const results = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const [a, b] = selectVocabPair(state);
      results.add(a);
      results.add(b);
    }

    // Should select from multiple notes in vocabulary
    expect(results.size).toBeGreaterThanOrEqual(3);
  });
});

describe("getValidOctavePairs", () => {
  it("returns valid pairs when higher note has more semitones", () => {
    // G (7 semitones) higher than C (0 semitones)
    const pairs = getValidOctavePairs("G", "C");
    expect(pairs.length).toBeGreaterThan(0);

    // All pairs should have G higher in pitch than C
    for (const [gOctave, cOctave] of pairs) {
      expect(getNotePitch("G", gOctave)).toBeGreaterThan(getNotePitch("C", cOctave));
    }
  });

  it("excludes octave pairs more than 1 apart", () => {
    const pairs = getValidOctavePairs("G", "C");

    // No pairs should have octaves 3 and 5 together
    for (const [octaveA, octaveB] of pairs) {
      expect(Math.abs(octaveA - octaveB)).toBeLessThanOrEqual(1);
    }
  });

  it("works when higher note needs higher octave", () => {
    // C higher than G: C must be in higher octave to be higher pitch
    const pairs = getValidOctavePairs("C", "G");
    expect(pairs.length).toBeGreaterThan(0);

    // C4 (48) < G4 (55), but C5 (60) > G4 (55)
    // So valid pairs include C5-G4
    const hasC5G4 = pairs.some(([cOct, gOct]) => cOct === 5 && gOct === 4);
    expect(hasC5G4).toBe(true);
  });

  it("allows same octave when semitone relationship is correct", () => {
    // G4 > C4 (same octave)
    const pairs = getValidOctavePairs("G", "C");
    const hasSameOctave = pairs.some(([gOct, cOct]) => gOct === cOct);
    expect(hasSameOctave).toBe(true);
  });

  it("works for adjacent notes", () => {
    // D higher than C
    const pairs = getValidOctavePairs("D", "C");
    expect(pairs.length).toBeGreaterThan(0);

    // D4 > C4 should be valid
    expect(pairs).toContainEqual([4, 4]);
  });
});

describe("selectOctavesForPair", () => {
  it("returns a valid octave pair", () => {
    const result = selectOctavesForPair("G", "C");
    expect(result).not.toBeNull();

    if (result) {
      const [gOctave, cOctave] = result;
      expect(getNotePitch("G", gOctave)).toBeGreaterThan(getNotePitch("C", cOctave));
      expect(Math.abs(gOctave - cOctave)).toBeLessThanOrEqual(1);
    }
  });

  it("selects randomly from valid pairs", () => {
    const results = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const pair = selectOctavesForPair("G", "C");
      if (pair) {
        results.add(JSON.stringify(pair));
      }
    }

    // Should select multiple different valid pairs
    expect(results.size).toBeGreaterThan(1);
  });
});

// ============================================================================
// Variant-Based Progression System Tests
// ============================================================================

describe("makeVariantKey and parseVariantKey", () => {
  it("creates two-note variant keys correctly", () => {
    const key = makeVariantKey("C-G", "two-note", [4, 4]);
    expect(key).toBe("C-G:two-note:4-4");
  });

  it("sorts octaves in two-note variant keys", () => {
    const key1 = makeVariantKey("C-G", "two-note", [3, 4]);
    const key2 = makeVariantKey("C-G", "two-note", [4, 3]);
    expect(key1).toBe("C-G:two-note:3-4");
    expect(key2).toBe("C-G:two-note:3-4");
  });

  it("creates single-note variant keys correctly", () => {
    const key = makeVariantKey("C-G", "single-note", 4);
    expect(key).toBe("C-G:single-note:4");
  });

  it("parses two-note variant keys correctly", () => {
    const parsed = parseVariantKey("C-G:two-note:3-4");
    expect(parsed.pair).toBe("C-G");
    expect(parsed.questionType).toBe("two-note");
    expect(parsed.octaves).toEqual([3, 4]);
  });

  it("parses single-note variant keys correctly", () => {
    const parsed = parseVariantKey("C-G:single-note:4");
    expect(parsed.pair).toBe("C-G");
    expect(parsed.questionType).toBe("single-note");
    expect(parsed.octaves).toBe(4);
  });
});

describe("getAllTwoToneVariantsForPair and getAllSingleNoteVariantsForPair", () => {
  it("returns all two-tone variants for a pair", () => {
    const variants = getAllTwoToneVariantsForPair("C-G");
    expect(variants).toHaveLength(5);
    expect(variants).toContain("C-G:two-note:4-4");
    expect(variants).toContain("C-G:two-note:3-3");
    expect(variants).toContain("C-G:two-note:5-5");
    expect(variants).toContain("C-G:two-note:3-4");
    expect(variants).toContain("C-G:two-note:4-5");
  });

  it("returns all single-note variants for a pair", () => {
    const variants = getAllSingleNoteVariantsForPair("C-G");
    expect(variants).toHaveLength(3);
    expect(variants).toContain("C-G:single-note:4");
    expect(variants).toContain("C-G:single-note:3");
    expect(variants).toContain("C-G:single-note:5");
  });
});

describe("getInitialVariant", () => {
  it("returns octave 4 two-note variant", () => {
    expect(getInitialVariant("C-G")).toBe("C-G:two-note:4-4");
  });
});

describe("isVariantUnlocked and variant getters", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("isVariantUnlocked returns true for initial variant", () => {
    const state = loadState();
    expect(isVariantUnlocked(state, "C-G:two-note:4-4")).toBe(true);
  });

  it("isVariantUnlocked returns false for locked variant", () => {
    const state = loadState();
    expect(isVariantUnlocked(state, "C-G:two-note:3-3")).toBe(false);
  });

  it("getUnlockedVariantsForPair returns correct variants", () => {
    let state = loadState();
    state.unlockedVariants = ["C-G:two-note:4-4", "C-G:two-note:3-3", "C-E:two-note:4-4"];
    const variants = getUnlockedVariantsForPair(state, "C-G");
    expect(variants).toHaveLength(2);
    expect(variants).toContain("C-G:two-note:4-4");
    expect(variants).toContain("C-G:two-note:3-3");
  });

  it("getUnlockedTwoToneVariants filters correctly", () => {
    let state = loadState();
    state.unlockedVariants = ["C-G:two-note:4-4", "C-G:single-note:4"];
    const variants = getUnlockedTwoToneVariants(state);
    expect(variants).toHaveLength(1);
    expect(variants).toContain("C-G:two-note:4-4");
  });

  it("getUnlockedSingleNoteVariants filters correctly", () => {
    let state = loadState();
    state.unlockedVariants = ["C-G:two-note:4-4", "C-G:single-note:4"];
    const variants = getUnlockedSingleNoteVariants(state);
    expect(variants).toHaveLength(1);
    expect(variants).toContain("C-G:single-note:4");
  });
});

describe("getNextVariantToUnlock", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns next two-tone variant in order", () => {
    let state = loadState();
    // Only 4-4 is unlocked initially
    const next = getNextVariantToUnlock(state, "C-G");
    expect(next).toBe("C-G:two-note:3-3");
  });

  it("returns first single-note variant after all two-tone unlocked", () => {
    let state = loadState();
    state.unlockedVariants = [
      "C-G:two-note:4-4",
      "C-G:two-note:3-3",
      "C-G:two-note:5-5",
      "C-G:two-note:3-4",
      "C-G:two-note:4-5",
    ];
    const next = getNextVariantToUnlock(state, "C-G");
    expect(next).toBe("C-G:single-note:4");
  });

  it("returns null when all variants unlocked", () => {
    let state = loadState();
    state.unlockedVariants = [
      "C-G:two-note:4-4",
      "C-G:two-note:3-3",
      "C-G:two-note:5-5",
      "C-G:two-note:3-4",
      "C-G:two-note:4-5",
      "C-G:single-note:4",
      "C-G:single-note:3",
      "C-G:single-note:5",
    ];
    const next = getNextVariantToUnlock(state, "C-G");
    expect(next).toBeNull();
  });
});

describe("recordVariantResult", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("increments pair streak on correct answer", () => {
    let state = loadState();
    state = recordVariantResult(state, "C-G:two-note:4-4", true);
    expect(state.pairStreaks["C-G"]).toBe(1);
    state = recordVariantResult(state, "C-G:two-note:4-4", true);
    expect(state.pairStreaks["C-G"]).toBe(2);
  });

  it("tracks streak per pair, not per variant (different octaves count together)", () => {
    let state = loadState();
    // Start with both variants unlocked for testing
    state.unlockedVariants = ["C-G:two-note:4-4", "C-G:two-note:3-3"];

    // Get correct on different octave variants - should all count towards same pair streak
    state = recordVariantResult(state, "C-G:two-note:4-4", true);
    expect(state.pairStreaks["C-G"]).toBe(1);
    state = recordVariantResult(state, "C-G:two-note:3-3", true);
    expect(state.pairStreaks["C-G"]).toBe(2);
    state = recordVariantResult(state, "C-G:two-note:4-4", true);
    expect(state.pairStreaks["C-G"]).toBe(3);
  });

  it("resets pair streak on wrong answer", () => {
    let state = loadState();
    state.pairStreaks = { "C-G": 3 };
    state = recordVariantResult(state, "C-G:two-note:4-4", false);
    expect(state.pairStreaks["C-G"]).toBe(0);
  });

  it("unlocks next variant after PAIR_COMPLETION_STREAK correct", () => {
    let state = loadState();
    // Get 4 correct in a row (can be any octave combo)
    for (let i = 0; i < PAIR_COMPLETION_STREAK; i++) {
      state = recordVariantResult(state, "C-G:two-note:4-4", true);
    }
    // Should have unlocked the next variant (3-3)
    expect(state.unlockedVariants).toContain("C-G:two-note:3-3");
    // Pair streak should be reset to prevent continuous triggering
    expect(state.pairStreaks["C-G"]).toBe(0);
  });
});

describe("checkNoteUnlock", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("does nothing when cooldown not met", () => {
    let state = loadState();
    state.recentSingleNoteResults = Array(20).fill(true);
    state.questionsSinceLastUnlock = NOTE_UNLOCK_COOLDOWN - 1;
    const newState = checkNoteUnlock(state);
    expect(newState.learningVocabulary).toEqual(["C", "G"]);
  });

  it("does nothing with insufficient questions", () => {
    let state = loadState();
    state.recentSingleNoteResults = Array(5).fill(true);
    state.questionsSinceLastUnlock = NOTE_UNLOCK_COOLDOWN;
    const newState = checkNoteUnlock(state);
    expect(newState.learningVocabulary).toEqual(["C", "G"]);
  });

  it("does nothing with insufficient correct answers", () => {
    let state = loadState();
    // 16/20 correct (80%) - below threshold
    state.recentSingleNoteResults = [
      ...Array(16).fill(true),
      ...Array(4).fill(false),
    ];
    state.questionsSinceLastUnlock = NOTE_UNLOCK_COOLDOWN;
    const newState = checkNoteUnlock(state);
    expect(newState.learningVocabulary).toEqual(["C", "G"]);
  });

  it("unlocks next note when criteria met", () => {
    let state = loadState();
    // 18/20 correct (90%) - meets threshold
    state.recentSingleNoteResults = [
      ...Array(18).fill(true),
      ...Array(2).fill(false),
    ];
    state.questionsSinceLastUnlock = NOTE_UNLOCK_COOLDOWN;
    const newState = checkNoteUnlock(state);
    expect(newState.learningVocabulary).toContain("E");
    expect(newState.questionsSinceLastUnlock).toBe(0);
    // Should also add initial variants for new note
    expect(newState.unlockedVariants).toContain("C-E:two-note:4-4");
    expect(newState.unlockedVariants).toContain("E-G:two-note:4-4");
  });
});

describe("recordQuestion with variant tracking", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("tracks single-note results for note unlock", () => {
    let state = loadState();
    state = recordQuestion(state, {
      timestamp: Date.now(),
      questionType: "single-note",
      noteA: "C4",
      noteB: "",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: true,
      variantKey: "C-G:single-note:4",
    });
    expect(state.recentSingleNoteResults).toEqual([true]);
  });

  it("updates pair streak when variantKey provided", () => {
    let state = loadState();
    state = recordQuestion(state, {
      timestamp: Date.now(),
      questionType: "two-note",
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: true,
      variantKey: "C-G:two-note:4-4",
    });
    expect(state.pairStreaks["C-G"]).toBe(1);
  });

  it("does not update pair streak for retry (wasFirstInStreak=false)", () => {
    let state = loadState();
    state = recordQuestion(state, {
      timestamp: Date.now(),
      questionType: "two-note",
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: false,
      variantKey: "C-G:two-note:4-4",
    });
    expect(state.pairStreaks["C-G"]).toBeUndefined();
  });
});

describe("accelerated mode", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("tracks global correct streak", () => {
    let state = loadState();
    expect(state.globalCorrectStreak).toBe(0);

    // Get 3 correct in a row
    for (let i = 0; i < 3; i++) {
      state = recordQuestion(state, {
        timestamp: Date.now(),
        questionType: "two-note",
        noteA: "C4",
        noteB: "G4",
        targetNote: "C",
        otherNote: "G",
        correct: true,
        wasFirstInStreak: true,
        variantKey: "C-G:two-note:4-4",
      });
    }
    expect(state.globalCorrectStreak).toBe(3);

    // Wrong answer resets streak
    state = recordQuestion(state, {
      timestamp: Date.now(),
      questionType: "two-note",
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: false,
      wasFirstInStreak: true,
      variantKey: "C-G:two-note:4-4",
    });
    expect(state.globalCorrectStreak).toBe(0);
  });

  it("unlocks something on each correct answer when streak >= 10", () => {
    let state = loadState();
    const initialVariants = state.unlockedVariants.length;

    // Get to streak of 10
    for (let i = 0; i < 10; i++) {
      state = recordQuestion(state, {
        timestamp: Date.now(),
        questionType: "two-note",
        noteA: "C4",
        noteB: "G4",
        targetNote: "C",
        otherNote: "G",
        correct: true,
        wasFirstInStreak: true,
        variantKey: "C-G:two-note:4-4",
      });
    }

    // Should have unlocked something at streak 10
    expect(state.unlockedVariants.length).toBeGreaterThan(initialVariants);
    const variantsAt10 = state.unlockedVariants.length;

    // Another correct answer should unlock another thing
    state = recordQuestion(state, {
      timestamp: Date.now(),
      questionType: "two-note",
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: true,
      variantKey: "C-G:two-note:4-4",
    });
    expect(state.unlockedVariants.length).toBeGreaterThan(variantsAt10);
  });

  it("stops accelerated unlocking on wrong answer", () => {
    let state = loadState();

    // Get to streak of 10
    for (let i = 0; i < 10; i++) {
      state = recordQuestion(state, {
        timestamp: Date.now(),
        questionType: "two-note",
        noteA: "C4",
        noteB: "G4",
        targetNote: "C",
        otherNote: "G",
        correct: true,
        wasFirstInStreak: true,
        variantKey: "C-G:two-note:4-4",
      });
    }

    const variantsBeforeWrong = state.unlockedVariants.length;

    // Wrong answer
    state = recordQuestion(state, {
      timestamp: Date.now(),
      questionType: "two-note",
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: false,
      wasFirstInStreak: true,
      variantKey: "C-G:two-note:4-4",
    });

    expect(state.globalCorrectStreak).toBe(0);

    // Next correct answer shouldn't unlock (streak is only 1)
    state = recordQuestion(state, {
      timestamp: Date.now(),
      questionType: "two-note",
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: true,
      variantKey: "C-G:two-note:4-4",
    });
    expect(state.unlockedVariants.length).toBe(variantsBeforeWrong);
  });
});

// ============================================================================
// Ordering Question Tests
// ============================================================================

describe("getVocabInChromaticOrder", () => {
  it("sorts vocabulary in chromatic order", () => {
    expect(getVocabInChromaticOrder(["G", "C", "E"])).toEqual(["C", "E", "G"]);
    expect(getVocabInChromaticOrder(["A", "D", "G", "C"])).toEqual(["C", "D", "G", "A"]);
    expect(getVocabInChromaticOrder(["B", "F", "D"])).toEqual(["D", "F", "B"]);
  });

  it("handles single note", () => {
    expect(getVocabInChromaticOrder(["C"])).toEqual(["C"]);
  });

  it("handles all notes", () => {
    expect(getVocabInChromaticOrder(["B", "D", "F", "A", "C", "E", "G"])).toEqual([
      "C", "D", "E", "F", "G", "A", "B",
    ]);
  });
});

describe("shouldTriggerOrdering", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns false with fewer than 3 notes in vocabulary", () => {
    const state = loadState();
    expect(state.learningVocabulary).toEqual(["C", "G"]);
    expect(shouldTriggerOrdering(state)).toBe(false);
  });

  it("returns true when already in ordering mode", () => {
    let state = loadState();
    state.learningVocabulary = ["C", "G", "E"];
    state.isInOrderingMode = true;
    expect(shouldTriggerOrdering(state)).toBe(true);
  });

  it("returns true when interval reached", () => {
    let state = loadState();
    state.learningVocabulary = ["C", "G", "E"];
    state.orderingQuestionInterval = ORDERING_INTERVAL;
    expect(shouldTriggerOrdering(state)).toBe(true);
  });

  it("returns false when interval not reached", () => {
    let state = loadState();
    state.learningVocabulary = ["C", "G", "E"];
    state.orderingQuestionInterval = ORDERING_INTERVAL - 1;
    expect(shouldTriggerOrdering(state)).toBe(false);
  });

  it("returns true when struggling (< 50% on last 10)", () => {
    let state = loadState();
    state.learningVocabulary = ["C", "G", "E"];
    // Create history with < 50% correct
    for (let i = 0; i < ORDERING_STRUGGLE_WINDOW; i++) {
      state.history.push({
        timestamp: Date.now(),
        noteA: "C4",
        noteB: "G4",
        targetNote: "C",
        otherNote: "G",
        correct: i < 4, // Only 4/10 correct = 40%
        wasFirstInStreak: true,
      });
    }
    expect(shouldTriggerOrdering(state)).toBe(true);
  });

  it("returns false when not struggling", () => {
    let state = loadState();
    state.learningVocabulary = ["C", "G", "E"];
    // Create history with >= 50% correct
    for (let i = 0; i < ORDERING_STRUGGLE_WINDOW; i++) {
      state.history.push({
        timestamp: Date.now(),
        noteA: "C4",
        noteB: "G4",
        targetNote: "C",
        otherNote: "G",
        correct: i < 6, // 6/10 correct = 60%
        wasFirstInStreak: true,
      });
    }
    expect(shouldTriggerOrdering(state)).toBe(false);
  });
});

describe("recordOrderingResult", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("tracks ordering performance", () => {
    let state = loadState();
    expect(state.orderingPerformance).toEqual([]);

    state = recordOrderingResult(state, true);
    expect(state.orderingPerformance).toEqual([true]);

    state = recordOrderingResult(state, false);
    expect(state.orderingPerformance).toEqual([true, false]);
  });

  it("resets ordering interval", () => {
    let state = loadState();
    state.orderingQuestionInterval = 30;

    state = recordOrderingResult(state, true);
    expect(state.orderingQuestionInterval).toBe(0);
  });

  it("increments correct streak on correct answer", () => {
    let state = loadState();
    expect(state.orderingCorrectStreak).toBe(0);

    state = recordOrderingResult(state, true);
    expect(state.orderingCorrectStreak).toBe(1);

    state = recordOrderingResult(state, true);
    expect(state.orderingCorrectStreak).toBe(2);
  });

  it("resets streak and enters ordering mode on wrong answer", () => {
    let state = loadState();
    state.orderingCorrectStreak = 2;

    state = recordOrderingResult(state, false);
    expect(state.orderingCorrectStreak).toBe(0);
    expect(state.isInOrderingMode).toBe(true);
  });

  it("exits ordering mode after 3 correct in a row", () => {
    let state = loadState();
    state.isInOrderingMode = true;

    for (let i = 0; i < ORDERING_EXIT_STREAK; i++) {
      state = recordOrderingResult(state, true);
    }

    expect(state.isInOrderingMode).toBe(false);
    expect(state.orderingCorrectStreak).toBe(0);
  });

  it("stays in ordering mode until 3 correct in a row", () => {
    let state = loadState();
    state.isInOrderingMode = true;

    // 2 correct, then 1 wrong
    state = recordOrderingResult(state, true);
    state = recordOrderingResult(state, true);
    state = recordOrderingResult(state, false);

    expect(state.isInOrderingMode).toBe(true);
    expect(state.orderingCorrectStreak).toBe(0);
  });
});

describe("enterOrderingMode", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("sets isInOrderingMode to true", () => {
    let state = loadState();
    expect(state.isInOrderingMode).toBe(false);

    state = enterOrderingMode(state);
    expect(state.isInOrderingMode).toBe(true);
  });
});

describe("incrementOrderingInterval", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("increments the ordering question interval", () => {
    let state = loadState();
    expect(state.orderingQuestionInterval).toBe(0);

    state = incrementOrderingInterval(state);
    expect(state.orderingQuestionInterval).toBe(1);

    state = incrementOrderingInterval(state);
    expect(state.orderingQuestionInterval).toBe(2);
  });
});
