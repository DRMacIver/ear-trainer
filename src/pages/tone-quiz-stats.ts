/**
 * Tone Quiz Stats Page
 *
 * Shows a matrix of performance data for distinguishing between notes.
 */

import { playNote } from "../audio.js";
import {
  loadState,
  ToneQuizState,
  FullTone,
  FULL_TONES,
} from "../lib/tone-quiz-state.js";

const NOTE_DURATION = 0.5;
const GAP_BETWEEN_NOTES = 300; // ms

/**
 * Calculate a smoothed percentage estimate.
 * Uses a simple Bayesian approach: (correct + 1) / (total + 2)
 * This gives a slight regression to 50% for small sample sizes.
 */
function smoothedPercentage(results: boolean[]): number {
  if (results.length === 0) return 0.5;
  const correct = results.filter(Boolean).length;
  return (correct + 1) / (results.length + 2);
}

/**
 * Get color class based on performance percentage.
 */
function getColorClass(percentage: number): string {
  if (percentage >= 0.8) return "perf-green";
  if (percentage >= 0.6) return "perf-amber";
  return "perf-red";
}

/**
 * Count total appearances of a note across all questions.
 */
function countNoteAppearances(state: ToneQuizState, note: FullTone): number {
  let count = 0;

  // Count as target
  for (const other of Object.keys(state.performance[note] ?? {})) {
    count += (state.performance[note][other]?.length ?? 0);
  }

  // Count as other
  for (const target of Object.keys(state.performance)) {
    if (target !== note) {
      count += (state.performance[target][note]?.length ?? 0);
    }
  }

  return count;
}

/**
 * Check if a note has been used as a target (has any questions asked about it).
 */
function hasBeenTarget(state: ToneQuizState, note: FullTone): boolean {
  const targetData = state.performance[note];
  if (!targetData) return false;

  for (const other of Object.keys(targetData)) {
    if (targetData[other]?.length > 0) return true;
  }
  return false;
}

/**
 * Get overall performance for a target note (average across all others).
 */
function getOverallPerformance(state: ToneQuizState, target: FullTone): number {
  const targetData = state.performance[target];
  if (!targetData) return 0.5;

  const allResults: boolean[] = [];
  for (const other of Object.keys(targetData)) {
    allResults.push(...(targetData[other] ?? []));
  }

  return smoothedPercentage(allResults);
}

/**
 * Play a pair of notes (target first, then other).
 */
async function playNotePair(target: FullTone, other: FullTone): Promise<void> {
  await playNote(`${target}4`, { duration: NOTE_DURATION });
  await new Promise((r) => setTimeout(r, GAP_BETWEEN_NOTES));
  await playNote(`${other}4`, { duration: NOTE_DURATION });
}

export function renderToneQuizStats(): void {
  const state = loadState();
  const app = document.getElementById("app")!;

  // Determine which notes to show
  // - Only notes with > 1 total appearance
  // - Only rows for notes that have been targets
  const notesToShow = FULL_TONES.filter(
    (note) => countNoteAppearances(state, note) > 1
  );
  const targetNotes = notesToShow.filter((note) => hasBeenTarget(state, note));

  if (targetNotes.length === 0) {
    app.innerHTML = `
      <a href="#/quiz" class="back-link">&larr; Back to Tone Quiz</a>
      <h1>Tone Quiz Stats</h1>
      <div class="exercise-container">
        <p>No data yet. Complete some questions in the Tone Quiz first!</p>
      </div>
    `;
    return;
  }

  // Build the matrix HTML
  let matrixHtml = `
    <table class="performance-matrix">
      <thead>
        <tr>
          <th>Target \\ Other</th>
          ${notesToShow.map((n) => `<th>${n}</th>`).join("")}
          <th>Overall</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const target of targetNotes) {
    const overallPerf = getOverallPerformance(state, target);
    const overallClass = getColorClass(overallPerf);

    matrixHtml += `<tr>`;
    matrixHtml += `<th>${target}</th>`;

    for (const other of notesToShow) {
      if (target === other) {
        matrixHtml += `<td class="perf-na">-</td>`;
      } else {
        const results = state.performance[target]?.[other] ?? [];
        if (results.length === 0) {
          matrixHtml += `<td class="perf-empty perf-clickable" data-target="${target}" data-other="${other}"></td>`;
        } else {
          const perf = smoothedPercentage(results);
          const colorClass = getColorClass(perf);
          const displayPct = Math.round(perf * 100);
          matrixHtml += `<td class="${colorClass} perf-clickable" data-target="${target}" data-other="${other}" title="${results.length} trials - click to play">${displayPct}%</td>`;
        }
      }
    }

    // Overall column
    const overallPct = Math.round(overallPerf * 100);
    matrixHtml += `<td class="${overallClass} perf-clickable" data-target="${target}" title="Click to play ${target}"><strong>${overallPct}%</strong></td>`;
    matrixHtml += `</tr>`;
  }

  matrixHtml += `
      </tbody>
    </table>
  `;

  app.innerHTML = `
    <a href="#/quiz" class="back-link">&larr; Back to Tone Quiz</a>
    <h1>Tone Quiz Stats</h1>
    <p>Performance matrix: rows are target notes (what you're asked to identify), columns are the other notes played with them. Click any cell to hear the pair.</p>

    <div class="exercise-container">
      ${matrixHtml}

      <div class="stats-legend">
        <span class="perf-green">80%+</span>
        <span class="perf-amber">60-79%</span>
        <span class="perf-red">&lt;60%</span>
      </div>

      <p class="stats-note">
        Percentages use smoothed estimates (Bayesian with slight regression to 50% for small samples).
      </p>
    </div>
  `;

  // Add click handlers to cells
  const clickableCells = document.querySelectorAll(".perf-clickable");
  clickableCells.forEach((cell) => {
    cell.addEventListener("click", () => {
      const target = cell.getAttribute("data-target") as FullTone;
      const other = cell.getAttribute("data-other") as FullTone | null;
      if (target && other) {
        playNotePair(target, other);
      } else if (target) {
        // Overall column - just play the target note
        playNote(`${target}4`, { duration: NOTE_DURATION });
      }
    });
  });
}
