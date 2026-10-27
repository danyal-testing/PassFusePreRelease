# PassFuse Architecture Notes

This repository is intentionally **lean** and **source-first**. Every file in the tree is shipped or executed directly without a bundler, transpiler, or generated artifact layer.

## 1. Classic Namespace Architecture (`window.PasswordGen`)

Modern ES modules (`<script type="module">`) are blocked by browser CORS policy when `index.html` is opened directly from disk over `file://`. To support both direct `file://` execution and hosted HTTP/HTTPS PWA deployment from the exact same source files, JavaScript is organized into ordered IIFE modules sharing `window.PasswordGen`:

1. `js/config.js` — Frozen character pools (`SETS`), slider and generator length bounds (`8`–`32`, default `16`), Carbon Platinum theme colors, and qualitative strength definitions (`STRENGTH`).
2. `js/random.js` — Unbiased Web Crypto primitives (`secureRandomInt` with rejection sampling, `pick`, `secureShuffle`).
3. `js/generator.js` — Pure password generation via uniform whole-candidate rejection sampling (`generatePassword`), character-category classification (`classifyCharacter`), and qualitative strength classification (`classifyStrength`).
4. `js/theme.js` — Dark/light theme state, `localStorage` persistence, and live `prefers-color-scheme` tracking.
5. `js/clipboard.js` — Async Clipboard API wrapper with a focus-preserving off-screen `textarea` fallback for restricted `file://` contexts.
6. `js/main.js` — DOM orchestration, safe category-colored password rendering, neutral initial strength state, request-token-guarded copy feedback, and responsive 2-line password fitting.
7. `js/pwa.js` — Progressive Service Worker registration restricted to `http:` and `https:`.

All seven scripts are loaded in `<head>` with `defer`, allowing the browser's preload scanner to fetch them in parallel with HTML parsing while guaranteeing deterministic execution order after DOM parsing completes.

## 2. Layered CSS System & iOS Safari Viewport Stability (`css/styles.css`)

Styles are organized under explicit CSS Cascade Layers (`@layer reset, tokens, base, components, utilities;`):

- `css/base/` — Normalization (`reset.css`), Carbon Platinum dark and light design tokens (`variables.css`), base typography (`typography.css`), and document/ambient reflection & radially faded dot-grid primitives (`.ambient-background` in `base.css`).
  - Both `html` and `body` apply `background-color: var(--bg)` and the top radial gradient without `background-attachment: fixed`, using `min-height: 100svh` (with `-webkit-fill-available` and `100vh` fallbacks) and `env(safe-area-inset-*)` padding so iOS Safari (including iPhone SE 2022 `375×667`) renders a continuous background on first paint without requiring a scroll.
- `css/layout/` — App container (`container.css`) and header (`header.css`).
- `css/components/` — Reusable UI primitives (`card.css`, `slider.css`, `checkbox.css`, `strength-meter.css`, `button.css`, `form.css`, `notfound.css`).
- `css/utilities/` — Screen-reader helpers (`helpers.css`), reduced-motion-aware keyframes (`animations.css`), and unlayered responsive overrides (`responsive.css`).

## 3. Service Worker & Cache Isolation (`sw.js`)

- Pre-caches the complete app shell and icon suite on `install` under `passfuse-classic-v6`.
- Scopes cache deletion during `activate` strictly to `CACHE_PREFIX = "passfuse-classic-"` so unrelated applications hosted on the same origin never lose their caches.
- Uses network-first with offline cache fallback for navigation requests and cache-first with background revalidation (caching only `200 OK` basic responses) for static assets.

## 4. Brand Assets, Social Preview & Maintenance Scripts

- `images/og-image.png` — Authoritative `1200×630` Open Graph and Twitter social preview card.
- `images/apple-touch-icon.png` (`180×180`), `images/icons/app/icon-192.png`, and `images/icons/app/icon-512.png` — Full-bleed, 100% opaque square icons without a pre-baked outer border or transparent corners so iOS and Android apply native masks cleanly.
- `images/icons/app/maskable-192.png` and `images/icons/app/maskable-512.png` — Full-bleed opaque maskable icons with the PF mark centered inside the 80% W3C maskable safe zone.
- `images/logo-mark.svg` and `images/logo-mark-light.svg` — Standalone transparent PF brand marks for dark and light surfaces.
- `scripts/set-production-url.mjs` — Updates canonical, Open Graph, Twitter, JSON-LD, `robots.txt`, and `sitemap.xml` URLs (synchronizing `?v=<OG_IMAGE_VERSION>`) and recomputes the exact SHA-256 CSP hashes for inline scripts in `index.html` and `404.html`.
- `scripts/generate-screenshots.mjs` — Renders deterministic dark and light screenshots across laptop (`1440×900` @2x), tablet (`834×1194` @2x), mobile (`390×844` @2x), and iPhone SE 2022 (`375×667` @2x) viewports.
- `tests/unit.test.mjs`, `tests/project.test.mjs`, and `tests/e2e.mjs` — Enforce cryptographic generation invariants, repository structure, CSP hash synchronization, icon and OG dimensions, accessibility, and zero horizontal overflow from `280px` to `2560px`.
