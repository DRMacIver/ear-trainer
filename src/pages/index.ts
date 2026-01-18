/**
 * Exercise index page.
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

    <h2>Exercises</h2>
    <ul class="exercise-list">
      <li>
        <a href="#/exercises/spot-the-c">
          <div class="title">Spot the C</div>
          <div class="description">
            Two notes play - one is a C, one is not. Find the C!
            A great starting point for learning to recognize a reference note.
          </div>
        </a>
      </li>
      <li>
        <a href="#/exercises/note-choice">
          <div class="title">Note Choice</div>
          <div class="description">
            A single note plays - identify which of two options it is.
            Great for beginners learning to distinguish between notes.
          </div>
        </a>
      </li>
      <li>
        <a href="#/exercises/odd-one-out">
          <div class="title">Odd One Out</div>
          <div class="description">
            Three notes play - two are the same note in different octaves, one is different.
            Find the odd one! Trains octave recognition.
          </div>
        </a>
      </li>
      <li>
        <a href="#/exercises/octave-or-not">
          <div class="title">Octave or Not</div>
          <div class="description">
            Two notes play (low then high) - are they an octave apart?
            Adaptive difficulty adds more intervals as you improve.
          </div>
        </a>
      </li>
      <li>
        <a href="#/exercises/progressive-id">
          <div class="title">Progressive Note ID</div>
          <div class="description">
            Adaptive difficulty training. Starts with 2 notes, adds more as you improve.
            Get 10 in a row to level up, struggle and it eases back.
          </div>
        </a>
      </li>
      <li>
        <a href="#/exercises/note-matching">
          <div class="title">Note Matching</div>
          <div class="description">
            Listen to multiple notes and drag their names to match each sound.
            More challenging - tests your ability to identify several pitches.
          </div>
        </a>
      </li>
    </ul>

    <h2>Frequency Exercises</h2>
    <ul class="exercise-list">
      <li>
        <a href="#/exercises/frequency-range">
          <div class="title">Frequency Range</div>
          <div class="description">
            A tone plays - place your range bar on the log scale to estimate where
            the frequency is. Difficulty increases as the bar gets narrower.
          </div>
        </a>
      </li>
    </ul>
  `;
}
