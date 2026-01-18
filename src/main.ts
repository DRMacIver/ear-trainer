/**
 * Main entry point - simple hash-based routing.
 */

import { renderIndex } from "./pages/index.js";
import { renderPlayground } from "./pages/playground.js";
import { renderNoteChoice } from "./pages/note-choice.js";
import { renderNoteMatching } from "./pages/note-matching.js";
import { renderProgressiveId } from "./pages/progressive-id.js";
import { renderOddOneOut } from "./pages/odd-one-out.js";
import { renderSpotTheC } from "./pages/spot-the-c.js";
import { renderOctaveOrNot } from "./pages/octave-or-not.js";
import { renderFrequencyRange } from "./pages/frequency-range.js";
import { renderHigherOrLower } from "./pages/higher-or-lower.js";
import { renderFreqMultipleChoice } from "./pages/freq-multiple-choice.js";
import { renderFrequencyRatio } from "./pages/frequency-ratio.js";
import { renderRatioRange } from "./pages/ratio-range.js";
import { renderMatchTheFrequency } from "./pages/match-the-frequency.js";

type Route = () => void | Promise<void>;

const routes: Record<string, Route> = {
  "": renderIndex,
  "#/": renderIndex,
  "#/playground": renderPlayground,
  "#/exercises/note-choice": renderNoteChoice,
  "#/exercises/note-matching": renderNoteMatching,
  "#/exercises/progressive-id": renderProgressiveId,
  "#/exercises/odd-one-out": renderOddOneOut,
  "#/exercises/spot-the-c": renderSpotTheC,
  "#/exercises/octave-or-not": renderOctaveOrNot,
  "#/exercises/frequency-range": renderFrequencyRange,
  "#/exercises/higher-or-lower": renderHigherOrLower,
  "#/exercises/freq-multiple-choice": renderFreqMultipleChoice,
  "#/exercises/frequency-ratio": renderFrequencyRatio,
  "#/exercises/ratio-range": renderRatioRange,
  "#/exercises/match-the-frequency": renderMatchTheFrequency,
};

function router(): void {
  const hash = window.location.hash || "";
  const route = routes[hash] ?? routes[""];
  route();
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);
