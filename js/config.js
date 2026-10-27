/**
 * config.js
 * -------------------------------------------------------------------------
 * Static configuration for PassFuse.
 *
 * ARCHITECTURE NOTE
 * The app is intentionally split into small classic scripts that share a
 * single global namespace (`window.PasswordGen`). This keeps the codebase
 * modular (one responsibility per file) while still working when index.html
 * is opened directly from disk via the file:// protocol, where native ES
 * modules are blocked by browser CORS policy.
 *
 * Load order in index.html:
 *   config -> random -> generator -> theme -> clipboard -> main -> pwa
 * -------------------------------------------------------------------------
 */
(function (PG) {
  "use strict";

  /**
   * Disjoint character pools for each category.
   */
  const SETS = Object.freeze({
    uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    lowercase: "abcdefghijklmnopqrstuvwxyz",
    numbers: "0123456789",
    symbols: "!@#$%^&*()_+-=[]{}|;:,.<>?/~`'",
  });

  /**
   * Qualitative strength levels.
   * Driven by a documented multi-factor qualitative classification (length,
   * enabled category diversity, and effective character-set composition)
   * without exposing numeric scores or mathematical bit claims.
   */
  const STRENGTH = Object.freeze([
    Object.freeze({
      level: "weak",
      bars: 1,
      label: "WEAK",
    }),
    Object.freeze({
      level: "fair",
      bars: 2,
      label: "FAIR",
    }),
    Object.freeze({
      level: "strong",
      bars: 3,
      label: "STRONG",
    }),
    Object.freeze({
      level: "very-strong",
      bars: 4,
      label: "VERY STRONG",
    }),
  ]);

  PG.config = Object.freeze({
    /** Character pools for each option. */
    SETS: SETS,

    /** Stable option order for UI controls and category iteration. */
    OPTION_ORDER: Object.freeze([
      "uppercase",
      "lowercase",
      "numbers",
      "symbols",
    ]),

    /**
     * Supported password length bounds.
     * - Pure generator functions accept integers in [MIN_LENGTH, MAX_LENGTH]
     *   (1..64) so small test cases and category bounds can be verified.
     * - The UI slider enforces [UI_MIN_LENGTH, UI_MAX_LENGTH] (8..32) with a
     *   default of 16.
     */
    MIN_LENGTH: 1,
    MAX_LENGTH: 64,
    UI_MIN_LENGTH: 8,
    UI_MAX_LENGTH: 32,
    DEFAULT_LENGTH: 16,

    /** Maximum uniform candidate trials before failing explicitly. */
    MAX_REJECTION_ATTEMPTS: 10000,

    /** Qualitative strength levels (WEAK, FAIR, STRONG, VERY STRONG). */
    STRENGTH: STRENGTH,

    /** Theme & settings persistence keys + browser UI colours per theme. */
    THEME_KEY: "pg-theme",
    SETTINGS_KEY: "pg-settings",
    THEME_COLORS: Object.freeze({ dark: "#090B0F", light: "#F3F5F8" }),
  });
})((window.PasswordGen = window.PasswordGen || {}));
