# Frequency Memorization: Design Decisions

This document records design decisions made for the frequency memorization exercise, based on spaced repetition research and UX best practices.

## Core Design Principles

### 1. Immediate Feedback

**Decision**: Show "Too high!" or "Too low!" feedback immediately on wrong guesses, with eliminated choices visually struck through.

**Rationale**: Research shows students produce 44% more correct answers with immediate feedback vs delayed. The directional feedback ("too high/too low") helps learners develop calibration while making the exercise feel like a binary search game.

**Source**: ASSISTments research on immediate feedback

### 2. Retry Until Correct

**Decision**: Users must identify the correct frequency before moving on, rather than just being shown the answer.

**Rationale**: Having users "rework the problem and try answering again" when incorrect reinforces learning better than passive answer reveal. This follows scaffolded learning principles.

**Source**: Drillster design principles, ASSISTments scaffolded help

### 3. Learning Sequence After Mistakes

**Decision**: After wrong guesses, play all choices in order (low to high) with button highlighting, ending with the correct answer repeated.

**Rationale**:

- Focuses on correct information (play all, then emphasize correct)
- Provides auditory context (hear how the choices compare)
- Reinforces learning through multiple modalities (visual highlighting + audio)
- Allows replay for self-directed learning

### 4. Auto-Grade as "Again" for Retries

**Decision**: If the user needed multiple guesses, automatically grade as "Again" without showing grade buttons.

**Rationale**:

- Simplifies the interface (no decision needed when clearly struggling)
- Prevents users from "gaming" the system by rating themselves higher than deserved
- Follows research on hiding meta-information that encourages optimization over learning

### 5. First-Try Only for Session Completion

**Decision**: Only first-try correct answers count toward the "2 correct per card" session completion requirement.

**Rationale**: Ensures users genuinely know the material before the session ends, rather than stumbling through with retries.

## UI Polish Decisions

### 1. Sorted Choices (Low to High)

**Decision**: Always display frequency choices sorted from lowest to highest.

**Rationale**: Provides consistent spatial mapping that matches the "too high/too low" feedback. Users can use elimination logic more naturally.

### 2. Minimal Stats Display

**Decision**: Show only session accuracy, frequencies learned count, and sessions completed. Do not show:

- Current card's state (new/review)
- Progress toward session completion
- Individual card correct counts

**Rationale**: Research advises against revealing "gaming info" that lets users optimize behavior instead of learning. The hidden state prevents "just need one more on this card" mentality.

### 3. Disabled Buttons During Sequence

**Decision**: Disable all choice buttons during learning sequence playback.

**Rationale**: Prevents accidental input, provides clear visual indication that playback is occurring, and focuses attention on the audio.

### 4. Smooth Transitions

**Decision**: Added CSS transitions for button state changes (highlighting, elimination).

**Rationale**: Smooth transitions feel more polished and modern, following the "2025 app, not 2010 relic" guidance from UI research.

### 5. Subtle Danger Zone

**Decision**: "Clear Progress" button is gray/subtle, only turns red on hover.

**Rationale**: Destructive actions should be available but not prominent. Following principles of making dangerous actions harder to accidentally trigger.

## Session Structure Decisions

### 1. First Session: 100Hz, 550Hz, 1100Hz

**Decision**: Start with well-separated anchor frequencies covering the full range.

**Rationale**: Establishes mental reference points at low, mid, and high ranges. These become the "splitting" frequencies for introducing new cards.

### 2. Subsequent Sessions: 2 New + Reviews

**Decision**: Each session introduces 2 new frequencies (one below and one above a familiar "splitting" frequency) plus review cards.

**Rationale**:

- Binary search approach efficiently covers the frequency space
- Splitting card provides familiar context for new frequencies
- Interleaving new and review material aids retention

### 3. Well-Separated Review Selection

**Decision**: For review-only sessions, select cards from different regions of the frequency range.

**Rationale**: Prevents sessions from clustering in one frequency region, ensuring broad coverage and preventing interference between similar frequencies.

## Timing and Analytics

### 1. Pause Timing When Tabbed Away

**Decision**: Use Page Visibility API to pause timing when the user tabs away.

**Rationale**: Time metrics should reflect active engagement, not time spent elsewhere. More accurate data for future analysis.

### 2. Track Guess History and Replay Times

**Decision**: Store wrong guesses and replay button press times for each review.

**Rationale**: Future analysis may reveal patterns (common confusions, time-to-decision correlations) that could improve the exercise or personalize difficulty.

## Not Implemented (Intentionally)

### Gamification Elements

**Decision**: No streaks, XP, badges, or leaderboards.

**Rationale**: Research shows ethical concerns about gamification promoting "addiction" over genuine learning. This exercise focuses on effective learning, not engagement metrics.

### Configurable Intervals/Settings

**Decision**: FSRS algorithm handles scheduling automatically without user configuration.

**Rationale**: Users shouldn't have to "configure intervals or tweak settings." The algorithm should handle optimization, letting users focus on learning.

### Progress Bars During Session

**Decision**: Don't show how many more correct answers are needed for session completion.

**Rationale**: Prevents "countdown optimization" where users focus on finishing rather than learning. Session ends when the work is done.
