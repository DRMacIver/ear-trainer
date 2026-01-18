/**
 * Audio utilities for generating pure tones using Web Audio API.
 */

// Note names within an octave (C to B)
const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

// A4 = 440 Hz, calculate all frequencies using equal temperament
// Each semitone is 2^(1/12) times the previous
function calculateFrequency(note: string, octave: number): number {
  const noteIndex = NOTE_NAMES.indexOf(note);
  // A4 is at index 9 in octave 4
  const semitonesFromA4 = (octave - 4) * 12 + (noteIndex - 9);
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

// Generate frequencies for octaves 3, 4, and 5
export const NOTE_FREQUENCIES: Record<string, number> = {};
export const OCTAVES = [3, 4, 5];

for (const octave of OCTAVES) {
  for (const note of NOTE_NAMES) {
    const fullName = `${note}${octave}`;
    NOTE_FREQUENCIES[fullName] = calculateFrequency(note, octave);
  }
}

// All notes in order (C3 to B5)
export const ALL_NOTES = Object.keys(NOTE_FREQUENCIES);

// Notes for just octave 4 (used by exercises for now)
export const OCTAVE_4_NOTES = NOTE_NAMES.map((n) => `${n}4`);

/**
 * Get all notes for a specific octave.
 */
export function getNotesForOctave(octave: number): string[] {
  return NOTE_NAMES.map((n) => `${n}${octave}`);
}

let audioContext: AudioContext | null = null;
let activePlayCount = 0;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/**
 * Check if any audio is currently playing.
 */
export function isPlaying(): boolean {
  return activePlayCount > 0;
}

export interface PlayOptions {
  duration?: number; // in seconds
  volume?: number; // 0-1
}

/**
 * Play a pure tone at the specified frequency.
 * Returns a Promise that resolves when playback completes.
 */
export function playFrequency(
  frequency: number,
  options: PlayOptions = {}
): Promise<void> {
  const { duration = 0.5, volume = 0.3 } = options;
  const ctx = getAudioContext();

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.type = "sine";
  oscillator.frequency.value = frequency;

  // Envelope to avoid clicks
  const now = ctx.currentTime;
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
  gainNode.gain.linearRampToValueAtTime(volume, now + duration - 0.05);
  gainNode.gain.linearRampToValueAtTime(0, now + duration);

  oscillator.start(now);
  oscillator.stop(now + duration);

  activePlayCount++;
  return new Promise((resolve) => {
    oscillator.onended = () => {
      activePlayCount--;
      resolve();
    };
  });
}

/**
 * Play a note by name (e.g., "A4", "C#4").
 * Returns a Promise that resolves when playback completes.
 */
export function playNote(note: string, options: PlayOptions = {}): Promise<void> {
  const frequency = NOTE_FREQUENCIES[note];
  if (frequency === undefined) {
    throw new Error(`Unknown note: ${note}`);
  }
  return playFrequency(frequency, options);
}

/**
 * Select n random notes from the available notes.
 * By default, only uses octave 4 notes for exercises.
 */
export function selectRandomNotes(
  count: number,
  fromNotes: string[] = OCTAVE_4_NOTES
): string[] {
  const shuffled = [...fromNotes].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Get the chromatic index (0-11) of a note, ignoring octave.
 * C=0, C#=1, D=2, etc.
 */
export function getChromaticIndex(note: string): number {
  // Extract note name without octave
  const noteName = note.replace(/\d+$/, "");
  return NOTE_NAMES.indexOf(noteName);
}

/**
 * Check if two notes are semitones (adjacent in chromatic scale).
 * This considers wrapping (B and C are semitones).
 */
export function areSemitones(note1: string, note2: string): boolean {
  const idx1 = getChromaticIndex(note1);
  const idx2 = getChromaticIndex(note2);
  const diff = Math.abs(idx1 - idx2);
  return diff === 1 || diff === 11; // 11 handles B-C wrapping
}

/**
 * Select n random notes ensuring no two are semitones of each other.
 * By default, only uses octave 4 notes for exercises.
 */
export function selectWellSeparatedNotes(
  count: number,
  fromNotes: string[] = OCTAVE_4_NOTES
): string[] {
  const shuffled = shuffle([...fromNotes]);
  const selected: string[] = [];

  for (const note of shuffled) {
    if (selected.length >= count) break;

    // Check if this note is a semitone of any already selected
    const isTooClose = selected.some((s) => areSemitones(note, s));
    if (!isTooClose) {
      selected.push(note);
    }
  }

  // Fallback: if we couldn't find enough well-separated notes, just return what we have
  // plus fill with remaining shuffled notes (shouldn't happen with 12 notes and count <= 6)
  if (selected.length < count) {
    for (const note of shuffled) {
      if (selected.length >= count) break;
      if (!selected.includes(note)) {
        selected.push(note);
      }
    }
  }

  return selected;
}

/**
 * Shuffle an array (Fisher-Yates).
 */
export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
