/**
 * Demo page for solfege audio samples.
 *
 * Uses samples from https://github.com/wcgbg/solfege-samples (GPL-3.0)
 */

// Voice configurations with their available MIDI note ranges
const VOICES = {
  katy: { name: "Katy", description: "Female, high quality", minMidi: 60, maxMidi: 72 },
  jennifer: { name: "Jennifer", description: "Female, amateur", minMidi: 48, maxMidi: 83 },
  chengu: { name: "Chengu", description: "Male, author", minMidi: 36, maxMidi: 81 },
  daisy: { name: "Daisy", description: "Synthesized", minMidi: 24, maxMidi: 107 },
} as const;

type VoiceId = keyof typeof VOICES;

// Map MIDI note number to solfege syllable (chromatic scale)
// Using the naming from the samples
const MIDI_TO_SOLFEGE: Record<number, string> = {};
const SOLFEGE_CYCLE = ["do", "ga", "re", "nu", "mi", "fa", "jur", "so", "ki", "la", "pe", "ti"];
for (let midi = 0; midi <= 127; midi++) {
  MIDI_TO_SOLFEGE[midi] = SOLFEGE_CYCLE[midi % 12];
}

// Note names for display
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiToOctave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

export function renderSolfegeDemo(): void {
  const app = document.getElementById("app")!;

  app.innerHTML = `
    <h1>Solfege Demo</h1>
    <p><a href="#/">← Back to index</a></p>

    <p>
      Sung solfege samples from
      <a href="https://github.com/wcgbg/solfege-samples">wcgbg/solfege-samples</a> (GPL-3.0).
    </p>

    <div class="solfege-controls">
      <div class="voice-selector">
        <label>Voice: </label>
        <select id="voice-select">
          ${Object.entries(VOICES)
            .map(
              ([id, v]) =>
                `<option value="${id}">${v.name} (${v.description})</option>`
            )
            .join("")}
        </select>
      </div>

      <div class="octave-selector">
        <label>Octave: </label>
        <select id="octave-select"></select>
      </div>

      <div id="note-grid" class="note-grid"></div>

      <div class="playback-controls">
        <button id="play-scale">Play Scale ▶</button>
        <button id="stop">Stop ⏹</button>
      </div>
    </div>

    <style>
      .solfege-controls {
        margin-top: 1rem;
      }

      .voice-selector, .octave-selector {
        margin-bottom: 1rem;
      }

      .voice-selector select, .octave-selector select {
        font-size: 1rem;
        padding: 0.5rem;
      }

      .note-grid {
        display: grid;
        grid-template-columns: repeat(12, 1fr);
        gap: 0.25rem;
        margin-bottom: 1rem;
        max-width: 800px;
      }

      .note-btn {
        font-size: 0.9rem;
        padding: 0.5rem 0.25rem;
        cursor: pointer;
        border: 2px solid #333;
        border-radius: 4px;
        background: #f0f0f0;
        transition: all 0.1s;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.15rem;
      }

      .note-btn .note-name {
        font-weight: bold;
        font-size: 0.8rem;
      }

      .note-btn .solfege-name {
        font-size: 0.7rem;
        color: #666;
      }

      .note-btn:hover:not(:disabled) {
        background: #e0e0e0;
      }

      .note-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      .note-btn.playing {
        background: #4CAF50;
        color: white;
        border-color: #45a049;
      }

      .note-btn.playing .solfege-name {
        color: rgba(255, 255, 255, 0.8);
      }

      .note-btn.sharp {
        background: #333;
        color: white;
      }

      .note-btn.sharp .solfege-name {
        color: #aaa;
      }

      .note-btn.sharp:hover:not(:disabled) {
        background: #555;
      }

      .note-btn.sharp.playing {
        background: #2E7D32;
      }

      .playback-controls {
        display: flex;
        gap: 1rem;
        margin-top: 1rem;
      }

      .playback-controls button {
        font-size: 1rem;
        padding: 0.75rem 1.5rem;
        cursor: pointer;
      }
    </style>
  `;

  let currentAudio: HTMLAudioElement | null = null;
  let scaleTimeout: number | null = null;
  let currentVoice: VoiceId = "chengu";
  let currentOctave = 4;

  const voiceSelect = document.getElementById("voice-select") as HTMLSelectElement;
  const octaveSelect = document.getElementById("octave-select") as HTMLSelectElement;
  const noteGrid = document.getElementById("note-grid")!;

  function updateOctaveOptions(): void {
    const voice = VOICES[currentVoice];
    const minOctave = midiToOctave(voice.minMidi);
    const maxOctave = midiToOctave(voice.maxMidi);

    octaveSelect.innerHTML = "";
    for (let oct = minOctave; oct <= maxOctave; oct++) {
      const option = document.createElement("option");
      option.value = String(oct);
      option.textContent = String(oct);
      octaveSelect.appendChild(option);
    }

    // Keep current octave if in range, otherwise use middle
    if (currentOctave < minOctave || currentOctave > maxOctave) {
      currentOctave = Math.floor((minOctave + maxOctave) / 2);
    }
    octaveSelect.value = String(currentOctave);
  }

  function updateNoteGrid(): void {
    const voice = VOICES[currentVoice];
    const baseMidi = (currentOctave + 1) * 12; // C of this octave

    noteGrid.innerHTML = "";
    for (let i = 0; i < 12; i++) {
      const midi = baseMidi + i;
      const noteName = NOTE_NAMES[i];
      const solfege = MIDI_TO_SOLFEGE[midi];
      const isSharp = noteName.includes("#");
      const isAvailable = midi >= voice.minMidi && midi <= voice.maxMidi;

      const btn = document.createElement("button");
      btn.className = `note-btn${isSharp ? " sharp" : ""}`;
      btn.dataset.midi = String(midi);
      btn.disabled = !isAvailable;
      btn.innerHTML = `
        <span class="note-name">${noteName}</span>
        <span class="solfege-name">${solfege}</span>
      `;
      noteGrid.appendChild(btn);
    }

    // Re-attach click handlers
    noteGrid.querySelectorAll(".note-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if ((btn as HTMLButtonElement).disabled) return;
        const midi = parseInt((btn as HTMLElement).dataset.midi!, 10);
        playNote(midi);
      });
    });
  }

  function stopPlayback(): void {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    if (scaleTimeout !== null) {
      clearTimeout(scaleTimeout);
      scaleTimeout = null;
    }
    document.querySelectorAll(".note-btn.playing").forEach((btn) => btn.classList.remove("playing"));
  }

  function playNote(midi: number): void {
    stopPlayback();

    const solfege = MIDI_TO_SOLFEGE[midi];
    const filename = `note${String(midi).padStart(3, "0")}-${solfege}.wav`;
    const url = `/audio/solfege/${currentVoice}/${filename}`;

    const btn = noteGrid.querySelector(`.note-btn[data-midi="${midi}"]`);
    if (btn) {
      btn.classList.add("playing");
    }

    currentAudio = new Audio(url);
    currentAudio.addEventListener("ended", () => {
      if (btn) {
        btn.classList.remove("playing");
      }
      currentAudio = null;
    });
    currentAudio.addEventListener("error", () => {
      console.error(`Failed to load: ${url}`);
      if (btn) {
        btn.classList.remove("playing");
      }
    });
    currentAudio.play();
  }

  function playScale(): void {
    stopPlayback();

    const voice = VOICES[currentVoice];
    const baseMidi = (currentOctave + 1) * 12;
    const majorScaleIntervals = [0, 2, 4, 5, 7, 9, 11, 12]; // C major scale + octave
    const notesToPlay = majorScaleIntervals
      .map((i) => baseMidi + i)
      .filter((midi) => midi >= voice.minMidi && midi <= voice.maxMidi);

    let index = 0;

    function playNext(): void {
      if (index < notesToPlay.length) {
        playNote(notesToPlay[index]);
        index++;
        scaleTimeout = window.setTimeout(playNext, 600);
      }
    }

    playNext();
  }

  // Event listeners
  voiceSelect.addEventListener("change", () => {
    currentVoice = voiceSelect.value as VoiceId;
    updateOctaveOptions();
    updateNoteGrid();
  });

  octaveSelect.addEventListener("change", () => {
    currentOctave = parseInt(octaveSelect.value, 10);
    updateNoteGrid();
  });

  document.getElementById("play-scale")!.addEventListener("click", playScale);
  document.getElementById("stop")!.addEventListener("click", stopPlayback);

  // Initialize
  updateOctaveOptions();
  updateNoteGrid();
}
