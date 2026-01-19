/**
 * Main index page.
 */

export function renderIndex(): void {
  const app = document.getElementById("app")!;

  app.innerHTML = `
    <h1>Ear Trainer</h1>
    <p>Exercises for developing perfect pitch recognition.</p>

    <h2>Learn</h2>
    <ul class="exercise-list">
      <li>
        <a href="#/playground">
          <div class="title">Note Playground</div>
          <div class="description">
            Explore all the notes and learn how musical notation works.
            Click notes to hear them and read about sharps, flats, and octaves.
          </div>
        </a>
      </li>
    </ul>

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

    <h2>More</h2>
    <ul class="exercise-list">
      <li>
        <a href="#/experimental">
          <div class="title">Experimental Exercises</div>
          <div class="description">
            Various ear training exercises in development.
            Includes note identification, frequency training, and more.
          </div>
        </a>
      </li>
    </ul>
  `;
}
