/**
 * Shared difficulty adjustment algorithm.
 *
 * - Increase difficulty after STREAK_TO_INCREASE correct in a row
 * - Decrease difficulty if FAILURE_THRESHOLD of last WINDOW_SIZE are wrong
 */

export interface DifficultyConfig {
  streakToIncrease: number;
  windowSize: number;
  failureThreshold: number;
}

export const DEFAULT_DIFFICULTY_CONFIG: DifficultyConfig = {
  streakToIncrease: 10,
  windowSize: 10,
  failureThreshold: 0.5,
};

export interface DifficultyState {
  level: number;
  streak: number;
  recentAnswers: boolean[];
}

export interface DifficultyAdjustment {
  newLevel: number;
  newStreak: number;
  newRecentAnswers: boolean[];
  changed: "increased" | "decreased" | null;
}

/**
 * Check if difficulty should be adjusted based on recent performance.
 *
 * @param state Current difficulty state
 * @param wasCorrect Whether the most recent answer was correct
 * @param minLevel Minimum difficulty level
 * @param maxLevel Maximum difficulty level
 * @param config Optional configuration overrides
 * @returns New state and whether difficulty changed
 */
export function checkDifficultyAdjustment(
  state: DifficultyState,
  wasCorrect: boolean,
  minLevel: number,
  maxLevel: number,
  config: DifficultyConfig = DEFAULT_DIFFICULTY_CONFIG
): DifficultyAdjustment {
  const { streakToIncrease, windowSize, failureThreshold } = config;

  // Update streak
  let newStreak = wasCorrect ? state.streak + 1 : 0;

  // Update recent answers
  let newRecentAnswers = [...state.recentAnswers, wasCorrect];
  if (newRecentAnswers.length > windowSize * 2) {
    newRecentAnswers = newRecentAnswers.slice(-windowSize);
  }

  let newLevel = state.level;
  let changed: "increased" | "decreased" | null = null;

  // Check for increase: streak reached threshold
  if (newStreak >= streakToIncrease && newLevel < maxLevel) {
    newLevel++;
    newStreak = 0;
    changed = "increased";
  }

  // Check for decrease: too many wrong in window
  if (newRecentAnswers.length >= windowSize) {
    const recent = newRecentAnswers.slice(-windowSize);
    const wrongCount = recent.filter((a) => !a).length;
    if (wrongCount / windowSize >= failureThreshold && newLevel > minLevel) {
      newLevel--;
      newRecentAnswers = [];
      newStreak = 0;
      changed = "decreased";
    }
  }

  return {
    newLevel,
    newStreak,
    newRecentAnswers,
    changed,
  };
}
