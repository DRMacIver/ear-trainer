import { describe, it, expect, beforeEach } from "vitest";
import {
  loadState,
  saveState,
  clearState,
  recordQuestion,
  updateStreak,
  randomizeOrder,
  selectTargetNote,
  selectOtherNote,
  isFamiliarWith,
  isNoteFamiliar,
  getAdjacentNotes,
  getAdjacentNotesInVocabulary,
  getAdjacentVocabPairs,
  getNoteDistance,
  getNextNoteToLearn,
  getClosestVocabularyNotes,
  isCandidateReadyByStreak,
  maybeStartNewSession,
  getRepeatProbability,
  recordPairReview,
  selectMostUrgentPair,
  isReadyForSingleNote,
  isPairReadyForSingleNote,
  isSingleNoteFamiliarWith,
  isSingleNotePairFamiliar,
  getReadySingleNotePairs,
  areAllVocabSingleNotesFamiliar,
  selectSingleNotePair,
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

  it("increments questionsSinceLastIntroduction", () => {
    let state = loadState();
    expect(state.questionsSinceLastIntroduction).toBe(0);

    state = recordQuestion(state, {
      timestamp: Date.now(),
      noteA: "C4",
      noteB: "G4",
      targetNote: "C",
      otherNote: "G",
      correct: true,
      wasFirstInStreak: true,
    });

    expect(state.questionsSinceLastIntroduction).toBe(1);
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

describe("selectOtherNote", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("selects a different note than target", () => {
    const state = loadState();
    const other = selectOtherNote(state, "C");
    expect(other).not.toBe("C");
  });

  it("selects from FULL_TONES", () => {
    const state = loadState();
    const other = selectOtherNote(state, "C");
    expect(FULL_TONES).toContain(other);
  });
});

describe("isFamiliarWith", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns false with insufficient data", () => {
    const state = loadState();
    expect(isFamiliarWith(state, "C", "D")).toBe(false);
  });

  it("returns true when recent performance is good", () => {
    let state = loadState();
    // Need 4 samples with at least 3 correct
    state.performance = {
      C: {
        D: [true, true, true, true],
      },
    };
    expect(isFamiliarWith(state, "C", "D")).toBe(true);
  });

  it("returns false when recent performance is poor", () => {
    let state = loadState();
    state.performance = {
      C: {
        D: [false, false, true, false],
      },
    };
    expect(isFamiliarWith(state, "C", "D")).toBe(false);
  });
});

describe("isNoteFamiliar", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns false when not familiar with adjacent notes", () => {
    const state = loadState();
    expect(isNoteFamiliar(state, "D")).toBe(false);
  });

  it("returns true when familiar with both adjacent notes", () => {
    let state = loadState();
    // D is adjacent to C and E
    state.performance = {
      D: {
        C: [true, true, true, true],
        E: [true, true, true, true],
      },
    };
    expect(isNoteFamiliar(state, "D")).toBe(true);
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

describe("isCandidateReadyByStreak", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns false when no streak data", () => {
    const state = loadState();
    expect(isCandidateReadyByStreak(state, "E")).toBe(false);
  });

  it("returns false when streaks are insufficient", () => {
    let state = loadState();
    state.candidateStreaks = {
      "C-E": 3,
      "G-E": 2,
    };
    expect(isCandidateReadyByStreak(state, "E")).toBe(false);
  });

  it("returns true when both closest notes have sufficient streaks", () => {
    let state = loadState();
    state.candidateStreaks = {
      "C-E": 5,
      "G-E": 5,
    };
    expect(isCandidateReadyByStreak(state, "E")).toBe(true);
  });
});

describe("Note introduction triggers", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  const mockPickOctave = () => 4;

  // Helper to set up state where C and G are ready for single-note questions
  // and familiar with single-note identification (vocab neighbors)
  function setupSingleNoteReady(state: ReturnType<typeof loadState>) {
    // C and G need to be familiar with each other in two-note mode
    // to be "ready" for single-note questions
    state.performance = {
      C: {
        G: [true, true, true, true],
      },
      G: {
        C: [true, true, true, true],
      },
    };
    // Single-note familiarity with vocab neighbors gates NOTE INTRODUCTION
    // For vocab ["C", "G"], C's vocab neighbor is G and vice versa
    state.singleNotePerformance = {
      C: { G: [true, true, true, true] },
      G: { C: [true, true, true, true] },
    };
    return state;
  }

  it("introduces note when streak threshold is met", () => {
    let state = loadState();
    setupSingleNoteReady(state);
    // Set up E as the next candidate with sufficient streaks
    state.candidateStreaks = {
      "C-E": 5,
      "G-E": 5,
    };
    state.correctStreak = STREAK_LENGTH; // Trigger new target selection

    const [, , , , , introducedNote] = selectTargetNote(state, mockPickOctave);
    expect(introducedNote).toBe("E");
  });

  it("introduces note after MAX_QUESTIONS_WITHOUT_INTRODUCTION", () => {
    let state = loadState();
    setupSingleNoteReady(state);
    state.questionsSinceLastIntroduction = 30;
    state.correctStreak = STREAK_LENGTH; // Trigger new target selection

    const [, , , , updatedState, introducedNote] = selectTargetNote(
      state,
      mockPickOctave
    );
    expect(introducedNote).toBe("E"); // Next in LEARNING_ORDER after C, G
    expect(updatedState.questionsSinceLastIntroduction).toBe(0);
  });

  it("resets candidate streaks when note is introduced", () => {
    let state = loadState();
    setupSingleNoteReady(state);
    state.candidateStreaks = {
      "C-E": 5,
      "G-E": 5,
    };
    state.correctStreak = STREAK_LENGTH;

    const [, , , , updatedState,] = selectTargetNote(state, mockPickOctave);
    expect(updatedState.candidateStreaks).toEqual({});
  });

  it("sets target to introduced note when a new note is introduced", () => {
    let state = loadState();
    setupSingleNoteReady(state);
    // Set up E as the next candidate with sufficient streaks
    state.candidateStreaks = {
      "C-E": 5,
      "G-E": 5,
    };
    state.correctStreak = STREAK_LENGTH; // Trigger new target selection

    const [target, , , , , introducedNote] = selectTargetNote(
      state,
      mockPickOctave
    );
    expect(introducedNote).toBe("E");
    // Target should be the introduced note, not randomly selected
    expect(target).toBe("E");
  });

  it("sets target to introduced note when introduced by time threshold", () => {
    let state = loadState();
    setupSingleNoteReady(state);
    state.questionsSinceLastIntroduction = 30;
    state.correctStreak = STREAK_LENGTH;

    const [target, , , , , introducedNote] = selectTargetNote(
      state,
      mockPickOctave
    );
    expect(introducedNote).toBe("E");
    expect(target).toBe("E");
  });

  it("does not introduce second note too quickly after first", () => {
    let state = loadState();
    setupSingleNoteReady(state);
    // Introduce E first
    state.candidateStreaks = {
      "C-E": 5,
      "G-E": 5,
    };
    state.correctStreak = STREAK_LENGTH;

    const [, , , , updatedState, introducedNote] = selectTargetNote(
      state,
      mockPickOctave
    );
    expect(introducedNote).toBe("E");
    expect(updatedState.learningVocabulary).toEqual(["C", "G", "E"]);
    expect(updatedState.candidateStreaks).toEqual({});
    expect(updatedState.questionsSinceLastIntroduction).toBe(0);

    // Now simulate getting 3 correct on E and selecting next target
    let state2 = { ...updatedState, correctStreak: STREAK_LENGTH };

    // Next note to learn is A
    const nextNote = getNextNoteToLearn(state2);
    expect(nextNote).toBe("A");

    // Should NOT introduce A yet - candidateStreaks is empty,
    // questionsSinceLastIntroduction is 0, and E isn't familiar with adjacent yet
    const [, , , , updatedState2, introducedNote2] = selectTargetNote(
      state2,
      mockPickOctave
    );

    expect(introducedNote2).toBeNull();
    expect(updatedState2.learningVocabulary).toEqual(["C", "G", "E"]);
  });

  it("requires new streaks to be built for second introduction", () => {
    let state = loadState();
    // Start with E already introduced
    state.learningVocabulary = ["C", "G", "E"];
    state.candidateStreaks = {}; // Reset after E was introduced
    state.questionsSinceLastIntroduction = 0;
    state.correctStreak = STREAK_LENGTH;
    // Set up all pairs as familiar in two-note mode (so ready for single-note)
    state.performance = {
      C: {
        G: [true, true, true, true],
        E: [true, true, true, true],
      },
      G: {
        C: [true, true, true, true],
        E: [true, true, true, true],
      },
      E: {
        C: [true, true, true, true],
        G: [true, true, true, true],
      },
    };
    // Single-note familiar with vocab neighbors
    state.singleNotePerformance = {
      C: { G: [true, true, true, true], E: [true, true, true, true] },
      G: { C: [true, true, true, true], E: [true, true, true, true] },
      E: { C: [true, true, true, true], G: [true, true, true, true] },
    };

    // A is the next candidate, closest vocab notes are G (distance 1) and E (distance 3)
    // Need streaks for G-A and E-A (or C-A depending on distance calculation)

    // Without sufficient streaks, A should not be introduced
    const [, , , , , introducedNote] = selectTargetNote(state, mockPickOctave);
    expect(introducedNote).toBeNull();

    // Now add streaks for A against its two closest notes
    // A is between G and B in FULL_TONES. Closest in vocab are G (1) and C (2).
    state.candidateStreaks = {
      "G-A": 5,
      "C-A": 5,
    };

    const [, , , , , introducedNote2] = selectTargetNote(state, mockPickOctave);
    expect(introducedNote2).toBe("A");
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

describe("loadState migration", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("adds default pairCards and session for old state", () => {
    // Simulate old state without pairCards or session
    const oldState = {
      history: [],
      lastPlayedAt: Date.now() - 60000,
      learningVocabulary: ["C", "G", "E"],
      performance: {},
      currentTarget: "E",
      currentTargetOctave: 4,
      correctStreak: 2,
      isFirstOnTarget: false,
      candidateStreaks: {},
      questionsSinceLastIntroduction: 5,
    };
    localStorageMock.setItem("tone-quiz-state", JSON.stringify(oldState));

    const loaded = loadState();

    expect(loaded.pairCards).toEqual({});
    expect(loaded.session).toBeDefined();
    expect(loaded.session.sessionStartTime).toBeDefined();
    // previousSessionEnd should be set to lastPlayedAt for migration
    expect(loaded.session.previousSessionEnd).toBe(oldState.lastPlayedAt);
  });
});

describe("Single-note question functions", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe("isReadyForSingleNote", () => {
    it("returns false when note is not familiar with adjacent notes", () => {
      const state = loadState();
      expect(isReadyForSingleNote(state, "C")).toBe(false);
    });

    it("returns true when note is familiar with both adjacent notes", () => {
      let state = loadState();
      // C is adjacent to B and D
      state.performance = {
        C: {
          B: [true, true, true, true],
          D: [true, true, true, true],
        },
      };
      expect(isReadyForSingleNote(state, "C")).toBe(true);
    });
  });

  describe("isPairReadyForSingleNote", () => {
    it("returns false when pair is not familiar in either direction", () => {
      const state = loadState();
      expect(isPairReadyForSingleNote(state, "C", "G")).toBe(false);
    });

    it("returns false when only one direction is familiar", () => {
      let state = loadState();
      // Only C -> G is familiar, not G -> C
      state.performance = {
        C: {
          G: [true, true, true, true],
        },
      };
      expect(isPairReadyForSingleNote(state, "C", "G")).toBe(false);
    });

    it("returns true when pair is familiar in both directions", () => {
      let state = loadState();
      // C and G are familiar with each other in two-note mode
      state.performance = {
        C: {
          G: [true, true, true, true],
        },
        G: {
          C: [true, true, true, true],
        },
      };
      expect(isPairReadyForSingleNote(state, "C", "G")).toBe(true);
    });
  });

  describe("isSingleNoteFamiliarWith", () => {
    it("returns false with no data", () => {
      const state = loadState();
      expect(isSingleNoteFamiliarWith(state, "C", "G")).toBe(false);
    });

    it("returns false with insufficient data", () => {
      let state = loadState();
      state.singleNotePerformance = {
        C: { G: [true, true] }, // Only 2 samples, need 4
      };
      expect(isSingleNoteFamiliarWith(state, "C", "G")).toBe(false);
    });

    it("returns true with good performance", () => {
      let state = loadState();
      state.singleNotePerformance = {
        C: { G: [true, true, true, true] },
      };
      expect(isSingleNoteFamiliarWith(state, "C", "G")).toBe(true);
    });

    it("returns false with poor performance", () => {
      let state = loadState();
      state.singleNotePerformance = {
        C: { G: [false, false, true, false] },
      };
      expect(isSingleNoteFamiliarWith(state, "C", "G")).toBe(false);
    });
  });

  describe("isSingleNotePairFamiliar", () => {
    it("returns false when neither direction is familiar", () => {
      const state = loadState();
      expect(isSingleNotePairFamiliar(state, "C", "G")).toBe(false);
    });

    it("returns false when only one direction is familiar", () => {
      let state = loadState();
      state.singleNotePerformance = {
        C: { G: [true, true, true, true] },
        // G -> C is missing
      };
      expect(isSingleNotePairFamiliar(state, "C", "G")).toBe(false);
    });

    it("returns true when both directions are familiar", () => {
      let state = loadState();
      state.singleNotePerformance = {
        C: { G: [true, true, true, true] },
        G: { C: [true, true, true, true] },
      };
      expect(isSingleNotePairFamiliar(state, "C", "G")).toBe(true);
    });
  });

  describe("getReadySingleNotePairs", () => {
    it("returns empty array when no pairs are ready", () => {
      const state = loadState();
      expect(getReadySingleNotePairs(state)).toEqual([]);
    });

    it("returns pairs where both notes are familiar with each other", () => {
      let state = loadState();
      state.learningVocabulary = ["C", "G"];
      // C and G are familiar with each other in two-note mode
      state.performance = {
        C: {
          G: [true, true, true, true],
        },
        G: {
          C: [true, true, true, true],
        },
      };
      const pairs = getReadySingleNotePairs(state);
      expect(pairs.length).toBe(1);
      expect(pairs[0]).toEqual(["C", "G"]);
    });
  });

  describe("areAllVocabSingleNotesFamiliar", () => {
    it("returns true for single-note vocabulary", () => {
      let state = loadState();
      state.learningVocabulary = ["C"];
      expect(areAllVocabSingleNotesFamiliar(state)).toBe(true);
    });

    it("returns false when vocab neighbor pair is not single-note familiar", () => {
      let state = loadState();
      state.learningVocabulary = ["C", "G"];
      // C's vocab neighbor is G, G's vocab neighbor is C
      // No single-note performance data, so not familiar
      expect(areAllVocabSingleNotesFamiliar(state)).toBe(false);
    });

    it("returns true when vocab neighbor pairs are single-note familiar", () => {
      let state = loadState();
      state.learningVocabulary = ["C", "G"];
      // C's vocab neighbor is G, need C-G and G-C single-note familiar
      state.singleNotePerformance = {
        C: { G: [true, true, true, true] },
        G: { C: [true, true, true, true] },
      };
      expect(areAllVocabSingleNotesFamiliar(state)).toBe(true);
    });

    it("returns false when only one direction is familiar", () => {
      let state = loadState();
      state.learningVocabulary = ["C", "G"];
      state.singleNotePerformance = {
        C: { G: [true, true, true, true] },
        // G -> C is missing
      };
      expect(areAllVocabSingleNotesFamiliar(state)).toBe(false);
    });

    it("checks all vocab neighbors in larger vocabulary", () => {
      let state = loadState();
      state.learningVocabulary = ["C", "G", "E"];
      // For three notes, each has two neighbors:
      // C: neighbors are G (down) and E (up)
      // G: neighbors are E (down) and C (up)
      // E: neighbors are C (down) and G (up)
      // So we need C-G, C-E, G-C, G-E, E-C, E-G all familiar

      // Only C-G familiar, not others
      state.singleNotePerformance = {
        C: { G: [true, true, true, true] },
        G: { C: [true, true, true, true] },
      };
      expect(areAllVocabSingleNotesFamiliar(state)).toBe(false);

      // Add all pairs
      state.singleNotePerformance = {
        C: {
          G: [true, true, true, true],
          E: [true, true, true, true],
        },
        G: {
          C: [true, true, true, true],
          E: [true, true, true, true],
        },
        E: {
          C: [true, true, true, true],
          G: [true, true, true, true],
        },
      };
      expect(areAllVocabSingleNotesFamiliar(state)).toBe(true);
    });
  });

  describe("selectSingleNotePair", () => {
    it("returns null when no pairs are ready", () => {
      const state = loadState();
      expect(selectSingleNotePair(state)).toBeNull();
    });

    it("returns a pair when pairs are ready", () => {
      let state = loadState();
      state.learningVocabulary = ["C", "G"];
      // C and G are familiar with each other in two-note mode
      state.performance = {
        C: {
          G: [true, true, true, true],
        },
        G: {
          C: [true, true, true, true],
        },
      };
      const pair = selectSingleNotePair(state);
      expect(pair).not.toBeNull();
      expect(pair!.noteA).toBe("C");
      expect(pair!.noteB).toBe("G");
    });

    it("prioritizes unfamiliar adjacent pairs", () => {
      let state = loadState();
      // Larger vocab with multiple pairs
      state.learningVocabulary = ["C", "D", "G"];
      // All pairs familiar in two-note mode (so all pairs are ready)
      state.performance = {
        C: {
          D: [true, true, true, true],
          G: [true, true, true, true],
        },
        D: {
          C: [true, true, true, true],
          G: [true, true, true, true],
        },
        G: {
          C: [true, true, true, true],
          D: [true, true, true, true],
        },
      };
      // C-G is already familiar for single-note, but C-D (adjacent) is not
      state.singleNotePerformance = {
        C: { G: [true, true, true, true] },
        G: { C: [true, true, true, true] },
      };

      // Should prefer C-D or D-G (adjacent and unfamiliar) over C-G
      const results = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const pair = selectSingleNotePair(state);
        if (pair) {
          results.add([pair.noteA, pair.noteB].sort().join("-"));
        }
      }

      // Should never select C-G since it's already familiar
      // and there are unfamiliar adjacent pairs available
      expect(results.has("C-G")).toBe(false);
      // Should select C-D and/or D-G (adjacent unfamiliar pairs)
      expect(results.has("C-D") || results.has("D-G")).toBe(true);
    });
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
});

describe("Note introduction gates on single-note familiarity", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  const mockPickOctave = () => 4;

  it("does not introduce note when vocab neighbors not single-note familiar", () => {
    let state = loadState();
    state.learningVocabulary = ["C", "G"];
    // Set up E as ready by streak
    state.candidateStreaks = {
      "C-E": 5,
      "G-E": 5,
    };
    state.correctStreak = STREAK_LENGTH;
    // No single-note performance data - vocab neighbors not familiar

    const [, , , , , introducedNote] = selectTargetNote(state, mockPickOctave);
    expect(introducedNote).toBeNull();
  });

  it("does not introduce note when only one direction is familiar", () => {
    let state = loadState();
    state.learningVocabulary = ["C", "G"];
    state.candidateStreaks = {
      "C-E": 5,
      "G-E": 5,
    };
    state.correctStreak = STREAK_LENGTH;
    // Only C -> G is familiar, not G -> C
    state.singleNotePerformance = {
      C: { G: [true, true, true, true] },
    };

    const [, , , , , introducedNote] = selectTargetNote(state, mockPickOctave);
    expect(introducedNote).toBeNull();
  });

  it("introduces note when vocab neighbor pair is single-note familiar", () => {
    let state = loadState();
    state.learningVocabulary = ["C", "G"];
    state.candidateStreaks = {
      "C-E": 5,
      "G-E": 5,
    };
    state.correctStreak = STREAK_LENGTH;
    // C and G are single-note familiar with each other (vocab neighbors)
    state.singleNotePerformance = {
      C: { G: [true, true, true, true] },
      G: { C: [true, true, true, true] },
    };

    const [, , , , , introducedNote] = selectTargetNote(state, mockPickOctave);
    expect(introducedNote).toBe("E");
  });

  it("gates on all vocab neighbor pairs for larger vocabulary", () => {
    let state = loadState();
    state.learningVocabulary = ["C", "G", "E"];
    state.candidateStreaks = {
      "C-A": 5,
      "G-A": 5,
    };
    state.correctStreak = STREAK_LENGTH;

    // Only C-G familiar, but E also has neighbors
    state.singleNotePerformance = {
      C: { G: [true, true, true, true] },
      G: { C: [true, true, true, true] },
    };

    const [, , , , , introducedNote] = selectTargetNote(state, mockPickOctave);
    expect(introducedNote).toBeNull(); // E's neighbors not familiar

    // Add all vocab neighbor pairs
    state.singleNotePerformance = {
      C: {
        G: [true, true, true, true],
        E: [true, true, true, true],
      },
      G: {
        C: [true, true, true, true],
        E: [true, true, true, true],
      },
      E: {
        C: [true, true, true, true],
        G: [true, true, true, true],
      },
    };

    const [, , , , , introducedNote2] = selectTargetNote(state, mockPickOctave);
    expect(introducedNote2).toBe("A");
  });
});
