import { describe, it, expect } from "vitest";
import { createDeck, Grade } from "../src/lib/fsrs.js";

describe("FSRS createDeck", () => {
  const deck = createDeck();

  describe("newCard", () => {
    it("creates card with initial difficulty based on grade", () => {
      const easyCard = deck.newCard(Grade.EASY);
      const againCard = deck.newCard(Grade.AGAIN);

      // Easy grade should result in lower difficulty
      expect(easyCard.D).toBeLessThan(againCard.D);
      // Difficulty should be in valid range (1-10)
      expect(easyCard.D).toBeGreaterThanOrEqual(1);
      expect(easyCard.D).toBeLessThanOrEqual(10);
      expect(againCard.D).toBeGreaterThanOrEqual(1);
      expect(againCard.D).toBeLessThanOrEqual(10);
    });

    it("creates card with stability based on grade", () => {
      const easyCard = deck.newCard(Grade.EASY);
      const againCard = deck.newCard(Grade.AGAIN);

      // Easy grade should result in higher stability
      expect(easyCard.S).toBeGreaterThan(againCard.S);
      expect(easyCard.S).toBeGreaterThan(0);
      expect(againCard.S).toBeGreaterThan(0);
    });

    it("creates card with positive interval", () => {
      const card = deck.newCard(Grade.GOOD);
      expect(card.I).toBeGreaterThanOrEqual(1);
    });
  });

  describe("gradeCard", () => {
    it("increases stability on successful review", () => {
      const card = deck.newCard(Grade.GOOD);
      const reviewed = deck.gradeCard(card, 1, Grade.GOOD);

      expect(reviewed.S).toBeGreaterThan(card.S);
    });

    it("decreases stability on AGAIN grade", () => {
      const card = deck.newCard(Grade.GOOD);
      // Simulate a longer interval to ensure stability changes
      const reviewed = deck.gradeCard(card, 5, Grade.AGAIN);

      expect(reviewed.S).toBeLessThan(card.S);
    });

    it("adjusts difficulty based on performance", () => {
      const card = deck.newCard(Grade.GOOD);

      const afterEasy = deck.gradeCard(card, 1, Grade.EASY);
      const afterAgain = deck.gradeCard(card, 1, Grade.AGAIN);

      // Easy should decrease difficulty, AGAIN should increase it
      expect(afterEasy.D).toBeLessThan(afterAgain.D);
    });

    it("handles same-day review", () => {
      const card = deck.newCard(Grade.GOOD);
      // daysSinceReview < 1 triggers different calculation
      const reviewed = deck.gradeCard(card, 0.5, Grade.GOOD);

      expect(reviewed.D).toBeGreaterThanOrEqual(1);
      expect(reviewed.S).toBeGreaterThan(0);
      expect(reviewed.I).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getRetrievability", () => {
    it("returns 1 at day 0", () => {
      const card = deck.newCard(Grade.GOOD);
      const r = deck.getRetrievability(card, 0);
      expect(r).toBeCloseTo(1, 5);
    });

    it("decreases over time", () => {
      const card = deck.newCard(Grade.GOOD);
      const r1 = deck.getRetrievability(card, 1);
      const r7 = deck.getRetrievability(card, 7);
      const r30 = deck.getRetrievability(card, 30);

      expect(r1).toBeLessThan(1);
      expect(r7).toBeLessThan(r1);
      expect(r30).toBeLessThan(r7);
    });

    it("higher stability means slower decay", () => {
      const weakCard = deck.newCard(Grade.AGAIN);
      const strongCard = deck.newCard(Grade.EASY);

      const weakR = deck.getRetrievability(weakCard, 7);
      const strongR = deck.getRetrievability(strongCard, 7);

      expect(strongR).toBeGreaterThan(weakR);
    });
  });
});

describe("Grade enum", () => {
  it("has expected values", () => {
    expect(Grade.AGAIN).toBe(1);
    expect(Grade.HARD).toBe(2);
    expect(Grade.GOOD).toBe(3);
    expect(Grade.EASY).toBe(4);
  });
});
