/**
 * Main entry point - simple hash-based routing.
 */

import {
  renderToneQuizIntro,
  renderToneQuiz,
  renderToneQuizAbout,
  renderPracticeSelection,
  renderPracticeMode,
} from "./pages/tone-quiz.js";
import { renderToneQuizStats } from "./pages/tone-quiz-stats.js";

type Route = () => void | Promise<void>;

const routes: Record<string, Route> = {
  "": renderToneQuizIntro,
  "#/": renderToneQuizIntro,
  "#/quiz": renderToneQuiz,
  "#/stats": renderToneQuizStats,
  "#/about": renderToneQuizAbout,
  "#/practice": renderPracticeSelection,
  "#/practice/two-note": () => renderPracticeMode("two-note"),
  "#/practice/single-note": () => renderPracticeMode("single-note"),
  "#/practice/ordering": () => renderPracticeMode("ordering"),
};

function router(): void {
  const hash = window.location.hash || "";
  const route = routes[hash] ?? routes[""];
  route();
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);
