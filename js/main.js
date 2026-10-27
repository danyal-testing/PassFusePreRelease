/**
 * main.js
 * -------------------------------------------------------------------------
 * Bootstraps PassFuse UI: wires DOM elements to the generator, qualitative
 * strength meter, category-colored password renderer, theme toggle,
 * localStorage settings persistence, and clipboard.
 * Runs LAST in the core script sequence (see index.html).
 * Depends on: config, generator, theme, clipboard.
 * -------------------------------------------------------------------------
 */
(function (PG) {
  "use strict";

  const cfg = PG.config;
  const gen = PG.generator;
  const theme = PG.theme;
  const clipboard = PG.clipboard;

  const PLACEHOLDER = "generator__password--placeholder";

  // Authoritative uppercase primary-action and copy-confirmation labels
  const LABEL_GENERATE_INITIAL = "GENERATE PASSWORD";
  const LABEL_GENERATE_NEXT = "GENERATE ANOTHER";
  const LABEL_COPY_SUCCESS = "COPIED";
  const LABEL_COPY_ERROR = "Copy failed";

  // Map a qualitative strength level to the CSS modifier class for active bars
  // and the status label.
  const LEVEL_BAR_CLASS = Object.freeze({
    weak: "strength__bar--weak",
    fair: "strength__bar--fair",
    strong: "strength__bar--strong",
    "very-strong": "strength__bar--very-strong",
  });
  const LEVEL_TEXT_CLASS = Object.freeze({
    weak: "strength__text--weak",
    fair: "strength__text--fair",
    strong: "strength__text--strong",
    "very-strong": "strength__text--very-strong",
  });
  const ALL_BAR_LEVELS = Object.values(LEVEL_BAR_CLASS);
  const ALL_TEXT_LEVELS = Object.values(LEVEL_TEXT_CLASS);

  let initialized = false;

  /** Read valid persisted generator settings from localStorage, or null. */
  function readStoredSettings(minLen, maxLen) {
    try {
      const raw = localStorage.getItem(cfg.SETTINGS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const len = Number(parsed.length);
      if (!Number.isInteger(len) || len < minLen || len > maxLen) return null;
      if (!Array.isArray(parsed.options) || parsed.options.length === 0) {
        return null;
      }
      const validOpts = parsed.options.filter(
        (o, idx, arr) => cfg.OPTION_ORDER.includes(o) && arr.indexOf(o) === idx
      );
      if (validOpts.length === 0 || len < validOpts.length) return null;
      return {
        length: len,
        options: validOpts,
      };
    } catch {
      return null;
    }
  }

  /** Persist non-sensitive generator preferences in localStorage. */
  function storeSettings(length, options) {
    if (!Array.isArray(options) || options.length === 0) return;
    try {
      localStorage.setItem(
        cfg.SETTINGS_KEY,
        JSON.stringify({
          length: Number(length),
          options: options,
        })
      );
    } catch {
      /* ignore restricted storage */
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;

    /* ---------------------------- Theme ---------------------------- */
    const themeToggle = document.querySelector("[data-theme-toggle]");
    const themeLabel = document.querySelector("[data-theme-label]");
    const storedTheme = theme.readStoredTheme();
    let currentTheme = storedTheme ?? theme.systemTheme();
    let userPinnedTheme = storedTheme !== null;
    theme.applyTheme(currentTheme, themeToggle, themeLabel);
    if (themeToggle) {
      themeToggle.addEventListener("click", () => {
        currentTheme = currentTheme === "dark" ? "light" : "dark";
        userPinnedTheme = true;
        theme.applyTheme(currentTheme, themeToggle, themeLabel);
        theme.storeTheme(currentTheme);
      });
    }
    // Follow live OS colour-scheme changes until the user pins a preference.
    theme.watchSystemTheme((osTheme) => {
      if (userPinnedTheme) return;
      currentTheme = osTheme;
      theme.applyTheme(currentTheme, themeToggle, themeLabel);
    });

    /* -------- Element references (bound only via data-* hooks) ------ */
    const els = {
      password: document.querySelector("[data-password-output]"),
      slider: document.querySelector("[data-length-input]"),
      lengthValue: document.querySelector("[data-length-output]"),
      form: document.querySelector("[data-form]"),
      copyButton: document.querySelector("[data-copy-button]"),
      copyText: document.querySelector("[data-copy-text]"),
      copyAnnouncement: document.querySelector("[data-copy-announcement]"),
      generationStatus: document.querySelector("[data-generation-status]"),
      error: document.querySelector("[data-error]"),
      errorText: document.querySelector("[data-error-text]"),
      strength: document.querySelector(".strength"),
      strengthText: document.querySelector("[data-strength-text]"),
      strengthAnnouncement: document.querySelector(
        "[data-strength-announcement]"
      ),
      generateLabel: document.querySelector("[data-generate-label]"),
      bars: Array.from(document.querySelectorAll("[data-strength-bar]")),
      options: {},
    };
    if (!els.password || !els.slider || !els.form) return;

    for (const name of cfg.OPTION_ORDER) {
      els.options[name] = document.querySelector(`[data-option="${name}"]`);
    }

    const minSliderLength = Number(els.slider.min) || cfg.UI_MIN_LENGTH;
    const maxSliderLength = Number(els.slider.max) || cfg.UI_MAX_LENGTH;

    /* --------- Restore persisted settings from localStorage --------- */
    const savedSettings = readStoredSettings(minSliderLength, maxSliderLength);
    if (savedSettings) {
      els.slider.value = String(savedSettings.length);
      for (const name of cfg.OPTION_ORDER) {
        if (els.options[name]) {
          els.options[name].checked = savedSettings.options.includes(name);
        }
      }
    }

    let copyTimer = null;
    let copyRequestId = 0;
    const EMPTY_PASSWORD = "Generate a password";
    let currentRawPassword = "";
    let generatedLength = 0;

    /* --------------------------- Helpers --------------------------- */
    /** Currently selected character category keys, in stable order. */
    function selected() {
      return cfg.OPTION_ORDER.filter(
        (n) => els.options[n] && els.options[n].checked
      );
    }

    /** Clamp and normalize the slider length to a valid integer. */
    function sanitizedLength() {
      const raw = Number(els.slider.value);
      if (!Number.isFinite(raw)) return cfg.DEFAULT_LENGTH;
      const clamped = Math.min(
        maxSliderLength,
        Math.max(minSliderLength, Math.round(raw))
      );
      if (String(clamped) !== els.slider.value) {
        els.slider.value = String(clamped);
      }
      return clamped;
    }

    /** Sync the slider fill gradient and the numeric length readout. */
    function updateSlider() {
      const v = sanitizedLength();
      const pct =
        ((v - minSliderLength) / (maxSliderLength - minSliderLength)) * 100;
      els.slider.style.setProperty("--fill", `${pct}%`);
      els.lengthValue.textContent = String(v);
      els.slider.setAttribute("aria-valuetext", `${v} characters`);
    }

    /**
     * Render generated password characters with category-aware color classes
     * using safe DOM node creation (never innerHTML).
     * @param {string} password
     */
    function renderColoredPassword(password) {
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < password.length; i++) {
        const ch = password[i];
        const category = gen.classifyCharacter(ch);
        const span = document.createElement("span");
        span.className = `pw-char pw-char--${category}`;
        span.textContent = ch;
        fragment.appendChild(span);
      }
      els.password.replaceChildren(fragment);
    }

    /**
     * Reset the strength indicator to its neutral unclassified state when no
     * generated password is active.
     */
    function clearStrength() {
      for (const b of els.bars) {
        b.classList.remove(...ALL_BAR_LEVELS);
      }
      if (els.strength) {
        els.strength.removeAttribute("data-strength-level");
      }
      if (els.strengthText) {
        els.strengthText.classList.remove(...ALL_TEXT_LEVELS);
        els.strengthText.textContent = "\u2014";
      }
    }

    /**
     * Calculate and paint the qualitative strength status for an active
     * generated password.
     */
    function updateStrength() {
      if (!currentRawPassword) {
        clearStrength();
        return null;
      }
      const opts = selected();
      const len = sanitizedLength();

      for (const b of els.bars) {
        b.classList.remove(...ALL_BAR_LEVELS);
      }
      if (els.strengthText) {
        els.strengthText.classList.remove(...ALL_TEXT_LEVELS);
      }
      if (opts.length === 0 || len < opts.length) {
        clearStrength();
        return null;
      }
      const r = gen.classifyStrength(len, opts);
      if (els.strength) {
        els.strength.setAttribute("data-strength-level", r.level);
      }
      if (els.strengthText) {
        els.strengthText.textContent = r.label;
        const textClass = LEVEL_TEXT_CLASS[r.level];
        if (textClass) els.strengthText.classList.add(textClass);
      }
      const barClass = LEVEL_BAR_CLASS[r.level];
      for (let i = 0; i < r.bars && i < els.bars.length; i++) {
        if (barClass) els.bars[i].classList.add(barClass);
      }
      return r;
    }

    /** Re-trigger a polite live region even when the same message repeats. */
    function announce(element, message) {
      if (!element) return;
      element.textContent = "";
      requestAnimationFrame(() => {
        element.textContent = message;
      });
    }

    /** Replay the subtle "pop" animation on the password output. */
    function flashUpdated() {
      els.password.classList.remove("is-updated");
      void els.password.offsetWidth;
      els.password.classList.add("is-updated");
    }

    /* Preserve a maximum of two lines for long passwords. Always clear any
       previous inline font-size first so resizing back to a wider viewport
       restores the stylesheet size, then step down if needed so 32-char
       passwords never wrap onto a third line down to 280px viewports. */
    function fitPasswordTypography() {
      els.password.style.removeProperty("font-size");
      if (
        generatedLength < 20 ||
        els.password.classList.contains(PLACEHOLDER)
      ) {
        return;
      }
      const baseSize = Number.parseFloat(
        getComputedStyle(els.password).fontSize
      );
      const maxTwoLineSize = els.password.clientWidth / 16 / 0.62;
      let fittedSize = Math.max(11, Math.min(baseSize, maxTwoLineSize));
      els.password.style.fontSize = `${fittedSize.toFixed(2)}px`;

      for (let step = 0; step < 6 && fittedSize > 10; step++) {
        const lineHeight = Number.parseFloat(
          getComputedStyle(els.password).lineHeight
        );
        const height = els.password.getBoundingClientRect().height;
        if (height <= lineHeight * 2 + 1) break;
        fittedSize = Math.max(10, fittedSize - 0.5);
        els.password.style.fontSize = `${fittedSize.toFixed(2)}px`;
      }
    }

    function resetCopy() {
      clearTimeout(copyTimer);
      copyTimer = null;
      copyRequestId += 1;
      els.copyButton.classList.remove("is-copied", "is-error");
      els.copyText.textContent = "";
    }

    /** Clear a generated value when its generating settings become stale. */
    function invalidatePassword() {
      resetCopy();
      currentRawPassword = "";
      generatedLength = 0;
      clearStrength();
      if (els.password.classList.contains(PLACEHOLDER)) return;
      els.password.textContent = EMPTY_PASSWORD;
      els.password.classList.add(PLACEHOLDER);
      els.password.style.removeProperty("font-size");
      els.copyButton.disabled = true;
      els.copyButton.setAttribute("title", "Generate a password first");
      els.generateLabel.textContent = LABEL_GENERATE_INITIAL;
      els.strengthAnnouncement.textContent = "";
      announce(
        els.generationStatus,
        "Settings changed. Generate a new password."
      );
    }

    /** Generate a new password (or surface a clear validation message). */
    function render() {
      resetCopy();

      const opts = selected();
      const len = sanitizedLength();

      if (opts.length === 0) {
        els.errorText.textContent =
          "Select at least one character type to generate a password.";
        els.error.hidden = false;
        clearStrength();
        announce(els.generationStatus, "Select at least one character type.");
        return;
      }

      if (len < opts.length) {
        els.errorText.textContent = `Increase length to at least ${opts.length} to include all selected character types.`;
        els.error.hidden = false;
        clearStrength();
        announce(
          els.generationStatus,
          `Increase password length to at least ${opts.length}.`
        );
        return;
      }

      let nextPassword;
      try {
        nextPassword = gen.generatePassword(len, opts);
      } catch {
        els.errorText.textContent =
          "Secure password generation is not available in this browser.";
        els.error.hidden = false;
        clearStrength();
        announce(
          els.generationStatus,
          "Secure password generation is not available in this browser."
        );
        return;
      }

      els.error.hidden = true;
      currentRawPassword = nextPassword;
      renderColoredPassword(nextPassword);
      storeSettings(len, opts);
      generatedLength = len;
      els.password.classList.remove(PLACEHOLDER);
      els.copyButton.disabled = false;
      els.copyButton.setAttribute("title", "Copy password to clipboard");
      els.generateLabel.textContent = LABEL_GENERATE_NEXT;
      fitPasswordTypography();
      requestAnimationFrame(() => {
        fitPasswordTypography();
        flashUpdated();
      });
      const strength = updateStrength();
      announce(
        els.generationStatus,
        "New password generated. Use the copy button to copy it."
      );
      if (strength) {
        announce(
          els.strengthAnnouncement,
          `Password strength: ${strength.label}`
        );
      }
    }

    /** Show the "COPIED" success state, then auto-reset after 2s. */
    function flashCopied(requestId) {
      if (requestId !== copyRequestId) return;
      els.copyButton.classList.remove("is-error");
      els.copyButton.classList.add("is-copied");
      els.copyText.textContent = LABEL_COPY_SUCCESS;
      announce(els.copyAnnouncement, "Password copied to clipboard.");
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        if (requestId === copyRequestId) {
          resetCopy();
        }
      }, 2000);
    }

    /** Surface copy failures instead of failing silently. */
    function flashCopyError(requestId) {
      if (requestId !== copyRequestId) return;
      els.copyButton.classList.remove("is-copied");
      els.copyButton.classList.add("is-error");
      els.copyText.textContent = LABEL_COPY_ERROR;
      announce(
        els.copyAnnouncement,
        "Copy failed. Select the password and copy it manually."
      );
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        if (requestId === copyRequestId) {
          resetCopy();
        }
      }, 3000);
    }

    function onCopy() {
      if (els.copyButton.disabled) return;
      if (els.password.classList.contains(PLACEHOLDER)) return;
      if (!currentRawPassword) return;
      clearTimeout(copyTimer);
      copyTimer = null;
      copyRequestId += 1;
      const activeRequestId = copyRequestId;
      clipboard.copyText(currentRawPassword).then(
        () => flashCopied(activeRequestId),
        () => flashCopyError(activeRequestId)
      );
    }

    function onSliderChange() {
      invalidatePassword();
      updateSlider();
      const opts = selected();
      const len = sanitizedLength();
      if (opts.length > 0 && len >= opts.length) {
        els.error.hidden = true;
        storeSettings(len, opts);
      }
    }

    function onOptionChange(event) {
      const opts = selected();
      // Prevent disabling the last remaining character category via normal UI interaction
      if (opts.length === 0 && event && event.target && event.isTrusted) {
        event.target.checked = true;
        els.errorText.textContent =
          "At least one character category must remain enabled.";
        els.error.hidden = false;
        announce(
          els.generationStatus,
          "At least one character category must remain enabled."
        );
        return;
      }

      invalidatePassword();
      updateSlider();
      const len = sanitizedLength();
      if (opts.length > 0 && len >= opts.length) {
        els.error.hidden = true;
        storeSettings(len, opts);
      }
    }

    /* --------------------------- Events ---------------------------- */
    els.slider.addEventListener("input", onSliderChange);
    for (const name of cfg.OPTION_ORDER) {
      if (els.options[name]) {
        els.options[name].addEventListener("change", onOptionChange);
      }
    }
    els.form.addEventListener("submit", (e) => {
      e.preventDefault();
      render();
    });
    els.copyButton.addEventListener("click", onCopy);
    window.addEventListener("resize", fitPasswordTypography, { passive: true });

    /* ------------------------ Initial paint ------------------------ */
    if (els.generateLabel) {
      els.generateLabel.textContent = LABEL_GENERATE_INITIAL;
    }
    updateSlider();
    clearStrength();
  }

  // Run after the DOM is ready. `defer` already guarantees this, but the
  // guard keeps the module safe if it is ever loaded differently.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})((window.PasswordGen = window.PasswordGen || {}));
