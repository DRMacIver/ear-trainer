import { describe, it, expect, beforeEach } from "vitest";
import {
  ALL_FREQUENCIES,
  loadState,
  saveState,
  getIntroducedFrequencies,
  getNewFrequencies,
  getDueCards,
  selectSessionCards,
  recordReview,
  incrementSessionCount,
  getStats,
  clearAllProgress,
} from "../src/lib/freq-memory.js";
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

describe("ALL_FREQUENCIES", () => {
  it("contains 21 frequencies from 100Hz to 1100Hz in 50Hz steps", () => {
    expect(ALL_FREQUENCIES.length).toBe(21);
    expect(ALL_FREQUENCIES[0]).toBe(100);
    expect(ALL_FREQUENCIES[20]).toBe(1100);
    expect(ALL_FREQUENCIES[10]).toBe(600); // Middle frequency
  });

  it("has consistent 50Hz intervals", () => {
    for (let i = 1; i < ALL_FREQUENCIES.length; i++) {
      expect(ALL_FREQUENCIES[i] - ALL_FREQUENCIES[i - 1]).toBe(50);
    }
  });
});

describe("loadState / saveState", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns initial state when nothing saved", () => {
    const state = loadState();
    expect(state.cards.length).toBe(21);
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
    localStorageMock.setItem("ear-trainer:freq-memory", "invalid json");
    const state = loadState();
    expect(state.cards.length).toBe(21);
  });
});

describe("getIntroducedFrequencies / getNewFrequencies", () => {
  it("all frequencies are new initially", () => {
    const state = loadState();
    expect(getIntroducedFrequencies(state)).toEqual([]);
    expect(getNewFrequencies(state).length).toBe(21);
  });

  it("tracks introduced frequencies after review", () => {
    let state = loadState();
    state = recordReview(state, 100, Grade.GOOD);
    state = recordReview(state, 550, Grade.GOOD);

    expect(getIntroducedFrequencies(state)).toContain(100);
    expect(getIntroducedFrequencies(state)).toContain(550);
    expect(getIntroducedFrequencies(state).length).toBe(2);
    expect(getNewFrequencies(state).length).toBe(19);
  });
});

describe("selectSessionCards", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("first session introduces 100, 550, 1100", () => {
    const state = loadState();
    const session = selectSessionCards(state);

    expect(session.isFirstSession).toBe(true);
    expect(session.newCards).toEqual([100, 550, 1100]);
    expect(session.reviewCards).toEqual([]);
    expect(session.isComplete).toBe(false);
  });

  it("second session introduces 2 new cards and reviews", () => {
    let state = loadState();
    // Simulate first session completion
    state = recordReview(state, 100, Grade.GOOD);
    state = recordReview(state, 550, Grade.GOOD);
    state = recordReview(state, 1100, Grade.GOOD);
    state = incrementSessionCount(state);

    const session = selectSessionCards(state);

    expect(session.isFirstSession).toBe(false);
    expect(session.newCards.length).toBe(2);
    expect(session.reviewCards.length).toBeGreaterThanOrEqual(1);
    expect(session.splittingCard).not.toBeNull();
  });

  it("marks session complete when all frequencies introduced", () => {
    let state = loadState();
    // Introduce all frequencies
    for (const freq of ALL_FREQUENCIES) {
      state = recordReview(state, freq, Grade.GOOD);
    }

    const session = selectSessionCards(state);
    expect(session.isComplete).toBe(true);
    expect(session.newCards).toEqual([]);
  });
});

describe("recordReview", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("introduces new card on first review", () => {
    let state = loadState();
    const freq = 100;

    state = recordReview(state, freq, Grade.GOOD);

    const card = state.cards.find((c) => c.frequency === freq);
    expect(card?.card).not.toBeNull();
    expect(card?.reviewCount).toBe(1);
    expect(card?.lastReviewedAt).not.toBeNull();
  });

  it("records review history", () => {
    let state = loadState();
    state = recordReview(state, 100, Grade.GOOD);
    state = recordReview(state, 100, Grade.HARD);

    expect(state.history.length).toBe(2);
    expect(state.history[0].grade).toBe(Grade.GOOD);
    expect(state.history[0].wasNew).toBe(true);
    expect(state.history[1].grade).toBe(Grade.HARD);
    expect(state.history[1].wasNew).toBe(false);
  });

  it("stores guess history when provided", () => {
    let state = loadState();
    state = recordReview(state, 100, Grade.AGAIN, {
      guessHistory: [150, 200],
    });

    expect(state.history[0].guessHistory).toEqual([150, 200]);
  });

  it("stores timing data when provided", () => {
    let state = loadState();
    state = recordReview(state, 100, Grade.GOOD, {
      timeMs: 5000,
      replayTimesMs: [1000, 2500],
    });

    expect(state.history[0].timeMs).toBe(5000);
    expect(state.history[0].replayTimesMs).toEqual([1000, 2500]);
  });

  it("omits empty arrays from history", () => {
    let state = loadState();
    state = recordReview(state, 100, Grade.GOOD, {
      guessHistory: [],
      replayTimesMs: [],
    });

    expect(state.history[0].guessHistory).toBeUndefined();
    expect(state.history[0].replayTimesMs).toBeUndefined();
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
    // Introduce three cards
    state = recordReview(state, 100, Grade.GOOD);
    state = recordReview(state, 550, Grade.AGAIN); // Harder = more urgent
    state = recordReview(state, 1100, Grade.EASY); // Easier = less urgent

    const due = getDueCards(state);
    expect(due.length).toBe(3);
    // AGAIN should be more urgent than EASY
    const againIndex = due.findIndex((c) => c.frequency === 550);
    const easyIndex = due.findIndex((c) => c.frequency === 1100);
    expect(againIndex).toBeLessThan(easyIndex);
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

    expect(stats.introduced).toBe(0);
    expect(stats.total).toBe(21);
    expect(stats.sessionsCompleted).toBe(0);
    expect(stats.totalReviews).toBe(0);
  });

  it("tracks progress correctly", () => {
    let state = loadState();
    state = recordReview(state, 100, Grade.GOOD);
    state = recordReview(state, 550, Grade.GOOD);
    state = recordReview(state, 100, Grade.HARD); // Review again
    state = incrementSessionCount(state);

    const stats = getStats(state);
    expect(stats.introduced).toBe(2);
    expect(stats.totalReviews).toBe(3);
    expect(stats.sessionsCompleted).toBe(1);
  });
});

describe("clearAllProgress", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("removes stored state", () => {
    let state = loadState();
    state = recordReview(state, 100, Grade.GOOD);
    saveState(state);

    // Verify it was saved
    expect(loadState().history.length).toBe(1);

    clearAllProgress();

    // Should be back to initial state
    const cleared = loadState();
    expect(cleared.history.length).toBe(0);
    expect(getIntroducedFrequencies(cleared).length).toBe(0);
  });
});

describe("session card selection edge cases", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("handles nearly complete state (1 card left)", () => {
    let state = loadState();
    // Introduce all but one frequency
    for (const freq of ALL_FREQUENCIES.slice(0, -1)) {
      state = recordReview(state, freq, Grade.GOOD);
    }

    const session = selectSessionCards(state);
    expect(session.newCards.length).toBe(1);
    expect(session.newCards[0]).toBe(1100); // Last one
    expect(session.isComplete).toBe(false);
  });

  it("provides review cards when all introduced", () => {
    let state = loadState();
    for (const freq of ALL_FREQUENCIES) {
      state = recordReview(state, freq, Grade.GOOD);
    }

    const session = selectSessionCards(state);
    expect(session.isComplete).toBe(true);
    expect(session.reviewCards.length).toBeGreaterThan(0);
  });
});
