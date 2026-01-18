/**
 * Shared session history for exercises.
 *
 * Tracks what the user got right and wrong during a session,
 * and provides a way to render a summary view.
 */

export interface HistoryEntry {
  // What was played/shown (e.g., "C4", "C3 -> C4", "C3, E4, C5")
  prompt: string;
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
          <td>${escapeHtml(entry.prompt)}</td>
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

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
