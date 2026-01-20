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
  getNoteDistance,
  getNextNoteToLearn,
  getClosestVocabularyNotes,
  isCandidateReadyByStreak,
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

  it("introduces note when streak threshold is met", () => {
    let state = loadState();
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
    state.candidateStreaks = {
      "C-E": 5,
      "G-E": 5,
    };
    state.correctStreak = STREAK_LENGTH;

    const [, , , , updatedState,] = selectTargetNote(state, mockPickOctave);
    expect(updatedState.candidateStreaks).toEqual({});
  });
});
