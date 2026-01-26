# ear-trainer

An experiment in developing ear training exercises for developing perfect pitch. This is a single-page web app with no server component.

## Project Overview

The app presents various exercises focused on identifying musical notes. The initial exercises are variations on naming a particular note in increasingly difficult contexts.

### Pages

- **Note Playground**: Explore notes and learn about musical notation (sharps, flats, octaves, frequencies).

### Current Exercises

- **Note Choice**: Plays a single note and asks you to identify which of two options it is. Good for beginners. Keyboard controls: Left/Right arrows.
- **Progressive Note ID**: Adaptive difficulty training. Starts with 2 notes (C4 + one distant), adds more as you improve. 10 correct in a row increases difficulty (up to 10 notes). 50% wrong in last 10 decreases difficulty. Keyboard controls: number keys 1-9, 0 for 10.
- **Note Matching**: Plays a set of notes, tells you what they are, and asks you to match note names to sounds by dragging them. You check your answers and must reorder incorrect ones until all are correct.

## Architecture

```
src/
  main.ts              # Entry point, hash-based routing
  audio.ts             # Web Audio API utilities for pure tones
  styles.css           # Global styles
  pages/
    index.ts           # Exercise index page
    playground.ts      # Note playground with notation guide
    note-choice.ts     # Two-option note identification
    progressive-id.ts  # Adaptive difficulty note identification
    note-matching.ts   # Drag-and-drop note matching
```

### Key Patterns

- **Routing**: Simple hash-based routing (`#/exercises/note-matching`)
- **Audio**: Pure tones generated via Web Audio API oscillators (sine waves)
- **State**: Exercise state is managed within each exercise module
- **No frameworks**: Vanilla TypeScript with direct DOM manipulation

### Note Frequencies

Notes use equal temperament tuning with A4 = 440 Hz. Supports three octaves (C3-B5) in the playground, exercises currently use octave 4 only.

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
