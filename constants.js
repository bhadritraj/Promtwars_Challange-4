/**
 * VolunteerIQ 2026 — Shared Constants
 * Single source of truth for numbers that previously lived in two places
 * (app.js's severity classifier AND gemini-api.js's reasoning composer,
 * including inside the AI's own prose). Keeping them here means the app's
 * actual behavior and the AI's explanation of that behavior can never
 * silently drift apart.
 */

const SEVERITY_THRESHOLDS = {
  CRITICAL_CAPACITY_PCT: 90,
  ELEVATED_CAPACITY_PCT: 75,
  CRITICAL_WAIT_MIN: 25,
  ELEVATED_WAIT_MIN: 15
};

const REPEAT_WINDOW_MINUTES = 15;   // window for "is this the same problem again?"
const REPEAT_ESCALATION_COUNT = 2;  // repeat count at which severity is forced to critical
const MAX_LOG_ENTRIES = 100;        // shift log retention cap
const HISTORY_COUNT_FOR_AI = 3;     // recent entries passed to the AI as short-term memory

const GEMINI_TIMEOUT_MS = 15000;
const GEMINI_STREAM_DELAY_MS = 12;
const GEMINI_MAX_TOKENS_REASONING = 500;
const GEMINI_MAX_TOKENS_SUMMARY = 400;
const GEMINI_TEMPERATURE_REASONING = 0.6;
const GEMINI_TEMPERATURE_SUMMARY = 0.5;

// Dual environment support: plain <script> tag in the browser (bare
// top-level const, shared across classic scripts) and CommonJS in Node
// for the headless test runner.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SEVERITY_THRESHOLDS,
    REPEAT_WINDOW_MINUTES,
    REPEAT_ESCALATION_COUNT,
    MAX_LOG_ENTRIES,
    HISTORY_COUNT_FOR_AI,
    GEMINI_TIMEOUT_MS,
    GEMINI_STREAM_DELAY_MS,
    GEMINI_MAX_TOKENS_REASONING,
    GEMINI_MAX_TOKENS_SUMMARY,
    GEMINI_TEMPERATURE_REASONING,
    GEMINI_TEMPERATURE_SUMMARY
  };
}
