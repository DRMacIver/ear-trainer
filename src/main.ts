/**
 * Main entry point - simple hash-based routing.
 */

import { renderIndex } from "./pages/index.js";
import { renderToneQuiz } from "./pages/tone-quiz.js";
import { renderToneQuizStats } from "./pages/tone-quiz-stats.js";

type Route = () => void | Promise<void>;

const routes: Record<string, Route> = {
  "": renderIndex,
  "#/": renderIndex,
  "#/exercises/tone-quiz": renderToneQuiz,
  "#/exercises/tone-quiz/stats": renderToneQuizStats,
};

function router(): void {
  const hash = window.location.hash || "";
  const route = routes[hash] ?? routes[""];
  route();
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);
