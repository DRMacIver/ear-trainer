/**
 * Main index page.
 */

export function renderIndex(): void {
  const app = document.getElementById("app")!;

  app.innerHTML = `
    <h1>Ear Trainer</h1>
    <p>Exercises for developing perfect pitch recognition.</p>

    <h2>Practice</h2>
    <ul class="exercise-list">
      <li>
        <a href="#/exercises/tone-quiz">
          <div class="title">Tone Quiz</div>
          <div class="description">
            Two notes play - identify which one was the target note.
            Continuous practice with progress tracking.
          </div>
        </a>
      </li>
    </ul>
  `;
}
