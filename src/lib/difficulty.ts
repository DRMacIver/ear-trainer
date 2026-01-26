/**
 * Shared difficulty adjustment algorithm using exponential moving average (EMA).
 *
 * Tracks an EMA of success rate, initialized to 0.85.
 * After each answer: ema = 0.05 * (1 if correct else 0) + 0.95 * ema
 *
 * If EMA > 0.92: increase difficulty, reset EMA to 0.85
 * If EMA < 0.70: decrease difficulty (min 1), reset EMA to 0.85
 *
 * The reset provides a grace period at each level. The asymmetric thresholds
 * favor stability at harder levels. The 0.05 smoothing factor means roughly
 * 4 consecutive errors trigger demotion and ~12 consecutive correct answers
 * trigger promotion, but mixed performance keeps difficulty stable.
 */

const INITIAL_EMA = 0.85;
const SMOOTHING_FACTOR = 0.05;
const PROMOTION_THRESHOLD = 0.92;
const DEMOTION_THRESHOLD = 0.7;

export interface DifficultyState {
  level: number;
  ema: number;
}

export interface DifficultyAdjustment {
  newLevel: number;
  newEma: number;
  changed: "increased" | "decreased" | null;
}

/**
 * Create initial difficulty state.
 */
export function createDifficultyState(level: number = 1): DifficultyState {
  return {
    level,
    ema: INITIAL_EMA,
  };
}

/**
 * Check if difficulty should be adjusted based on EMA of performance.
 *
 * @param state Current difficulty state
 * @param wasCorrect Whether the most recent answer was correct
 * @param minLevel Minimum difficulty level
 * @param maxLevel Maximum difficulty level
 * @returns New state and whether difficulty changed
 */
export function checkDifficultyAdjustment(
  state: DifficultyState,
  wasCorrect: boolean,
  minLevel: number,
  maxLevel: number
): DifficultyAdjustment {
  // Update EMA: ema = 0.05 * (1 if correct else 0) + 0.95 * ema
  const score = wasCorrect ? 1 : 0;
  let newEma = SMOOTHING_FACTOR * score + (1 - SMOOTHING_FACTOR) * state.ema;

  let newLevel = state.level;
  let changed: "increased" | "decreased" | null = null;

  // Check for promotion
  if (newEma > PROMOTION_THRESHOLD && newLevel < maxLevel) {
    newLevel++;
    newEma = INITIAL_EMA; // Reset for grace period
    changed = "increased";
  }

  // Check for demotion
  if (newEma < DEMOTION_THRESHOLD && newLevel > minLevel) {
    newLevel--;
    newEma = INITIAL_EMA; // Reset for grace period
    changed = "decreased";
  }

  return {
    newLevel,
    newEma,
    changed,
  };
}
