# Spaced Repetition Practice: UI/UX Research Notes

Notes compiled from research on drill UI, spaced repetition apps, and learning psychology.

## Immediate Feedback

Immediate feedback is critical for effective learning:

- Students produce **44% more correct answers** with immediate feedback vs delayed feedback
- Retention is higher: 85% with immediate feedback vs 67% with delayed
- "The brain takes it as a kind of reward—your brain doesn't want to get things wrong, making it more important to store feedback so that you will be able to produce the correct answer next time"

Source: [ASSISTments - Evidence-Based Practice Series: Immediate Feedback Matters](https://www.assistments.org/blog-posts/evidence-based-practice-series-immediate-feedback-matters-this-is-why)

### Best Practices for Feedback Display

1. **Focus on correct information** - "Always put the focus on the correct information. Explain why a certain answer is true, regardless of whether this was the answer the learner selected."

2. **Don't dwell on incorrect answers** - "Prevent unwanted learning effects by not going into incorrect information. It is better to keep confronting learners with what they should be remembering."

3. **Keep it brief** - "Do not get bogged down in long sections of text, but keep the feedback brief and to the point."

Source: [Drillster - Design principle 6: Use immediate feedback](https://drillster.com/design-principle-6-use-positive-feedback-explain-which-answer-is-correct-and-why/)

### Visual Feedback

- Use visual cues (green check, red x) but keep them simple
- Duolingo's red incorrect popup uses "simplistic design" that makes it "less intimidating"
- "Although red can be associated with a more negative/error-like tone, the simplistic design makes it less intimidating"

Source: [UX Planet - UX and Gamification in Duolingo](https://uxplanet.org/ux-and-gamification-in-duolingo-40d55ee09359)

## UI Design Principles

### Minimalism

- "Users aren't looking for bells and whistles — they're looking for a clear, focused space to learn"
- "Simplicity matters, but simple doesn't mean boring or bare"
- Modern apps should feel like "a 2025 app, not a 2010 relic"

Source: [Medium - Modern Flashcard App UI UX Design 2025](https://medium.com/@prajapatisuketu/modern-flashcard-app-ui-ux-design-2025-4545294a17b4)

### Successful Examples

- **Mochi**: "Clean, minimalist design and AI-driven review scheduling"
- **Zorbi**: "UI is simple, but with a beautiful modern style which makes you want to study" - described as "Anki but with a modern skin"

Sources: [Mochi](https://mochi.cards/), [Zorbi](https://zorbi.com/)

### Mobile Interaction

- Floating flip and response buttons during review make "reviewing easier on your thumb"
- Buttons should float over the card instead of being along the bottom of the screen (Theater Mode pattern)
- Swipe-based responses provide alternative interaction methods

Source: [StudyGuides - Top Flashcard Apps](https://studyguides.com/articles/top-flashcard-apps-with-built-in-spaced-repetition-flashcards-quizzes)

## Spaced Repetition Algorithms

### User Experience Considerations

- Users shouldn't have to "configure intervals or tweak settings"
- Automatic scheduling is preferred - the algorithm should handle it
- Active recall pattern: "see the question, think of the answer, then reveal it"

Source: [Headway - Spaced Repetition App Guide](https://makeheadway.com/blog/spaced-repetition-app/)

### FSRS (Free Spaced Repetition Scheduler)

FSRS-5 is a modern algorithm that calculates:
- **Stability (S)**: How long until retrievability drops to 90%
- **Difficulty (D)**: Inherent difficulty of the card (1-10 scale)
- **Retrievability**: Probability of recall given time elapsed

Grade options typically: Again (1), Hard (2), Good (3), Easy (4)

Source: [femto-fsrs on GitHub](https://github.com/open-spaced-repetition/ts-fsrs)

## Gamification Elements

### Duolingo's Approach

Duolingo uses 22 gamification elements including:
- Progress indicators (daily goals, XP, level unlocking)
- Fixed reward schedules (experience points)
- Time-dependent rewards (streaks)
- Challenges and leaderboards
- Badges and achievements

Source: [ResearchGate - Analyzing Gamification of Duolingo](https://www.researchgate.net/publication/310623230_Analyzing_Gamification_of_Duolingo_with_Focus_on_Its_Course_Structure)

### Loss Aversion

- "People are more motivated by the fear of losing something than by the prospect of gaining something"
- Streaks leverage this: "The longer the streak, the more invested users become in maintaining it"
- "Users fear losing their progress more than they're motivated by learning goals"

Source: [StriveCloud - Duolingo gamification explained](https://www.strivecloud.io/blog/gamification-examples-boost-user-retention-duolingo)

### Ethical Considerations

- Heavy reliance on gamification "often raises ethical concerns"
- Daily habits promoted may be "more akin to addiction"
- "Where to draw the line between persuasion and manipulation... remains a matter of personal opinion"

Source: [UX Collective - The good, the bad and the ugly of Duolingo gamification](https://uxdesign.cc/the-good-the-bad-and-the-ugly-of-duolingo-gamification-3a12f0e80dc7)

## Drill-Specific Patterns

### Multiple Choice

- Questions should not get "too repetitive"
- Variety in challenge types helps engagement
- Show correct answer highlighted (green) and wrong selection (red) after answering

Source: [Anki Multiple Choice Plugin](http://www.krakel.de/anki-plugins/plugin_multiple_choice.html)

### Retry Mechanisms

- Some systems have students "rework the problem and try answering again" when incorrect
- Scaffolded help: "When students have unsuccessfully attempted a problem three times, they receive a help video"

Source: [ASSISTments](https://www.assistments.org/blog-posts/evidence-based-practice-series-immediate-feedback-matters-this-is-why)

### Session Structure

- Drills should be "easy and fun to do"
- Lessons are "well-designed, drilling skills of user with several different kinds of challenges"

Source: [UX Planet - UX and Gamification in Duolingo](https://uxplanet.org/ux-and-gamification-in-duolingo-40d55ee09359)

## Key Takeaways for Ear Training

1. **Keep UI minimal** - Focus on the audio and choices, minimize meta-information
2. **Immediate feedback** - Show correct answer right away, briefly
3. **Focus on correct** - Don't dwell on what was wrong, reinforce what's right
4. **Simple interactions** - Number keys, clear buttons, no complex navigation
5. **Don't reveal gaming info** - Hide progress counters, card states, etc. that let users "optimize" instead of learn
6. **Consider retry** - Having users identify correctly before moving on may reinforce better than just showing the answer
7. **Session completion** - Clear endpoint (all cards correct N times) but don't show the countdown
