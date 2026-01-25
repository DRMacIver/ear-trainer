/**
 * Demo page for solfege audio samples.
 *
 * Uses samples from https://github.com/wcgbg/solfege-samples (GPL-3.0)
 * Katy voice bank - high quality female voice singing solfege syllables.
 */

// Map note names to MIDI numbers and solfege syllables
const NOTE_DATA = [
  { note: "C", midi: 60, solfege: "do" },
  { note: "D", midi: 62, solfege: "re" },
  { note: "E", midi: 64, solfege: "mi" },
  { note: "F", midi: 65, solfege: "fa" },
  { note: "G", midi: 67, solfege: "so" },
  { note: "A", midi: 69, solfege: "la" },
  { note: "B", midi: 71, solfege: "ti" },
  { note: "C5", midi: 72, solfege: "do", octave: 5 },
] as const;

export function renderSolfegeDemo(): void {
  const app = document.getElementById("app")!;

  app.innerHTML = `
    <h1>Solfege Demo</h1>
    <p><a href="#/">← Back to index</a></p>

    <p>
      Each button plays a sung solfege syllable at that note's pitch.
      Samples from <a href="https://github.com/wcgbg/solfege-samples">wcgbg/solfege-samples</a> (GPL-3.0).
    </p>

    <div class="solfege-controls">
      <div class="note-buttons">
        ${NOTE_DATA.map(
          ({ note, solfege }) => `
          <button class="note-btn" data-note="${note}">
            <span class="note-name">${note}</span>
            <span class="solfege-name">${solfege}</span>
          </button>
        `
        ).join("")}
      </div>

      <div class="playback-controls">
        <button id="play-scale">Play Scale ▶</button>
        <button id="stop">Stop ⏹</button>
      </div>
    </div>

    <style>
      .solfege-controls {
        margin-top: 2rem;
      }

      .note-buttons {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        margin-bottom: 1rem;
      }

      .note-btn {
        font-size: 1.2rem;
        padding: 0.75rem 1rem;
        min-width: 4rem;
        cursor: pointer;
        border: 2px solid #333;
        border-radius: 8px;
        background: #f0f0f0;
        transition: all 0.1s;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
      }

      .note-btn .note-name {
        font-weight: bold;
      }

      .note-btn .solfege-name {
        font-size: 0.9rem;
        color: #666;
      }

      .note-btn:hover {
        background: #e0e0e0;
      }

      .note-btn.playing {
        background: #4CAF50;
        color: white;
        border-color: #45a049;
      }

      .note-btn.playing .solfege-name {
        color: rgba(255, 255, 255, 0.8);
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
  let scaleInterval: number | null = null;

  function stopPlayback(): void {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    if (scaleInterval !== null) {
      clearInterval(scaleInterval);
      scaleInterval = null;
    }
    document
      .querySelectorAll(".note-btn.playing")
      .forEach((btn) => btn.classList.remove("playing"));
  }

  function playNote(note: string): void {
    stopPlayback();

    const noteInfo = NOTE_DATA.find((n) => n.note === note);
    if (!noteInfo) return;

    const btn = document.querySelector(
      `.note-btn[data-note="${note}"]`
    ) as HTMLButtonElement;
    if (btn) {
      btn.classList.add("playing");
    }

    const filename = `note${String(noteInfo.midi).padStart(3, "0")}-${noteInfo.solfege}.wav`;
    currentAudio = new Audio(`/audio/solfege/${filename}`);
    currentAudio.addEventListener("ended", () => {
      if (btn) {
        btn.classList.remove("playing");
      }
      currentAudio = null;
    });
    currentAudio.play();
  }

  function playScale(): void {
    stopPlayback();

    let index = 0;
    playNote(NOTE_DATA[index].note);

    scaleInterval = window.setInterval(() => {
      index++;
      if (index < NOTE_DATA.length) {
        playNote(NOTE_DATA[index].note);
      } else {
        if (scaleInterval !== null) {
          clearInterval(scaleInterval);
          scaleInterval = null;
        }
      }
    }, 600);
  }

  // Event listeners
  document.querySelectorAll(".note-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const note = (btn as HTMLElement).dataset.note!;
      playNote(note);
    });
  });

  document.getElementById("play-scale")!.addEventListener("click", playScale);
  document.getElementById("stop")!.addEventListener("click", stopPlayback);
}
