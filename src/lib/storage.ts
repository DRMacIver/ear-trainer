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

/**
 * Save a versioned difficulty value for an exercise.
 * When the version changes, old saved values will be ignored.
 */
export function saveVersionedDifficulty(
  exerciseId: string,
  value: number,
  version: number
): void {
  try {
    const data = JSON.stringify({ value, version });
    localStorage.setItem(`${STORAGE_PREFIX}difficulty:${exerciseId}`, data);
  } catch {
    // localStorage may be unavailable
  }
}

/**
 * Load a versioned difficulty value for an exercise.
 * Returns the default value if not found, version mismatch, or on error.
 */
export function loadVersionedDifficulty(
  exerciseId: string,
  defaultValue: number,
  expectedVersion: number
): number {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}difficulty:${exerciseId}`);
    if (stored !== null) {
      // Try parsing as versioned JSON first
      try {
        const data = JSON.parse(stored);
        if (
          typeof data === "object" &&
          data !== null &&
          typeof data.value === "number" &&
          data.version === expectedVersion
        ) {
          return data.value;
        }
        // Version mismatch or invalid format - return default
      } catch {
        // Not JSON - might be old unversioned value, ignore it
      }
    }
  } catch {
    // localStorage may be unavailable
  }
  return defaultValue;
}
