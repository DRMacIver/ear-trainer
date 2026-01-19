import { describe, it, expect, beforeEach } from "vitest";
import {
  ALL_NOTES,
  NOTE_NAMES,
  OCTAVES,
  PAIRED_INTRODUCTION_ORDER,
  OCTAVE_3_INTRODUCTION_ORDER,
  OCTAVE_5_INTRODUCTION_ORDER,
  loadState,
  saveState,
  getNoteFamily,
  getOctave,
  getFrequencyForNote,
  isReliablyLearned,
  canIntroduceFullNote,
  checkRetirements,
  getIntroducedCards,
  getDueCards,
  selectSessionCards,
  recordReview,
  incrementSessionCount,
  getStats,
  getNearbyFamilies,
  getNearbyNotes,
  getIntroducedFamilies,
  getIntroducedNotesForType,
  clearAllProgress,
} from "../src/lib/note-id-memory.js";
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

describe("ALL_NOTES", () => {
  it("contains 36 notes (3 octaves × 12 notes)", () => {
    expect(ALL_NOTES.length).toBe(36);
  });

  it("starts with C3 and ends with B5", () => {
    expect(ALL_NOTES[0]).toBe("C3");
    expect(ALL_NOTES[35]).toBe("B5");
  });

  it("contains A4", () => {
    expect(ALL_NOTES).toContain("A4");
  });
});

describe("PAIRED_INTRODUCTION_ORDER", () => {
  it("contains 12 pairs (one per note family)", () => {
    expect(PAIRED_INTRODUCTION_ORDER.length).toBe(12);
  });

  it("starts with non-sharps", () => {
    const first7 = PAIRED_INTRODUCTION_ORDER.slice(0, 7);
    for (const pair of first7) {
      expect(pair.family).not.toContain("#");
    }
  });

  it("ends with sharps", () => {
    const last5 = PAIRED_INTRODUCTION_ORDER.slice(7);
    for (const pair of last5) {
      expect(pair.family).toContain("#");
    }
  });

  it("pairs octave 4 notes with their families", () => {
    for (const pair of PAIRED_INTRODUCTION_ORDER) {
      expect(pair.note).toMatch(/4$/);
      expect(getNoteFamily(pair.note)).toBe(pair.family);
    }
  });
});

describe("OCTAVE_3_INTRODUCTION_ORDER and OCTAVE_5_INTRODUCTION_ORDER", () => {
  it("each contains 12 notes", () => {
    expect(OCTAVE_3_INTRODUCTION_ORDER.length).toBe(12);
    expect(OCTAVE_5_INTRODUCTION_ORDER.length).toBe(12);
  });

  it("octave 3 notes are all in octave 3", () => {
    for (const note of OCTAVE_3_INTRODUCTION_ORDER) {
      expect(getOctave(note)).toBe(3);
    }
  });

  it("octave 5 notes are all in octave 5", () => {
    for (const note of OCTAVE_5_INTRODUCTION_ORDER) {
      expect(getOctave(note)).toBe(5);
    }
  });

  it("starts with non-sharps in each", () => {
    expect(OCTAVE_3_INTRODUCTION_ORDER[0]).toBe("C3");
    expect(OCTAVE_5_INTRODUCTION_ORDER[0]).toBe("C5");
    // First 7 are non-sharps
    for (const note of OCTAVE_3_INTRODUCTION_ORDER.slice(0, 7)) {
      expect(note).not.toContain("#");
    }
    for (const note of OCTAVE_5_INTRODUCTION_ORDER.slice(0, 7)) {
      expect(note).not.toContain("#");
    }
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

  it("returns 880 for A5 (octave above)", () => {
    expect(getFrequencyForNote("A5")).toBe(880);
  });

  it("returns 0 for unknown note", () => {
    expect(getFrequencyForNote("X9")).toBe(0);
  });
});

describe("loadState / saveState", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns initial state when nothing saved", () => {
    const state = loadState();
    // 36 octaveId + 12 noteSequence + 36 fullNote = 84 cards
    expect(state.cards.length).toBe(84);
    expect(state.history).toEqual([]);
    expect(state.sessionCount).toBe(0);
    expect(state.cards.every((c) => c.card === null)).toBe(true);
    expect(state.cards.every((c) => c.retired === false)).toBe(true);
  });

  it("creates correct card types", () => {
    const state = loadState();
    const octaveIdCards = state.cards.filter(
      (c) => c.questionType === "octaveId"
    );
    const noteSeqCards = state.cards.filter(
      (c) => c.questionType === "noteSequence"
    );
    const fullNoteCards = state.cards.filter(
      (c) => c.questionType === "fullNote"
    );

    expect(octaveIdCards.length).toBe(36);
    expect(noteSeqCards.length).toBe(12);
    expect(fullNoteCards.length).toBe(36);
  });

  it("saves and loads state correctly", () => {
    const state = loadState();
    state.sessionCount = 5;
    saveState(state);

    const loaded = loadState();
    expect(loaded.sessionCount).toBe(5);
  });

  it("handles corrupted localStorage gracefully", () => {
    localStorageMock.setItem("ear-trainer:note-id-memory-v1", "invalid json");
    const state = loadState();
    expect(state.cards.length).toBe(84);
  });
});

describe("recordReview", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("introduces new card on first review", () => {
    let state = loadState();
    state = recordReview(state, "octaveId:A4", Grade.GOOD);

    const card = state.cards.find((c) => c.id === "octaveId:A4");
    expect(card?.card).not.toBeNull();
    expect(card?.reviewCount).toBe(1);
    expect(card?.lastReviewedAt).not.toBeNull();
  });

  it("records review history", () => {
    let state = loadState();
    state = recordReview(state, "octaveId:A4", Grade.GOOD);
    state = recordReview(state, "noteSequence:A", Grade.HARD);

    expect(state.history.length).toBe(2);
    expect(state.history[0].cardId).toBe("octaveId:A4");
    expect(state.history[0].grade).toBe(Grade.GOOD);
    expect(state.history[0].wasNew).toBe(true);
    expect(state.history[1].cardId).toBe("noteSequence:A");
    expect(state.history[1].grade).toBe(Grade.HARD);
  });

  it("stores guess history when provided", () => {
    let state = loadState();
    state = recordReview(state, "octaveId:A4", Grade.AGAIN, {
      guessHistory: [3, 5],
    });

    expect(state.history[0].guessHistory).toEqual([3, 5]);
  });

  it("omits empty arrays from history", () => {
    let state = loadState();
    state = recordReview(state, "octaveId:A4", Grade.GOOD, {
      guessHistory: [],
      replayTimesMs: [],
    });

    expect(state.history[0].guessHistory).toBeUndefined();
    expect(state.history[0].replayTimesMs).toBeUndefined();
  });
});

describe("isReliablyLearned", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns false for unreviewed card", () => {
    const state = loadState();
    expect(isReliablyLearned(state, "octaveId:A4")).toBe(false);
  });

  it("returns false for recently failed card", () => {
    let state = loadState();
    state = recordReview(state, "octaveId:A4", Grade.AGAIN);
    expect(isReliablyLearned(state, "octaveId:A4")).toBe(false);
  });

  it("returns true for well-learned card", () => {
    let state = loadState();
    // Multiple successful reviews should build stability
    state = recordReview(state, "octaveId:A4", Grade.EASY);
    state = recordReview(state, "octaveId:A4", Grade.EASY);
    state = recordReview(state, "octaveId:A4", Grade.EASY);
    state = recordReview(state, "octaveId:A4", Grade.EASY);
    // After several EASY reviews, card should be reliably learned
    expect(isReliablyLearned(state, "octaveId:A4")).toBe(true);
  });
});

describe("canIntroduceFullNote", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns false when prerequisites not met", () => {
    const state = loadState();
    expect(canIntroduceFullNote(state, "A4")).toBe(false);
  });

  it("returns false when only octaveId is learned", () => {
    let state = loadState();
    // Learn octaveId:A4 well
    for (let i = 0; i < 5; i++) {
      state = recordReview(state, "octaveId:A4", Grade.EASY);
    }
    expect(canIntroduceFullNote(state, "A4")).toBe(false);
  });

  it("returns false when only noteSequence is learned", () => {
    let state = loadState();
    // Learn noteSequence:A well
    for (let i = 0; i < 5; i++) {
      state = recordReview(state, "noteSequence:A", Grade.EASY);
    }
    expect(canIntroduceFullNote(state, "A4")).toBe(false);
  });

  it("returns true when both prerequisites are reliably learned", () => {
    let state = loadState();
    // Learn both prerequisites well
    for (let i = 0; i < 5; i++) {
      state = recordReview(state, "octaveId:A4", Grade.EASY);
      state = recordReview(state, "noteSequence:A", Grade.EASY);
    }
    expect(canIntroduceFullNote(state, "A4")).toBe(true);
  });
});

describe("checkRetirements", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("does not retire cards initially", () => {
    let state = loadState();
    state = checkRetirements(state);
    expect(state.cards.every((c) => !c.retired)).toBe(true);
  });

  it("retires octaveId when fullNote is reliably learned", () => {
    let state = loadState();
    // Learn fullNote:A4 well
    for (let i = 0; i < 5; i++) {
      state = recordReview(state, "fullNote:A4", Grade.EASY);
    }
    state = checkRetirements(state);

    const octaveCard = state.cards.find((c) => c.id === "octaveId:A4");
    expect(octaveCard?.retired).toBe(true);
  });

  it("retires noteSequence when all 3 fullNotes in family are reliably learned", () => {
    let state = loadState();
    // Learn all 3 fullNotes for A family
    for (const octave of OCTAVES) {
      for (let i = 0; i < 5; i++) {
        state = recordReview(state, `fullNote:A${octave}`, Grade.EASY);
      }
    }
    state = checkRetirements(state);

    const noteSeqCard = state.cards.find((c) => c.id === "noteSequence:A");
    expect(noteSeqCard?.retired).toBe(true);
  });

  it("does not retire noteSequence when only some fullNotes are learned", () => {
    let state = loadState();
    // Learn only fullNote:A4 well
    for (let i = 0; i < 5; i++) {
      state = recordReview(state, "fullNote:A4", Grade.EASY);
    }
    state = checkRetirements(state);

    const noteSeqCard = state.cards.find((c) => c.id === "noteSequence:A");
    expect(noteSeqCard?.retired).toBe(false);
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
    state = recordReview(state, "octaveId:A4", Grade.GOOD);
    state = recordReview(state, "noteSequence:A", Grade.GOOD);

    const introduced = getIntroducedCards(state);
    expect(introduced.length).toBe(2);
    expect(introduced.map((c) => c.id)).toContain("octaveId:A4");
    expect(introduced.map((c) => c.id)).toContain("noteSequence:A");
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

  it("excludes retired cards", () => {
    let state = loadState();
    state = recordReview(state, "octaveId:A4", Grade.GOOD);
    // Manually retire the card
    const cardIdx = state.cards.findIndex((c) => c.id === "octaveId:A4");
    state.cards[cardIdx] = { ...state.cards[cardIdx], retired: true };

    const due = getDueCards(state);
    expect(due.find((c) => c.id === "octaveId:A4")).toBeUndefined();
  });

  it("sorts by urgency (lower retrievability first)", () => {
    let state = loadState();
    state = recordReview(state, "octaveId:A4", Grade.GOOD);
    state = recordReview(state, "octaveId:C4", Grade.AGAIN); // More urgent

    const due = getDueCards(state);
    const againIndex = due.findIndex((c) => c.id === "octaveId:C4");
    const goodIndex = due.findIndex((c) => c.id === "octaveId:A4");
    expect(againIndex).toBeLessThan(goodIndex);
  });
});

describe("selectSessionCards", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("first session introduces paired octaveId and noteSequence", () => {
    const state = loadState();
    const session = selectSessionCards(state);

    expect(session.isFirstSession).toBe(true);
    expect(session.newCards.length).toBeGreaterThan(0);

    // Should include both octaveId and noteSequence cards
    const types = new Set(session.newCards.map((c) => c.questionType));
    expect(types.has("octaveId")).toBe(true);
    expect(types.has("noteSequence")).toBe(true);
  });

  it("first session starts with C4 and C family", () => {
    const state = loadState();
    const session = selectSessionCards(state);

    const octaveIdCards = session.newCards.filter(
      (c) => c.questionType === "octaveId"
    );
    const noteSeqCards = session.newCards.filter(
      (c) => c.questionType === "noteSequence"
    );

    expect(octaveIdCards[0].note).toBe("C4");
    expect(noteSeqCards[0].noteFamily).toBe("C");
  });

  it("does not introduce fullNote cards initially", () => {
    const state = loadState();
    const session = selectSessionCards(state);

    const fullNoteCards = session.newCards.filter(
      (c) => c.questionType === "fullNote"
    );
    expect(fullNoteCards.length).toBe(0);
  });

  it("introduces fullNote when prerequisites met", () => {
    let state = loadState();
    // Learn prerequisites for A4 well
    for (let i = 0; i < 5; i++) {
      state = recordReview(state, "octaveId:A4", Grade.EASY);
      state = recordReview(state, "noteSequence:A", Grade.EASY);
    }

    const session = selectSessionCards(state);

    // Should include fullNote:A4 in new cards
    const fullNoteCards = session.newCards.filter(
      (c) => c.questionType === "fullNote"
    );
    expect(fullNoteCards.some((c) => c.note === "A4")).toBe(true);
  });

  it("first session introduces 2 pairs plus octave 3 counterparts", () => {
    const state = loadState();
    const session = selectSessionCards(state);

    // First session: 2 pairs (4 cards) + 2 octave 3 notes (2 cards) = 6 cards
    expect(session.newCards.length).toBe(6);
    expect(session.isFirstSession).toBe(true);

    // Should have C4, A4 (octaveId), C, A (noteSequence), C3, A3 (octaveId)
    const ids = session.newCards.map((c) => c.id);
    expect(ids).toContain("octaveId:C4");
    expect(ids).toContain("octaveId:A4");
    expect(ids).toContain("noteSequence:C");
    expect(ids).toContain("noteSequence:A");
    expect(ids).toContain("octaveId:C3");
    expect(ids).toContain("octaveId:A3");
  });

  it("limits new cards per session after first session", () => {
    let state = loadState();
    // Simulate first session complete
    state = recordReview(state, "octaveId:C4", Grade.GOOD);
    state = recordReview(state, "octaveId:A4", Grade.GOOD);
    state = recordReview(state, "noteSequence:C", Grade.GOOD);
    state = recordReview(state, "noteSequence:A", Grade.GOOD);
    state = recordReview(state, "octaveId:C3", Grade.GOOD);
    state = recordReview(state, "octaveId:A3", Grade.GOOD);
    state = incrementSessionCount(state);

    const session = selectSessionCards(state);

    expect(session.isFirstSession).toBe(false);
    expect(session.newCards.length).toBeLessThanOrEqual(4);
  });

  it("includes review cards when some cards are introduced", () => {
    let state = loadState();
    // Introduce some cards
    state = recordReview(state, "octaveId:C4", Grade.GOOD);
    state = recordReview(state, "noteSequence:C", Grade.GOOD);
    state = incrementSessionCount(state);

    const session = selectSessionCards(state);

    expect(session.isFirstSession).toBe(false);
    expect(session.reviewCards.length).toBeGreaterThan(0);
  });

  it("marks allIntroduced when all cards are introduced", () => {
    let state = loadState();
    // Introduce all cards
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

    expect(stats.introducedOctaveId).toBe(0);
    expect(stats.introducedNoteSequence).toBe(0);
    expect(stats.introducedFullNote).toBe(0);
    expect(stats.retiredCards).toBe(0);
    expect(stats.totalCards).toBe(84);
    expect(stats.sessionsCompleted).toBe(0);
    expect(stats.totalReviews).toBe(0);
  });

  it("tracks progress correctly", () => {
    let state = loadState();
    state = recordReview(state, "octaveId:A4", Grade.GOOD);
    state = recordReview(state, "noteSequence:A", Grade.GOOD);
    state = recordReview(state, "fullNote:C4", Grade.GOOD);
    state = incrementSessionCount(state);

    const stats = getStats(state);
    expect(stats.introducedOctaveId).toBe(1);
    expect(stats.introducedNoteSequence).toBe(1);
    expect(stats.introducedFullNote).toBe(1);
    expect(stats.totalReviews).toBe(3);
    expect(stats.sessionsCompleted).toBe(1);
  });

  it("tracks retired cards", () => {
    let state = loadState();
    // Learn fullNote:A4 well to trigger retirement
    for (let i = 0; i < 5; i++) {
      state = recordReview(state, "fullNote:A4", Grade.EASY);
    }
    state = checkRetirements(state);

    const stats = getStats(state);
    expect(stats.retiredCards).toBe(1); // octaveId:A4 should be retired
  });
});

describe("getNearbyFamilies", () => {
  it("returns 4 families centered around target", () => {
    const families = getNearbyFamilies("A", 4);
    expect(families.length).toBe(4);
    expect(families).toContain("A");
  });

  it("returns families in chromatic order", () => {
    const families = getNearbyFamilies("A", 4);
    const order = NOTE_NAMES;
    for (let i = 1; i < families.length; i++) {
      expect(order.indexOf(families[i])).toBeGreaterThan(
        order.indexOf(families[i - 1])
      );
    }
  });

  it("wraps around chromatic scale", () => {
    const familiesC = getNearbyFamilies("C", 4);
    expect(familiesC).toContain("C");
    // Should include B (wraps around) or C#, D (forward)

    const familiesB = getNearbyFamilies("B", 4);
    expect(familiesB).toContain("B");
    // Should include A#, A (backward) or C (wraps around)
  });

  it("filters to allowed families when provided", () => {
    const allowed = ["C", "E", "G", "A"];
    const families = getNearbyFamilies("A", 4, allowed);
    expect(families).toContain("A"); // Target always included
    for (const f of families) {
      expect(allowed).toContain(f);
    }
  });

  it("includes target even if not in allowed", () => {
    const allowed = ["C", "E", "G"]; // A not in allowed
    const families = getNearbyFamilies("A", 4, allowed);
    expect(families).toContain("A");
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
    const octave4Notes = ALL_NOTES.filter((n) => n.endsWith("4"));
    for (let i = 1; i < notes.length; i++) {
      expect(octave4Notes.indexOf(notes[i])).toBeGreaterThan(
        octave4Notes.indexOf(notes[i - 1])
      );
    }
  });

  it("filters to allowed notes when provided", () => {
    const allowed = ["C4", "E4", "G4", "A4"];
    const notes = getNearbyNotes("A4", 4, allowed);
    expect(notes).toContain("A4");
    for (const n of notes) {
      expect(allowed).toContain(n);
    }
  });

  it("stays within same octave", () => {
    const notes3 = getNearbyNotes("A3", 4);
    expect(notes3.every((n) => n.endsWith("3"))).toBe(true);

    const notes5 = getNearbyNotes("A5", 4);
    expect(notes5.every((n) => n.endsWith("5"))).toBe(true);
  });
});

describe("getIntroducedFamilies", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns empty array initially", () => {
    const state = loadState();
    expect(getIntroducedFamilies(state)).toEqual([]);
  });

  it("returns families that have noteSequence cards introduced", () => {
    let state = loadState();
    state = recordReview(state, "noteSequence:A", Grade.GOOD);
    state = recordReview(state, "noteSequence:C", Grade.GOOD);

    const families = getIntroducedFamilies(state);
    expect(families).toContain("A");
    expect(families).toContain("C");
    expect(families.length).toBe(2);
  });
});

describe("getIntroducedNotesForType", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns empty array initially", () => {
    const state = loadState();
    expect(getIntroducedNotesForType(state, "octaveId")).toEqual([]);
    expect(getIntroducedNotesForType(state, "fullNote")).toEqual([]);
  });

  it("returns notes for specific question type", () => {
    let state = loadState();
    state = recordReview(state, "octaveId:A4", Grade.GOOD);
    state = recordReview(state, "octaveId:C4", Grade.GOOD);
    state = recordReview(state, "fullNote:A4", Grade.GOOD);

    const octaveIdNotes = getIntroducedNotesForType(state, "octaveId");
    expect(octaveIdNotes).toContain("A4");
    expect(octaveIdNotes).toContain("C4");
    expect(octaveIdNotes.length).toBe(2);

    const fullNoteNotes = getIntroducedNotesForType(state, "fullNote");
    expect(fullNoteNotes).toContain("A4");
    expect(fullNoteNotes.length).toBe(1);
  });
});

describe("clearAllProgress", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("removes stored state", () => {
    let state = loadState();
    state = recordReview(state, "octaveId:A4", Grade.GOOD);
    saveState(state);

    // Verify it was saved
    expect(loadState().history.length).toBe(1);

    clearAllProgress();

    // Should be back to initial state
    const cleared = loadState();
    expect(cleared.history.length).toBe(0);
    expect(getIntroducedCards(cleared).length).toBe(0);
  });
});

describe("session progression flow", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("follows expected learning progression", () => {
    let state = loadState();

    // First session: introduces paired octaveId + noteSequence
    let session = selectSessionCards(state);
    expect(session.isFirstSession).toBe(true);
    expect(session.newCards.length).toBeGreaterThan(0);

    // Review the new cards
    for (const card of session.newCards) {
      state = recordReview(state, card.id, Grade.GOOD);
    }
    state = incrementSessionCount(state);
    saveState(state);

    // Second session: should have review cards and potentially new cards
    session = selectSessionCards(state);
    expect(session.isFirstSession).toBe(false);
    expect(session.reviewCards.length).toBeGreaterThan(0);

    // After many sessions with perfect scores on prerequisites,
    // fullNote cards should become available
    for (let i = 0; i < 10; i++) {
      // Learn prerequisites well
      state = recordReview(state, "octaveId:C4", Grade.EASY);
      state = recordReview(state, "noteSequence:C", Grade.EASY);
    }

    session = selectSessionCards(state);
    const fullNotes = session.newCards.filter(
      (c) => c.questionType === "fullNote"
    );
    expect(fullNotes.length).toBeGreaterThan(0);
  });
});
