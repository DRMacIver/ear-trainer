import { describe, it, expect } from "vitest";
import {
  NOTE_FREQUENCIES,
  ALL_NOTES,
  OCTAVE_4_NOTES,
  getNotesForOctave,
  selectRandomNotes,
  shuffle,
} from "../src/audio.js";

describe("NOTE_FREQUENCIES", () => {
  it("contains standard notes", () => {
    expect(NOTE_FREQUENCIES["A4"]).toBeCloseTo(440.0, 1);
    expect(NOTE_FREQUENCIES["C4"]).toBeCloseTo(261.63, 1);
  });

  it("has correct octave relationships", () => {
    // Each octave should double the frequency
    expect(NOTE_FREQUENCIES["A5"]).toBeCloseTo(880.0, 1);
    expect(NOTE_FREQUENCIES["A3"]).toBeCloseTo(220.0, 1);
    expect(NOTE_FREQUENCIES["C5"]).toBeCloseTo(NOTE_FREQUENCIES["C4"] * 2, 1);
    expect(NOTE_FREQUENCIES["C3"]).toBeCloseTo(NOTE_FREQUENCIES["C4"] / 2, 1);
  });

  it("has all notes for octaves 3, 4, and 5", () => {
    expect(ALL_NOTES).toContain("A4");
    expect(ALL_NOTES).toContain("C4");
    expect(ALL_NOTES).toContain("C#4");
    expect(ALL_NOTES).toContain("C3");
    expect(ALL_NOTES).toContain("C5");
    expect(ALL_NOTES.length).toBe(36); // 12 notes * 3 octaves
  });
});

describe("OCTAVE_4_NOTES", () => {
  it("contains only octave 4 notes", () => {
    expect(OCTAVE_4_NOTES.length).toBe(12);
    OCTAVE_4_NOTES.forEach((note) => {
      expect(note).toMatch(/4$/);
    });
  });
});

describe("getNotesForOctave", () => {
  it("returns 12 notes for any octave", () => {
    expect(getNotesForOctave(3).length).toBe(12);
    expect(getNotesForOctave(4).length).toBe(12);
    expect(getNotesForOctave(5).length).toBe(12);
  });

  it("returns notes with correct octave number", () => {
    getNotesForOctave(3).forEach((note) => {
      expect(note).toMatch(/3$/);
    });
  });
});

describe("selectRandomNotes", () => {
  it("returns the requested number of notes", () => {
    const notes = selectRandomNotes(3);
    expect(notes.length).toBe(3);
  });

  it("returns unique notes", () => {
    const notes = selectRandomNotes(5);
    const uniqueNotes = new Set(notes);
    expect(uniqueNotes.size).toBe(5);
  });

  it("returns only octave 4 notes by default", () => {
    const notes = selectRandomNotes(4);
    notes.forEach((note) => {
      expect(OCTAVE_4_NOTES).toContain(note);
    });
  });

  it("can select from custom note set", () => {
    const customNotes = ["C3", "D3", "E3"];
    const notes = selectRandomNotes(2, customNotes);
    notes.forEach((note) => {
      expect(customNotes).toContain(note);
    });
  });
});

describe("shuffle", () => {
  it("returns array of same length", () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input);
    expect(result.length).toBe(input.length);
  });

  it("contains same elements", () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input);
    expect(result.sort()).toEqual(input.sort());
  });

  it("does not modify original array", () => {
    const input = [1, 2, 3, 4, 5];
    const original = [...input];
    shuffle(input);
    expect(input).toEqual(original);
  });
});
