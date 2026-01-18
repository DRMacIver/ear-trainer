/**
 * LocalStorage utilities for persisting exercise state.
 */

const STORAGE_PREFIX = "ear-trainer:";

/**
 * Save a difficulty value for an exercise.
 */
export function saveDifficulty(exerciseId: string, value: number): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}difficulty:${exerciseId}`, String(value));
  } catch {
    // localStorage may be unavailable (private browsing, etc.)
  }
}

/**
 * Load a saved difficulty value for an exercise.
 * Returns the default value if not found or on error.
 */
export function loadDifficulty(exerciseId: string, defaultValue: number): number {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}difficulty:${exerciseId}`);
    if (stored !== null) {
      const parsed = parseFloat(stored);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
  } catch {
    // localStorage may be unavailable
  }
  return defaultValue;
}
