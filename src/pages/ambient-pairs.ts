/**
 * Ambient note pair training - continuous loop for passive listening.
 *
 * Sequence per pair:
 * 1. Play pair as tones (2s each)
 * 2. Pause 3s
 * 3. Repeat pair as tones
 * 4. Play solfege for pair
 * 5. Play scale between notes (tones)
 * 6. Play scale as solfege
 * 7. Play pair again, fading out last note
 * 8. Short pause, then 30% swap / 70% new pair
 */

import { NOTE_FREQUENCIES } from "../audio.js";

// C Major scale notes in octave 4
const C_MAJOR_NOTES = ["C4", "D4", "E4", "F4", "G4", "A4", "B4"];

// Map note names to solfege syllables and MIDI numbers for Jennifer samples
const NOTE_TO_SOLFEGE: Record<string, { syllable: string; midi: number }> = {
  C4: { syllable: "do", midi: 60 },
  D4: { syllable: "re", midi: 62 },
  E4: { syllable: "mi", midi: 64 },
  F4: { syllable: "fa", midi: 65 },
  G4: { syllable: "so", midi: 67 },
  A4: { syllable: "la", midi: 69 },
  B4: { syllable: "ti", midi: 71 },
};

// Note indices for scale generation
const NOTE_INDEX: Record<string, number> = {
  C4: 0,
  D4: 1,
  E4: 2,
  F4: 3,
  G4: 4,
  A4: 5,
  B4: 6,
};

// Timing constants to match solfege samples (1.75s each)
const NOTE_DURATION = 1.75; // Match Jennifer sample length
const SCALE_NOTE_DURATION = 0.8; // For scale runs
const NOTE_GAP = 300; // Gap between notes in ms
const SCALE_GAP = 400; // Gap between scale notes in ms
const TONE_VOLUME = 0.8; // Peak amplitude for tones
const SOLFEGE_VOLUME = 0.5; // Reduce solfege to match perceived tone loudness

let isRunning = false;
let currentAudio: HTMLAudioElement | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRandomPair(): [string, string] {
  const shuffled = [...C_MAJOR_NOTES].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

function getScaleBetween(note1: string, note2: string): string[] {
  const idx1 = NOTE_INDEX[note1];
  const idx2 = NOTE_INDEX[note2];
  const start = Math.min(idx1, idx2);
  const end = Math.max(idx1, idx2);

  const scale: string[] = [];
  for (let i = start; i <= end; i++) {
    scale.push(C_MAJOR_NOTES[i]);
  }

  // If note1 > note2, reverse so we go in the right direction
  if (idx1 > idx2) {
    scale.reverse();
  }

  return scale;
}

async function playTone(
  note: string,
  duration: number,
  fadeOutDuration?: number
): Promise<void> {
  if (!isRunning) return;

  const frequency = NOTE_FREQUENCIES[note];
  const ctx = new AudioContext();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.type = "sine";
  oscillator.frequency.value = frequency;

  const now = ctx.currentTime;
  const fadeOut = fadeOutDuration ?? 0.05;

  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(TONE_VOLUME, now + 0.01);
  gainNode.gain.setValueAtTime(TONE_VOLUME, now + duration - fadeOut);
  gainNode.gain.linearRampToValueAtTime(0, now + duration);

  oscillator.start(now);
  oscillator.stop(now + duration);

  await new Promise<void>((resolve) => {
    oscillator.onended = () => {
      ctx.close();
      resolve();
    };
  });
}

async function playSolfege(note: string): Promise<void> {
  if (!isRunning) return;

  const info = NOTE_TO_SOLFEGE[note];
  if (!info) return;

  const filename = `note${String(info.midi).padStart(3, "0")}-${info.syllable}.wav`;
  const url = `/audio/solfege/jennifer/${filename}`;

  return new Promise((resolve) => {
    currentAudio = new Audio(url);
    currentAudio.volume = SOLFEGE_VOLUME;
    currentAudio.addEventListener("ended", () => {
      currentAudio = null;
      resolve();
    });
    currentAudio.addEventListener("error", () => {
      currentAudio = null;
      resolve();
    });
    currentAudio.play();
  });
}

async function playPairAsTones(
  note1: string,
  note2: string,
  duration: number = NOTE_DURATION,
  lastFadeOut?: number
): Promise<void> {
  await playTone(note1, duration);
  if (!isRunning) return;
  await sleep(NOTE_GAP);
  if (!isRunning) return;
  await playTone(note2, duration, lastFadeOut);
}

async function playPairAsSolfege(note1: string, note2: string): Promise<void> {
  await playSolfege(note1);
  if (!isRunning) return;
  await sleep(NOTE_GAP);
  if (!isRunning) return;
  await playSolfege(note2);
}

async function playScaleAsTones(notes: string[]): Promise<void> {
  for (let i = 0; i < notes.length; i++) {
    if (!isRunning) return;
    await playTone(notes[i], SCALE_NOTE_DURATION);
    if (i < notes.length - 1) {
      await sleep(SCALE_GAP);
    }
  }
}

async function playScaleAsSolfege(notes: string[]): Promise<void> {
  for (let i = 0; i < notes.length; i++) {
    if (!isRunning) return;
    await playSolfege(notes[i]);
    if (i < notes.length - 1) {
      await sleep(SCALE_GAP);
    }
  }
}

async function runSequence(
  note1: string,
  note2: string,
  updateStatus: (msg: string) => void
): Promise<void> {
  // 1. Play pair as tones
  updateStatus(`Playing: ${note1} - ${note2} (tones)`);
  await playPairAsTones(note1, note2);
  if (!isRunning) return;

  // 2. Pause 3s
  updateStatus("Pause...");
  await sleep(3000);
  if (!isRunning) return;

  // 3. Repeat pair as tones
  updateStatus(`Repeat: ${note1} - ${note2} (tones)`);
  await playPairAsTones(note1, note2);
  if (!isRunning) return;

  // 4. Play solfege for pair
  const s1 = NOTE_TO_SOLFEGE[note1].syllable;
  const s2 = NOTE_TO_SOLFEGE[note2].syllable;
  updateStatus(`Solfege: ${s1} - ${s2}`);
  await playPairAsSolfege(note1, note2);
  if (!isRunning) return;

  // 5. Play scale between notes (tones)
  const scale = getScaleBetween(note1, note2);
  updateStatus(`Scale (tones): ${scale.join(" → ")}`);
  await playScaleAsTones(scale);
  if (!isRunning) return;

  // 6. Play scale as solfege
  const scaleNames = scale.map((n) => NOTE_TO_SOLFEGE[n].syllable);
  updateStatus(`Scale (solfege): ${scaleNames.join(" → ")}`);
  await playScaleAsSolfege(scale);
  if (!isRunning) return;

  // 7. Play pair again with longer fade on last note
  updateStatus(`Final: ${note1} - ${note2} (fading)`);
  await playPairAsTones(note1, note2, NOTE_DURATION, 1.5);
  if (!isRunning) return;

  // Short pause before next
  await sleep(1500);
}

async function mainLoop(updateStatus: (msg: string) => void): Promise<void> {
  let [note1, note2] = pickRandomPair();

  while (isRunning) {
    await runSequence(note1, note2, updateStatus);
    if (!isRunning) break;

    // 30% chance to swap, 70% new pair
    if (Math.random() < 0.3) {
      [note1, note2] = [note2, note1];
      updateStatus("(Swapping pair...)");
    } else {
      [note1, note2] = pickRandomPair();
      updateStatus("(New pair...)");
    }
    await sleep(500);
  }
}

export function renderAmbientPairs(): void {
  const app = document.getElementById("app")!;

  app.innerHTML = `
    <h1>Ambient Note Pairs</h1>
    <p><a href="#/">← Back to index</a></p>

    <p>
      Continuous training loop for passive listening. Put on headphones and
      let the note pairs wash over you while doing other activities.
    </p>

    <div class="controls">
      <button id="start-btn" class="primary">Start ▶</button>
      <button id="stop-btn" disabled>Stop ⏹</button>
    </div>

    <div id="status" class="status">Ready</div>

    <div class="info">
      <h3>Sequence per pair:</h3>
      <ol>
        <li>Play note pair as tones (1.75s each)</li>
        <li>Pause (3s)</li>
        <li>Repeat pair as tones</li>
        <li>Play solfege for pair</li>
        <li>Play scale between notes (tones)</li>
        <li>Play scale as solfege</li>
        <li>Play pair again with fade</li>
        <li>30% chance to swap pair, otherwise new random pair</li>
      </ol>
    </div>

    <style>
      .controls {
        margin: 2rem 0;
        display: flex;
        gap: 1rem;
      }

      .controls button {
        font-size: 1.2rem;
        padding: 1rem 2rem;
        cursor: pointer;
        border: 2px solid #333;
        border-radius: 8px;
      }

      .controls button.primary {
        background: #4CAF50;
        color: white;
        border-color: #45a049;
      }

      .controls button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .status {
        font-size: 1.5rem;
        padding: 1rem;
        background: #f0f0f0;
        border-radius: 8px;
        margin: 1rem 0;
        min-height: 2em;
      }

      .info {
        margin-top: 2rem;
        padding: 1rem;
        background: #f9f9f9;
        border-radius: 8px;
      }

      .info h3 {
        margin-top: 0;
      }

      .info ol {
        margin-bottom: 0;
      }
    </style>
  `;

  const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
  const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
  const statusDiv = document.getElementById("status")!;

  function updateStatus(msg: string): void {
    statusDiv.textContent = msg;
  }

  startBtn.addEventListener("click", () => {
    isRunning = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    mainLoop(updateStatus).then(() => {
      updateStatus("Stopped");
      startBtn.disabled = false;
      stopBtn.disabled = true;
    });
  });

  stopBtn.addEventListener("click", () => {
    isRunning = false;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
  });
}
