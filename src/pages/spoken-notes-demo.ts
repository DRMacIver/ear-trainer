/**
 * Demo page for spoken note audio files.
 *
 * Plays autotuned note names - each note name (C, D, E, etc.) is spoken
 * at the actual pitch of that note.
 */

const C_MAJOR_SCALE = ["C", "D", "E", "F", "G", "A", "B"] as const;

export function renderSpokenNotesDemo(): void {
  const app = document.getElementById("app")!;

  app.innerHTML = `
    <h1>Spoken Notes Demo</h1>
    <p><a href="#/">← Back to index</a></p>

    <p>
      Each button plays the note name spoken at that note's pitch.
      For example, "C" is spoken at 261.63 Hz (C4).
    </p>

    <div class="spoken-notes-controls">
      <div class="note-buttons">
        ${C_MAJOR_SCALE.map(
          (note) => `
          <button class="note-btn" data-note="${note}">
            ${note}
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
      .spoken-notes-controls {
        margin-top: 2rem;
      }

      .note-buttons {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        margin-bottom: 1rem;
      }

      .note-btn {
        font-size: 1.5rem;
        padding: 1rem 1.5rem;
        min-width: 4rem;
        cursor: pointer;
        border: 2px solid #333;
        border-radius: 8px;
        background: #f0f0f0;
        transition: all 0.1s;
      }

      .note-btn:hover {
        background: #e0e0e0;
      }

      .note-btn.playing {
        background: #4CAF50;
        color: white;
        border-color: #45a049;
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

    const btn = document.querySelector(
      `.note-btn[data-note="${note}"]`
    ) as HTMLButtonElement;
    if (btn) {
      btn.classList.add("playing");
    }

    currentAudio = new Audio(`/audio/spoken-notes/${note}4.wav`);
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
    playNote(C_MAJOR_SCALE[index]);

    scaleInterval = window.setInterval(() => {
      index++;
      if (index < C_MAJOR_SCALE.length) {
        playNote(C_MAJOR_SCALE[index]);
      } else {
        if (scaleInterval !== null) {
          clearInterval(scaleInterval);
          scaleInterval = null;
        }
      }
    }, 800); // ~0.5s note + 0.3s gap
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
