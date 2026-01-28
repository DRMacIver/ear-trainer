# ear-trainer

An experiment in developing ear training exercises for developing perfect pitch. This is a single-page web app with no server component.

## Project Overview

The app presents a progressive ear training exercise focused on identifying musical notes. Users learn to recognize notes through increasingly difficult challenges.

### Exercise: Tone Quiz

The main (and only) exercise with adaptive learning:

1. **Two-note comparison**: Two notes play - identify which one was the target note (e.g., "Which was the C?")
2. **Single-note identification**: Once reliable at comparing, hear just one note and identify it directly
3. **Expanding vocabulary**: Start with C and G, master each pair to unlock new notes
4. **Multiple octaves**: After mastering a note in octave 4, learn to recognize it in octaves 3 and 5

Keyboard controls: `1`/`←` first option, `2`/`→` second option, `R` replay, `Space` continue

## Architecture

```
src/
  main.ts              # Entry point, hash-based routing
  audio.ts             # Web Audio API utilities for pure tones
  styles.css           # Global styles
  lib/
    tone-quiz-state.ts # State management and learning algorithms
    fsrs.ts            # Spaced repetition implementation
  pages/
    tone-quiz.ts       # Main exercise UI
    tone-quiz-stats.ts # Performance statistics view
```

### Routes

- `#/` - Intro page (redirects to quiz if user has history)
- `#/quiz` - Main exercise
- `#/stats` - Performance matrix
- `#/about` - About/intro page (always accessible)

### Key Patterns

- **Routing**: Simple hash-based routing
- **Audio**: Pure tones generated via Web Audio API oscillators (sine waves)
- **State**: Exercise state persisted in localStorage with FSRS spaced repetition
- **No frameworks**: Vanilla TypeScript with direct DOM manipulation

### Note Frequencies

Notes use equal temperament tuning with A4 = 440 Hz. Exercises use octaves 3-5.

## Development

```bash
npm run dev          # Start dev server (Vite)
npm run build        # Build for production
npm run test         # Run tests
npm run lint         # Run linter
npm run format       # Format code
```

Or use just:

```bash
just install         # Install dependencies
just test            # Run tests
just lint            # Run linters
just format          # Format code
just check           # Run all checks
```

## Future Work

- Instrumental sounds (beyond pure tones)
- More exercises (interval recognition, chord identification, etc.)
- Learning rate tracking and progression
- Configurable difficulty settings

## Quality Standards

- All code must have tests
- **Warnings are errors**: Treat all warnings as serious issues that must be fixed
- No linter suppressions without clear justification
- Fix problems properly rather than suppressing errors
- Type hints on all functions

## Landing Work (Session Completion)

When ending a work session, complete ALL steps below. Work is NOT complete until pushed.

1. **Run quality gates** (if code changed) - `just check`
2. **Push to remote**:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
3. **Verify** - All changes committed AND pushed
