/**
 * Shared session history for exercises.
 *
 * Tracks what the user got right and wrong during a session,
 * and provides a way to render a summary view.
 */

export interface HistoryEntry {
  // What was played/shown (e.g., "C4", "C3 -> C4", "C3, E4, C5")
  prompt: string;
  // The actual notes to replay (in order)
  notes: string[];
  // What the user answered
  userAnswer: string;
  // What the correct answer was
  correctAnswer: string;
  // Whether the user was correct
  correct: boolean;
}

/**
 * Render a history summary view.
 */
export function renderHistorySummary(
  history: HistoryEntry[],
  title: string
): string {
  const correct = history.filter((h) => h.correct).length;
  const total = history.length;
  const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;

  const rows = history
    .map((entry, idx) => {
      const icon = entry.correct ? "&#x2714;" : "&#x2718;";
      const rowClass = entry.correct ? "history-correct" : "history-incorrect";
      return `
        <tr class="${rowClass}">
          <td>${idx + 1}</td>
          <td>
            <button class="history-play-btn" data-index="${idx}" title="Play">&#9654;</button>
            ${escapeHtml(entry.prompt)}
          </td>
          <td>${escapeHtml(entry.userAnswer)}</td>
          <td>${escapeHtml(entry.correctAnswer)}</td>
          <td>${icon}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <a href="#/" class="back-link">&larr; Back to exercises</a>
    <h1>${escapeHtml(title)} - Session Summary</h1>

    <div class="history-summary">
      <div class="history-stats">
        <span class="history-score">${correct} / ${total}</span>
        <span class="history-percentage">(${percentage}%)</span>
      </div>

      ${
        history.length > 0
          ? `
        <table class="history-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Prompt</th>
              <th>Your Answer</th>
              <th>Correct Answer</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      `
          : `<p>No attempts recorded yet.</p>`
      }

      <div class="history-actions">
        <button class="check-button" id="history-back-btn">Continue Practice</button>
      </div>
    </div>
  `;
}

/**
 * Set up the back button handler after rendering history.
 */
export function setupHistoryBackButton(onBack: () => void): void {
  const backBtn = document.getElementById("history-back-btn");
  if (backBtn) {
    backBtn.addEventListener("click", onBack);
  }
}

/**
 * Set up play buttons for history entries.
 * Opens a review overlay when clicked.
 */
export function setupHistoryPlayButtons(
  history: HistoryEntry[],
  playNotes: (notes: string[]) => Promise<void>
): void {
  const buttons = document.querySelectorAll(".history-play-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = e.currentTarget as HTMLButtonElement;
      const index = parseInt(target.dataset.index || "0", 10);
      const entry = history[index];
      if (entry) {
        showReviewOverlay(entry, playNotes);
      }
    });
  });
}

/**
 * Show a review overlay for a history entry.
 */
function showReviewOverlay(
  entry: HistoryEntry,
  playNotes: (notes: string[]) => Promise<void>
): void {
  // Remove any existing overlay
  const existing = document.getElementById("review-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "review-overlay";
  overlay.className = "review-overlay";

  const noteButtons = entry.notes
    .map(
      (_, i) =>
        `<button class="review-sound-btn" data-index="${i}">Sound ${i + 1}</button>`
    )
    .join("");

  const resultIcon = entry.correct ? "&#x2714;" : "&#x2718;";
  const resultClass = entry.correct ? "review-correct" : "review-incorrect";

  overlay.innerHTML = `
    <div class="review-modal">
      <button class="review-close-btn" title="Close">&times;</button>
      <h3>Review Problem</h3>

      <div class="review-sounds">
        ${noteButtons}
        <button class="review-play-all-btn">Play All</button>
      </div>

      <div class="review-details">
        <div class="review-row">
          <span class="review-label">Played:</span>
          <span>${escapeHtml(entry.prompt)}</span>
        </div>
        <div class="review-row">
          <span class="review-label">You answered:</span>
          <span>${escapeHtml(entry.userAnswer)}</span>
        </div>
        <div class="review-row">
          <span class="review-label">Correct answer:</span>
          <span>${escapeHtml(entry.correctAnswer)}</span>
        </div>
        <div class="review-row ${resultClass}">
          <span class="review-result">${resultIcon} ${entry.correct ? "Correct" : "Incorrect"}</span>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Set up event listeners
  const closeBtn = overlay.querySelector(".review-close-btn");
  closeBtn?.addEventListener("click", () => overlay.remove());

  // Close on overlay background click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Close on Escape key
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      overlay.remove();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  // Play individual notes
  const soundBtns = overlay.querySelectorAll(".review-sound-btn");
  soundBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = parseInt((btn as HTMLButtonElement).dataset.index || "0", 10);
      const allBtns = overlay.querySelectorAll("button");
      allBtns.forEach((b) => ((b as HTMLButtonElement).disabled = true));
      await playNotes([entry.notes[idx]]);
      allBtns.forEach((b) => ((b as HTMLButtonElement).disabled = false));
    });
  });

  // Play all notes
  const playAllBtn = overlay.querySelector(".review-play-all-btn");
  playAllBtn?.addEventListener("click", async () => {
    const allBtns = overlay.querySelectorAll("button");
    allBtns.forEach((b) => ((b as HTMLButtonElement).disabled = true));
    await playNotes(entry.notes);
    allBtns.forEach((b) => ((b as HTMLButtonElement).disabled = false));
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
