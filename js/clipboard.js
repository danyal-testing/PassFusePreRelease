/**
 * clipboard.js
 * -------------------------------------------------------------------------
 * Copy-to-clipboard helper with a graceful fallback.
 *
 * The async Clipboard API is used when available and permitted. Some
 * browsers reject it over file://, so a hidden-textarea + execCommand("copy")
 * fallback is provided, which works in far more contexts while preserving
 * the active element's keyboard focus.
 * -------------------------------------------------------------------------
 */
(function (PG) {
  "use strict";

  /** Legacy fallback using a temporary, off-screen textarea. */
  function fallbackCopy(text) {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    if (previousFocus && typeof previousFocus.focus === "function") {
      try {
        previousFocus.focus({ preventScroll: true });
      } catch {
        /* ignore focus restoration failure */
      }
    }
    return ok;
  }

  /**
   * Copy text to the clipboard.
   * @param {string} text
   * @returns {Promise<void>} resolves on success, rejects on failure.
   */
  async function copyText(text) {
    if (typeof text !== "string" || text.length === 0) {
      throw new Error("COPY_FAILED");
    }
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Clipboard API blocked (often on file://) - fall through to fallback.
      }
    }
    if (!fallbackCopy(text)) throw new Error("COPY_FAILED");
  }

  PG.clipboard = Object.freeze({ copyText: copyText });
})((window.PasswordGen = window.PasswordGen || {}));
