/**
 * pwa.js
 * -------------------------------------------------------------------------
 * Registers the service worker so the app is installable and works offline
 * after the first visit over HTTP(S).
 *
 * Registration only runs over http: or https: (e.g. when deployed to a
 * static host or local web server). It is intentionally skipped on file://,
 * where the Service Worker API is unsupported — the core password generator
 * works directly from disk without a service worker.
 * -------------------------------------------------------------------------
 */
(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "http:" && location.protocol !== "https:") return;

  function registerSW() {
    navigator.serviceWorker.register("./sw.js").catch(function () {
      /* Service worker is a progressive enhancement; ignore failures. */
    });
  }

  if (document.readyState === "complete") {
    registerSW();
  } else {
    window.addEventListener("load", registerSW, { once: true });
  }
})();
