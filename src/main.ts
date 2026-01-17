/**
 * Main entry point - simple hash-based routing.
 */

import { renderIndex } from "./pages/index.js";
import { renderPlayground } from "./pages/playground.js";
import { renderNoteChoice } from "./pages/note-choice.js";
import { renderNoteMatching } from "./pages/note-matching.js";
import { renderProgressiveId } from "./pages/progressive-id.js";

type Route = () => void;

const routes: Record<string, Route> = {
  "": renderIndex,
  "#/": renderIndex,
  "#/playground": renderPlayground,
  "#/exercises/note-choice": renderNoteChoice,
  "#/exercises/note-matching": renderNoteMatching,
  "#/exercises/progressive-id": renderProgressiveId,
};

function router(): void {
  const hash = window.location.hash || "";
  const route = routes[hash] ?? routes[""];
  route();
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);
