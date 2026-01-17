/**
 * Note Playground
 *
 * A page to explore and play with different notes, with explanatory text
 * about musical notation.
 */

import {
  OCTAVES,
  getNotesForOctave,
  NOTE_FREQUENCIES,
  playNote,
} from "../audio.js";

export function renderPlayground(): void {
  const app = document.getElementById("app")!;

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Note Playground</h1>
    <p>Click any note to hear what it sounds like.</p>

    <div class="playground-container">
      <div id="piano-sections"></div>

      <div class="notation-guide">
        <h2>Understanding Note Notation</h2>

        <h3>Note Names</h3>
        <p>
          Western music uses seven natural notes: <strong>A, B, C, D, E, F, G</strong>.
          These repeat in a cycle, with each complete cycle called an <em>octave</em>.
          The sequence goes: C, D, E, F, G, A, B, then back to C.
        </p>

        <h3>Sharps and Flats</h3>
        <p>
          Between most natural notes are additional notes called <em>sharps</em> (#) and <em>flats</em> (♭).
        </p>
        <ul>
          <li><strong>Sharp (#)</strong> raises a note by a half step. C# is between C and D.</li>
          <li><strong>Flat (♭)</strong> lowers a note by a half step. D♭ is also between C and D.</li>
          <li>C# and D♭ are the same pitch, just named differently depending on context.</li>
        </ul>
        <p>
          There are no sharps/flats between B-C and E-F (these pairs are already a half step apart).
        </p>

        <h3>Octave Numbers</h3>
        <p>
          To distinguish between the same note at different pitches, we add octave numbers.
          <strong>A4</strong> is the A above middle C, standardized at 440 Hz.
          Higher numbers mean higher pitch:
        </p>
        <ul>
          <li><strong>C4</strong> is "middle C" on a piano</li>
          <li><strong>C5</strong> is one octave higher than C4 (double the frequency)</li>
          <li><strong>C3</strong> is one octave lower than C4 (half the frequency)</li>
        </ul>

        <h3>Frequencies</h3>
        <p>
          Each note corresponds to a specific frequency (vibrations per second, measured in Hz).
          Modern tuning uses <strong>A4 = 440 Hz</strong> as the reference pitch.
          Each octave doubles the frequency, so A5 = 880 Hz and A3 = 220 Hz.
        </p>

        <div class="frequency-table">
          <h4>All Notes (Octaves 3-5)</h4>
          <div class="frequency-tables-grid" id="frequency-tables"></div>
        </div>
      </div>
    </div>
  `;

  renderPianoNotes();
  renderFrequencyTable();
}

function renderPianoNotes(): void {
  const container = document.getElementById("piano-sections")!;

  for (const octave of OCTAVES) {
    const section = document.createElement("div");
    section.className = "octave-section";

    const label = document.createElement("div");
    label.className = "octave-label";
    label.textContent = `Octave ${octave}`;
    section.appendChild(label);

    const notesDiv = document.createElement("div");
    notesDiv.className = "piano-notes";

    for (const note of getNotesForOctave(octave)) {
      const button = document.createElement("button");
      button.className = "piano-key";
      if (note.includes("#")) {
        button.classList.add("black-key");
      }
      button.textContent = note;
      button.addEventListener("click", () => {
        playNote(note, { duration: 0.8 });
        button.classList.add("playing");
        setTimeout(() => button.classList.remove("playing"), 200);
      });
      notesDiv.appendChild(button);
    }

    section.appendChild(notesDiv);
    container.appendChild(section);
  }
}

function renderFrequencyTable(): void {
  const container = document.getElementById("frequency-tables")!;

  for (const octave of OCTAVES) {
    const tableDiv = document.createElement("div");

    const table = document.createElement("table");
    table.innerHTML = `
      <thead>
        <tr>
          <th colspan="2">Octave ${octave}</th>
        </tr>
        <tr>
          <th>Note</th>
          <th>Hz</th>
        </tr>
      </thead>
    `;

    const tbody = document.createElement("tbody");
    for (const note of getNotesForOctave(octave)) {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${note}</td>
        <td>${NOTE_FREQUENCIES[note].toFixed(1)}</td>
      `;
      row.style.cursor = "pointer";
      row.addEventListener("click", () => playNote(note, { duration: 0.8 }));
      tbody.appendChild(row);
    }

    table.appendChild(tbody);
    tableDiv.appendChild(table);
    container.appendChild(tableDiv);
  }
}
