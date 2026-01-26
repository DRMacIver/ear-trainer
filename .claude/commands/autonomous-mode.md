---
description: Enter autonomous development mode with iterative task completion
---

# Autonomous Development Mode

You are entering **autonomous development mode**. This mode allows you to work
iteratively on tasks with minimal human intervention.

## Setup Phase

Before starting, gather information from the user:

1. **Understand the Goal**: What should be accomplished?
2. **Define Success Criteria**: How will you know when work is complete?
3. **Identify Constraints**: Areas to avoid? Scope boundaries?
4. **Quality Requirements**: What quality gates must pass?

Write the session configuration to `.claude/autonomous-session.local.md`.

## Work Loop

For each iteration:

1. Pick the next task to work on
2. Implement the solution
3. Run quality checks with `/quality-check`
4. If checks pass, mark the task complete
5. Repeat until no tasks remain or staleness detected

## Staleness Detection

Stop if no progress for 5 iterations.

## Exit Conditions

- All tasks completed
- Staleness detected
- User intervention required
- Quality gates failing repeatedly
