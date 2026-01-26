/**
 * FSRS-5 Spaced Repetition Algorithm
 * Based on femto-fsrs by Rick Carlino (MIT License)
 * https://github.com/RickCarlino/femto-fsrs
 */

export interface Card {
  D: number; // Difficulty (1-10)
  S: number; // Stability (days until 90% recall)
  I: number; // Interval (days until next review)
}

export enum Grade {
  AGAIN = 1,
  HARD = 2,
  GOOD = 3,
  EASY = 4,
}

interface DeckParams {
  requestedRetentionRate: number;
  w: number[];
  maxStability: number;
}

const DECAY = -0.5;
const FACTOR = 19 / 81;

const DEFAULT_W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655,
  0.6621,
] as const;

const DEFAULT_PARAMS: DeckParams = {
  requestedRetentionRate: 0.9,
  w: [...DEFAULT_W],
  maxStability: 36500,
};

const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

export function createDeck(params: Partial<DeckParams> = {}) {
  const w = params.w ?? DEFAULT_PARAMS.w;
  const requestedRetentionRate =
    params.requestedRetentionRate ?? DEFAULT_PARAMS.requestedRetentionRate;
  const MAX_S = params.maxStability ?? DEFAULT_PARAMS.maxStability;

  const retrievability = (t: number, S: number): number =>
    Math.pow(1 + FACTOR * (t / S), DECAY);

  const nextInterval = (R: number, S: number): number => {
    const raw = (S / FACTOR) * (Math.pow(R, 1 / DECAY) - 1);
    return Math.max(1, raw);
  };

  const initialStability = (G: Grade): number => w[G - 1];

  const initialDifficulty = (G: Grade): number => {
    const d0 = w[4] - Math.exp(w[5] * (G - 1)) + 1;
    return clamp(d0, 1, 10);
  };

  const nextDifficulty = (D: number, G: Grade): number => {
    const delta = -w[6] * (G - 3);
    const Dprime = D + delta * ((10 - D) / 9);
    const target = initialDifficulty(Grade.EASY);
    const Dnext = w[7] * target + (1 - w[7]) * Dprime;
    return clamp(Dnext, 1, 10);
  };

  const nextStabilityAfterRecall = (
    d: number,
    s: number,
    r: number,
    g: Grade
  ): number => {
    const hardPenalty = g === Grade.HARD ? w[15] : 1;
    const easyBoost = g === Grade.EASY ? w[16] : 1;

    const multiplier =
      Math.exp(w[8]) *
      (11 - d) *
      Math.pow(s, -w[9]) *
      (Math.exp((1 - r) * w[10]) - 1) *
      hardPenalty *
      easyBoost;

    return clamp(s * (1 + multiplier), 0, MAX_S);
  };

  const nextStabilityAfterForgetting = (
    d: number,
    s: number,
    r: number
  ): number => {
    const post =
      w[11] *
      Math.pow(d, -w[12]) *
      (Math.pow(s + 1, w[13]) - 1) *
      Math.exp((1 - r) * w[14]);

    return clamp(post, 0, MAX_S);
  };

  return {
    newCard(firstGrade: Grade): Card {
      const D = initialDifficulty(firstGrade);
      const S = clamp(initialStability(firstGrade), 0, MAX_S);
      const I = nextInterval(requestedRetentionRate, S);
      return { D, S, I };
    },

    gradeCard(card: Card, daysSinceReview: number, grade: Grade): Card {
      const D = nextDifficulty(card.D, grade);
      let S: number;

      if (daysSinceReview < 1) {
        S = card.S * Math.exp(w[17] * (grade - 3 + w[18]));
      } else {
        const R = retrievability(daysSinceReview, card.S);
        S =
          grade === Grade.AGAIN
            ? nextStabilityAfterForgetting(D, card.S, R)
            : nextStabilityAfterRecall(D, card.S, R, grade);
      }

      const I = nextInterval(requestedRetentionRate, clamp(S, 0, MAX_S));
      return { D, S, I };
    },

    getRetrievability(card: Card, daysSinceReview: number): number {
      return retrievability(daysSinceReview, card.S);
    },
  } as const;
}
