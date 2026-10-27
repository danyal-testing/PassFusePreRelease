/**
 * theme.js
 * -------------------------------------------------------------------------
 * Light/dark theme resolution and persistence.
 *
 * The initial theme is applied by a tiny inline script in <head> (before the
 * first paint) to avoid a flash of the wrong theme (FOUC). This module
 * handles runtime toggling, OS preference tracking, and keeps accessible
 * button state and browser theme-color metadata synchronized.
 * Depends on: config (storage key + colours).
 * -------------------------------------------------------------------------
 */
(function (PG) {
  "use strict";

  const KEY = PG.config.THEME_KEY;
  const COLORS = PG.config.THEME_COLORS;

  /** Read a valid stored theme, or null. Safe if storage is unavailable. */
  function readStoredTheme() {
    try {
      const t = localStorage.getItem(KEY);
      return t === "light" || t === "dark" ? t : null;
    } catch {
      return null;
    }
  }

  /** Persist the theme; silently ignored if storage is blocked (file://). */
  function storeTheme(theme) {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* no-op: private mode or restricted file:// context */
    }
  }

  /** The OS-level colour-scheme preference. */
  function systemTheme() {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  /**
   * Invoke `onChange` when the OS colour-scheme flips. Returns a cleanup
   * function; a no-op when `matchMedia` is unavailable.
   * @param {(theme: "light"|"dark") => void} onChange
   * @returns {() => void}
   */
  function watchSystemTheme(onChange) {
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq || typeof mq.addEventListener !== "function") {
      return function () {};
    }
    const handler = function (event) {
      onChange(event.matches ? "light" : "dark");
    };
    mq.addEventListener("change", handler);
    return function () {
      mq.removeEventListener("change", handler);
    };
  }

  /**
   * Apply a theme to the document and sync the toggle's accessible state.
   * @param {"light"|"dark"} theme
   * @param {HTMLElement|null} toggle Toggle button (aria-pressed).
   * @param {HTMLElement|null} label  Visually-hidden label text.
   */
  function applyTheme(theme, toggle, label) {
    const resolved = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", resolved);
    const meta = document.querySelector("[data-theme-color]");
    if (meta) meta.setAttribute("content", COLORS[resolved]);
    if (toggle) {
      toggle.setAttribute(
        "aria-pressed",
        resolved === "light" ? "true" : "false"
      );
      const action =
        resolved === "dark" ? "Switch to light theme" : "Switch to dark theme";
      toggle.setAttribute("aria-label", action);
      toggle.setAttribute("title", action);
    }
    if (label) {
      label.textContent =
        resolved === "dark" ? "Switch to light theme" : "Switch to dark theme";
    }
  }

  PG.theme = Object.freeze({
    readStoredTheme: readStoredTheme,
    storeTheme: storeTheme,
    systemTheme: systemTheme,
    watchSystemTheme: watchSystemTheme,
    applyTheme: applyTheme,
  });
})((window.PasswordGen = window.PasswordGen || {}));
