import { describe, it, expect, beforeEach } from "vitest";
import {
  ALL_MAPPINGS,
  INTRODUCTION_ORDER,
  loadState,
  saveState,
  getIntroducedNotes,
  getNewNotes,
  getDueCards,
  selectSessionCards,
  recordReview,
  incrementSessionCount,
  getStats,
  clearAllProgress,
  getFrequencyForNote,
  getNearbyNotes,
  getNearbyFrequencies,
} from "../src/lib/note-freq-memory.js";
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

describe("ALL_MAPPINGS", () => {
  it("contains 36 note-frequency mappings (3 octaves × 12 notes)", () => {
    expect(ALL_MAPPINGS.length).toBe(36);
  });

  it("starts with C3 and ends with B5", () => {
    expect(ALL_MAPPINGS[0].note).toBe("C3");
    expect(ALL_MAPPINGS[35].note).toBe("B5");
  });

  it("includes A4 at 440Hz", () => {
    const a4 = ALL_MAPPINGS.find((m) => m.note === "A4");
    expect(a4?.frequency).toBe(440);
  });

  it("has frequencies rounded to nearest Hz", () => {
    for (const mapping of ALL_MAPPINGS) {
      expect(Number.isInteger(mapping.frequency)).toBe(true);
    }
  });

  it("has frequencies in ascending order", () => {
    for (let i = 1; i < ALL_MAPPINGS.length; i++) {
      expect(ALL_MAPPINGS[i].frequency).toBeGreaterThan(
        ALL_MAPPINGS[i - 1].frequency
      );
    }
  });

  it("covers octaves 3, 4, and 5", () => {
    const octaves = new Set(ALL_MAPPINGS.map((m) => m.octave));
    expect(octaves).toEqual(new Set([3, 4, 5]));
  });
});

describe("INTRODUCTION_ORDER", () => {
  it("contains all 36 notes", () => {
    expect(INTRODUCTION_ORDER.length).toBe(36);
    const notes = new Set(INTRODUCTION_ORDER);
    expect(notes.size).toBe(36);
  });

  it("starts with octave 4 non-sharps (C4, A4, F4)", () => {
    expect(INTRODUCTION_ORDER[0]).toBe("C4");
    expect(INTRODUCTION_ORDER[1]).toBe("A4");
    expect(INTRODUCTION_ORDER[2]).toBe("F4");
  });

  it("introduces octave 4 non-sharps before sharps", () => {
    const nonSharps = ["C4", "A4", "F4", "D4", "G4", "B4", "E4"];
    const sharps = ["C#4", "F#4", "D#4", "G#4", "A#4"];

    const lastNonSharpIdx = Math.max(
      ...nonSharps.map((n) => INTRODUCTION_ORDER.indexOf(n))
    );
    const firstSharpIdx = Math.min(
      ...sharps.map((n) => INTRODUCTION_ORDER.indexOf(n))
    );

    expect(lastNonSharpIdx).toBeLessThan(firstSharpIdx);
  });

  it("introduces octave 4 before octaves 3 and 5", () => {
    const octave4Notes = INTRODUCTION_ORDER.filter((n) => n.includes("4"));
    const octave3Notes = INTRODUCTION_ORDER.filter((n) => n.includes("3"));
    const octave5Notes = INTRODUCTION_ORDER.filter((n) => n.includes("5"));

    const lastOctave4Idx = Math.max(
      ...octave4Notes.map((n) => INTRODUCTION_ORDER.indexOf(n))
    );
    const firstOctave3Idx = Math.min(
      ...octave3Notes.map((n) => INTRODUCTION_ORDER.indexOf(n))
    );
    const firstOctave5Idx = Math.min(
      ...octave5Notes.map((n) => INTRODUCTION_ORDER.indexOf(n))
    );

    expect(lastOctave4Idx).toBeLessThan(firstOctave3Idx);
    expect(lastOctave4Idx).toBeLessThan(firstOctave5Idx);
  });
});

describe("loadState / saveState", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns initial state when nothing saved", () => {
    const state = loadState();
    expect(state.cards.length).toBe(72); // 36 notes * 2 directions
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
    localStorageMock.setItem("ear-trainer:note-freq-memory-v2", "invalid json");
    const state = loadState();
    expect(state.cards.length).toBe(72);
  });
});

describe("getIntroducedNotes / getNewNotes", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("all notes are new initially", () => {
    const state = loadState();
    expect(getIntroducedNotes(state)).toEqual([]);
    expect(getNewNotes(state).length).toBe(36);
  });

  it("tracks introduced notes after both directions reviewed", () => {
    let state = loadState();
    // Review both directions for A4
    state = recordReview(state, "A4", "freqToNote", Grade.GOOD);
    state = recordReview(state, "A4", "noteToFreq", Grade.GOOD);

    expect(getIntroducedNotes(state)).toContain("A4");
    expect(getIntroducedNotes(state).length).toBe(1);
    expect(getNewNotes(state).length).toBe(35);
  });

  it("does not count note as introduced if only one direction reviewed", () => {
    let state = loadState();
    state = recordReview(state, "A4", "freqToNote", Grade.GOOD);

    expect(getIntroducedNotes(state)).not.toContain("A4");
    expect(getNewNotes(state).length).toBe(36);
  });
});

describe("selectSessionCards", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("first session introduces first 3 notes from INTRODUCTION_ORDER", () => {
    const state = loadState();
    const session = selectSessionCards(state);

    expect(session.isFirstSession).toBe(true);
    expect(session.newNotes).toEqual(["C4", "A4", "F4"]);
    expect(session.reviewCards).toEqual([]);
    expect(session.isComplete).toBe(false);
  });

  it("second session introduces more notes and reviews", () => {
    let state = loadState();
    // Simulate first session completion (introduce 3 notes, both directions)
    for (const note of ["C4", "A4", "F4"]) {
      state = recordReview(state, note, "freqToNote", Grade.GOOD);
      state = recordReview(state, note, "noteToFreq", Grade.GOOD);
    }
    state = incrementSessionCount(state);

    const session = selectSessionCards(state);

    expect(session.isFirstSession).toBe(false);
    expect(session.newNotes.length).toBeGreaterThanOrEqual(1);
    expect(session.newNotes.length).toBeLessThanOrEqual(4);
    expect(session.isComplete).toBe(false);
  });

  it("marks session complete when all notes introduced", () => {
    let state = loadState();
    // Introduce all notes (both directions)
    for (const mapping of ALL_MAPPINGS) {
      state = recordReview(state, mapping.note, "freqToNote", Grade.GOOD);
      state = recordReview(state, mapping.note, "noteToFreq", Grade.GOOD);
    }

    const session = selectSessionCards(state);
    expect(session.isComplete).toBe(true);
    expect(session.newNotes).toEqual([]);
  });
});

describe("recordReview", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("introduces new card on first review", () => {
    let state = loadState();
    state = recordReview(state, "A4", "freqToNote", Grade.GOOD);

    const card = state.cards.find(
      (c) => c.note === "A4" && c.direction === "freqToNote"
    );
    expect(card?.card).not.toBeNull();
    expect(card?.reviewCount).toBe(1);
    expect(card?.lastReviewedAt).not.toBeNull();
  });

  it("records review history with direction", () => {
    let state = loadState();
    state = recordReview(state, "A4", "freqToNote", Grade.GOOD);
    state = recordReview(state, "A4", "noteToFreq", Grade.HARD);

    expect(state.history.length).toBe(2);
    expect(state.history[0].direction).toBe("freqToNote");
    expect(state.history[0].grade).toBe(Grade.GOOD);
    expect(state.history[0].wasNew).toBe(true);
    expect(state.history[1].direction).toBe("noteToFreq");
    expect(state.history[1].grade).toBe(Grade.HARD);
  });

  it("stores guess history when provided", () => {
    let state = loadState();
    state = recordReview(state, "A4", "freqToNote", Grade.AGAIN, {
      guessHistory: ["C4", "F4"],
    });

    expect(state.history[0].guessHistory).toEqual(["C4", "F4"]);
  });

  it("stores timing data when provided", () => {
    let state = loadState();
    state = recordReview(state, "A4", "freqToNote", Grade.GOOD, {
      timeMs: 5000,
      replayTimesMs: [1000, 2500],
    });

    expect(state.history[0].timeMs).toBe(5000);
    expect(state.history[0].replayTimesMs).toEqual([1000, 2500]);
  });

  it("omits empty arrays from history", () => {
    let state = loadState();
    state = recordReview(state, "A4", "freqToNote", Grade.GOOD, {
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
    state = recordReview(state, "A4", "freqToNote", Grade.GOOD);
    state = recordReview(state, "C4", "freqToNote", Grade.AGAIN); // More urgent
    state = recordReview(state, "F4", "freqToNote", Grade.EASY); // Less urgent

    const due = getDueCards(state);
    expect(due.length).toBe(3);
    // AGAIN should be more urgent than EASY
    const againIndex = due.findIndex((c) => c.note === "C4");
    const easyIndex = due.findIndex((c) => c.note === "F4");
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

    expect(stats.introducedNotes).toBe(0);
    expect(stats.totalNotes).toBe(36);
    expect(stats.sessionsCompleted).toBe(0);
    expect(stats.totalReviews).toBe(0);
  });

  it("tracks progress correctly", () => {
    let state = loadState();
    state = recordReview(state, "A4", "freqToNote", Grade.GOOD);
    state = recordReview(state, "A4", "noteToFreq", Grade.GOOD);
    state = recordReview(state, "A4", "freqToNote", Grade.HARD); // Review again
    state = incrementSessionCount(state);

    const stats = getStats(state);
    expect(stats.introducedNotes).toBe(1);
    expect(stats.totalReviews).toBe(3);
    expect(stats.sessionsCompleted).toBe(1);
  });
});

describe("getFrequencyForNote", () => {
  it("returns correct frequency for A4", () => {
    expect(getFrequencyForNote("A4")).toBe(440);
  });

  it("returns correct frequency for C4", () => {
    expect(getFrequencyForNote("C4")).toBe(262);
  });

  it("returns correct frequency for notes in other octaves", () => {
    expect(getFrequencyForNote("A3")).toBe(220);
    expect(getFrequencyForNote("A5")).toBe(880);
  });

  it("returns 0 for unknown note", () => {
    expect(getFrequencyForNote("X9")).toBe(0);
  });
});

describe("getNearbyNotes", () => {
  it("returns 4 notes centered around target", () => {
    const notes = getNearbyNotes("A4", 4);
    expect(notes.length).toBe(4);
    expect(notes).toContain("A4");
  });

  it("returns notes in chromatic order", () => {
    const notes = getNearbyNotes("A4", 4);
    const noteOrder = [
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
    for (let i = 1; i < notes.length; i++) {
      expect(noteOrder.indexOf(notes[i])).toBeGreaterThan(
        noteOrder.indexOf(notes[i - 1])
      );
    }
  });

  it("filters to allowed notes when provided", () => {
    const allowed = ["C4", "E4", "G4", "A4"];
    const notes = getNearbyNotes("A4", 4, allowed);
    expect(notes.length).toBeLessThanOrEqual(4);
    expect(notes).toContain("A4"); // Target always included
    // All notes should be from allowed list
    for (const note of notes) {
      expect(allowed).toContain(note);
    }
  });

  it("includes target even if not in allowed notes", () => {
    const allowed = ["C4", "E4", "G4"]; // A4 not in allowed
    const notes = getNearbyNotes("A4", 4, allowed);
    expect(notes).toContain("A4");
  });

  it("handles edge case at beginning of octave", () => {
    const notes = getNearbyNotes("C4", 4);
    expect(notes.length).toBe(4);
    expect(notes).toContain("C4");
  });

  it("handles edge case at end of octave", () => {
    const notes = getNearbyNotes("B4", 4);
    expect(notes.length).toBe(4);
    expect(notes).toContain("B4");
  });

  it("works with notes in different octaves", () => {
    const notes3 = getNearbyNotes("A3", 4);
    expect(notes3).toContain("A3");
    expect(notes3.every((n) => n.endsWith("3"))).toBe(true);

    const notes5 = getNearbyNotes("A5", 4);
    expect(notes5).toContain("A5");
    expect(notes5.every((n) => n.endsWith("5"))).toBe(true);
  });
});

describe("getNearbyFrequencies", () => {
  it("returns 4 frequencies centered around target", () => {
    const freqs = getNearbyFrequencies(440, 4);
    expect(freqs.length).toBe(4);
    expect(freqs).toContain(440);
  });

  it("returns frequencies in ascending order", () => {
    const freqs = getNearbyFrequencies(440, 4);
    for (let i = 1; i < freqs.length; i++) {
      expect(freqs[i]).toBeGreaterThan(freqs[i - 1]);
    }
  });

  it("handles edge case at lowest frequency in octave", () => {
    const c4Freq = ALL_MAPPINGS.find((m) => m.note === "C4")!.frequency;
    const freqs = getNearbyFrequencies(c4Freq, 4);
    expect(freqs.length).toBe(4);
    expect(freqs).toContain(c4Freq);
  });

  it("handles edge case at highest frequency in octave", () => {
    const b4Freq = ALL_MAPPINGS.find((m) => m.note === "B4")!.frequency;
    const freqs = getNearbyFrequencies(b4Freq, 4);
    expect(freqs.length).toBe(4);
    expect(freqs).toContain(b4Freq);
  });

  it("filters to allowed notes when provided", () => {
    const allowed = ["C4", "E4", "G4", "A4"];
    const freqs = getNearbyFrequencies(440, 4, allowed); // 440 = A4
    expect(freqs.length).toBeLessThanOrEqual(4);
    expect(freqs).toContain(440); // Target always included
    // All frequencies should correspond to allowed notes
    const allowedFreqs = allowed.map(
      (n) => ALL_MAPPINGS.find((m) => m.note === n)?.frequency
    );
    for (const freq of freqs) {
      expect(allowedFreqs).toContain(freq);
    }
  });

  it("works with frequencies in different octaves", () => {
    const a3Freq = 220;
    const freqs3 = getNearbyFrequencies(a3Freq, 4);
    expect(freqs3).toContain(a3Freq);

    const a5Freq = 880;
    const freqs5 = getNearbyFrequencies(a5Freq, 4);
    expect(freqs5).toContain(a5Freq);
  });
});

describe("clearAllProgress", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("removes stored state", () => {
    let state = loadState();
    state = recordReview(state, "A4", "freqToNote", Grade.GOOD);
    saveState(state);

    // Verify it was saved
    expect(loadState().history.length).toBe(1);

    clearAllProgress();

    // Should be back to initial state
    const cleared = loadState();
    expect(cleared.history.length).toBe(0);
    expect(getIntroducedNotes(cleared).length).toBe(0);
  });
});

describe("session card selection edge cases", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("handles nearly complete state (1 note left)", () => {
    let state = loadState();
    // Introduce all but one note
    for (const mapping of ALL_MAPPINGS.slice(0, -1)) {
      state = recordReview(state, mapping.note, "freqToNote", Grade.GOOD);
      state = recordReview(state, mapping.note, "noteToFreq", Grade.GOOD);
    }

    const session = selectSessionCards(state);
    expect(session.newNotes.length).toBe(1);
    expect(session.isComplete).toBe(false);
  });

  it("provides review cards when all introduced", () => {
    let state = loadState();
    for (const mapping of ALL_MAPPINGS) {
      state = recordReview(state, mapping.note, "freqToNote", Grade.GOOD);
      state = recordReview(state, mapping.note, "noteToFreq", Grade.GOOD);
    }

    const session = selectSessionCards(state);
    expect(session.isComplete).toBe(true);
    expect(session.reviewCards.length).toBeGreaterThan(0);
  });
});
