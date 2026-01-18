/**
 * Note Matching Exercise
 *
 * Plays a set of notes and asks the user to match note names to sounds
 * by dragging them to the correct positions.
 */

import { playNote, selectWellSeparatedNotes, shuffle } from "../audio.js";

const NOTE_DURATION = 0.5;
const NOTE_GAP = 0.15;

interface ExerciseState {
  // The notes being tested (in the order they're displayed as buttons)
  targetNotes: string[];
  // Current assignments: targetNotes index -> assigned note name (or null)
  assignments: (string | null)[];
  // Notes that haven't been assigned yet
  availableNotes: string[];
  // Whether the user has checked and some are wrong
  hasChecked: boolean;
  // Which positions are marked incorrect (indices)
  incorrectPositions: Set<number>;
  // Whether exercise is complete (all correct)
  isComplete: boolean;
}

let state: ExerciseState;

const NOTE_COUNT = 3;

function initExercise(): void {
  const targetNotes = selectWellSeparatedNotes(NOTE_COUNT);
  state = {
    targetNotes,
    assignments: new Array(NOTE_COUNT).fill(null),
    availableNotes: shuffle([...targetNotes]),
    hasChecked: false,
    incorrectPositions: new Set(),
    isComplete: false,
  };
}

function render(): void {
  const app = document.getElementById("app")!;

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>Note Matching</h1>
    <p>Click the play buttons to hear each note, then drag the note names below to match each sound.</p>

    <div class="exercise-container">
      <div class="sound-buttons" id="sound-buttons"></div>

      <div>
        <h3>Available Notes</h3>
        <div class="available-notes" id="available-notes"></div>
      </div>

      <div class="controls">
        <button class="check-button" id="check-btn">Check Answers</button>
        <button class="next-button" id="next-btn" style="display: none;">Next Exercise</button>
      </div>

      <div id="feedback"></div>
    </div>
  `;

  renderSoundButtons();
  renderAvailableNotes();
  setupEventListeners();
}

function renderSoundButtons(): void {
  const container = document.getElementById("sound-buttons")!;
  container.innerHTML = "";

  state.targetNotes.forEach((note, index) => {
    const div = document.createElement("div");
    div.className = "sound-button";

    const button = document.createElement("button");
    button.textContent = `Sound ${index + 1}`;
    button.addEventListener("click", () => playNote(note));

    const dropZone = document.createElement("div");
    dropZone.className = "drop-zone";
    dropZone.dataset.index = String(index);

    if (state.hasChecked) {
      if (state.incorrectPositions.has(index)) {
        dropZone.classList.add("incorrect");
      } else if (state.assignments[index] !== null) {
        dropZone.classList.add("correct");
      }
    }

    const assignedNote = state.assignments[index];
    if (assignedNote) {
      const chip = createNoteChip(assignedNote);
      dropZone.appendChild(chip);
    }

    setupDropZone(dropZone);

    div.appendChild(button);
    div.appendChild(dropZone);
    container.appendChild(div);
  });
}

function renderAvailableNotes(): void {
  const container = document.getElementById("available-notes")!;
  container.innerHTML = "";

  state.availableNotes.forEach((note) => {
    const chip = createNoteChip(note);
    container.appendChild(chip);
  });

  setupAvailableNotesDropZone(container);
}

function createNoteChip(note: string): HTMLElement {
  const chip = document.createElement("div");
  chip.className = "note-chip";
  chip.textContent = note;
  chip.draggable = true;
  chip.dataset.note = note;

  chip.addEventListener("dragstart", (e) => {
    chip.classList.add("dragging");
    e.dataTransfer!.setData("text/plain", note);
    e.dataTransfer!.effectAllowed = "move";
  });

  chip.addEventListener("dragend", () => {
    chip.classList.remove("dragging");
  });

  return chip;
}

function setupDropZone(dropZone: HTMLElement): void {
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");

    const note = e.dataTransfer!.getData("text/plain");
    const targetIndex = parseInt(dropZone.dataset.index!, 10);

    // Find where the dragged note came from
    const sourceAssignmentIndex = state.assignments.indexOf(note);
    const sourceAvailableIndex = state.availableNotes.indexOf(note);
    const existingNote = state.assignments[targetIndex];

    // Remove from available notes if it was there
    if (sourceAvailableIndex !== -1) {
      state.availableNotes.splice(sourceAvailableIndex, 1);
      // If target has a note, it goes to available
      if (existingNote) {
        state.availableNotes.push(existingNote);
      }
    }

    // If dragged from another assignment slot, swap
    if (sourceAssignmentIndex !== -1 && sourceAssignmentIndex !== targetIndex) {
      state.assignments[sourceAssignmentIndex] = existingNote;
    }

    // Assign to new position
    state.assignments[targetIndex] = note;

    // Clear checked state when user makes changes
    if (state.hasChecked) {
      state.hasChecked = false;
      state.incorrectPositions.clear();
    }

    renderSoundButtons();
    renderAvailableNotes();
    updateCheckButton();
  });
}

function setupAvailableNotesDropZone(container: HTMLElement): void {
  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    container.classList.add("drag-over");
  });

  container.addEventListener("dragleave", () => {
    container.classList.remove("drag-over");
  });

  container.addEventListener("drop", (e) => {
    e.preventDefault();
    container.classList.remove("drag-over");

    const note = e.dataTransfer!.getData("text/plain");

    // Remove from assignments if it was assigned
    const assignmentIndex = state.assignments.indexOf(note);
    if (assignmentIndex !== -1) {
      state.assignments[assignmentIndex] = null;
    }

    // Add to available if not already there
    if (!state.availableNotes.includes(note)) {
      state.availableNotes.push(note);
    }

    // Clear checked state when user makes changes
    if (state.hasChecked) {
      state.hasChecked = false;
      state.incorrectPositions.clear();
    }

    renderSoundButtons();
    renderAvailableNotes();
    updateCheckButton();
  });
}

function setupEventListeners(): void {
  const checkBtn = document.getElementById("check-btn")!;
  const nextBtn = document.getElementById("next-btn")!;

  checkBtn.addEventListener("click", checkAnswers);
  nextBtn.addEventListener("click", () => {
    initExercise();
    render();
  });

  updateCheckButton();
}

function updateCheckButton(): void {
  const checkBtn = document.getElementById("check-btn") as HTMLButtonElement;
  const allAssigned = state.assignments.every((a) => a !== null);
  checkBtn.disabled = !allAssigned || state.isComplete;
}

async function checkAnswers(): Promise<void> {
  state.hasChecked = true;
  state.incorrectPositions.clear();

  let allCorrect = true;
  state.assignments.forEach((assignedNote, index) => {
    if (assignedNote !== state.targetNotes[index]) {
      state.incorrectPositions.add(index);
      allCorrect = false;
    }
  });

  state.isComplete = allCorrect;

  renderSoundButtons();
  renderFeedback(allCorrect);

  if (allCorrect) {
    document.getElementById("check-btn")!.style.display = "none";
    document.getElementById("next-btn")!.style.display = "inline-block";
    await playAllNotesWithHighlight();
  }
}

function renderFeedback(allCorrect: boolean): void {
  const feedback = document.getElementById("feedback")!;
  if (allCorrect) {
    feedback.className = "feedback success";
    feedback.textContent = "All correct! Great job!";
  } else {
    const wrongCount = state.incorrectPositions.size;
    feedback.className = "feedback error";
    feedback.textContent = `${wrongCount} ${wrongCount === 1 ? "answer is" : "answers are"} incorrect. Try again!`;
  }
}

async function playAllNotesWithHighlight(): Promise<void> {
  const buttons = document.querySelectorAll(".sound-button");

  for (let i = 0; i < state.targetNotes.length; i++) {
    const button = buttons[i];
    button.classList.add("playing");

    playNote(state.targetNotes[i], { duration: NOTE_DURATION });

    await sleep((NOTE_DURATION + NOTE_GAP) * 1000);

    button.classList.remove("playing");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function renderNoteMatching(): void {
  initExercise();
  render();
  playAllNotesWithHighlight();
}
