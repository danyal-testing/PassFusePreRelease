import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(ROOT, path), "utf8");

function pngDimensions(path) {
  const data = readFileSync(resolve(ROOT, path));
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

function cspFromVercel() {
  const config = JSON.parse(read("vercel.json"));
  return config.headers
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === "Content-Security-Policy").value;
}

function sha256(source) {
  return createHash("sha256").update(source).digest("base64");
}

test("all service-worker precache entries exist and cache cleanup is prefix-scoped", () => {
  const source = read("sw.js");
  assert.equal(
    source.includes("const CACHE = `${CACHE_PREFIX}v6`;"),
    true,
    "sw.js must use cache version v6"
  );
  const list = source.match(/const ASSETS = \[([\s\S]*?)\];/)?.[1];
  assert.ok(list, "ASSETS list was not found");
  const assets = [...list.matchAll(/"\.\/(.*?)"/g)].map((match) => match[1]);
  assert.ok(assets.length >= 20);
  assert.equal(assets.includes("css/styles.css"), true);
  assert.equal(assets.includes("js/main.js"), true);
  assert.equal(assets.includes("images/apple-touch-icon.png"), true);
  assert.equal(assets.includes("images/logo-mark.svg"), true);
  assert.equal(assets.includes("css/layout/footer.css"), false);
  for (const asset of assets) {
    assert.equal(existsSync(resolve(ROOT, asset || "index.html")), true, asset);
  }
  assert.equal(
    source.includes("key.startsWith(CACHE_PREFIX) && key !== CACHE"),
    true,
    "sw.js must scope cache deletion to CACHE_PREFIX"
  );
});

test("manifest icons, screenshots, and Carbon Platinum theme colors are consistent", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.name, "PassFuse");
  assert.equal(manifest.short_name, "PassFuse");
  assert.equal(manifest.id, ".");
  assert.equal(manifest.start_url, ".");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#090B0F");
  assert.equal(manifest.background_color, "#090B0F");
  for (const asset of [...manifest.icons, ...manifest.screenshots]) {
    assert.equal(existsSync(resolve(ROOT, asset.src)), true, asset.src);
    if (asset.type === "image/png") {
      const [expectedWidth, expectedHeight] = asset.sizes
        .split("x")
        .map(Number);
      assert.deepEqual(pngDimensions(asset.src), {
        width: expectedWidth,
        height: expectedHeight,
      });
    }
  }
});

test("Open Graph, Twitter Card, Apple Touch Icon, and SVG brand assets are synchronized and free of V5 key artifacts", () => {
  const indexHtml = read("index.html");
  assert.equal(indexHtml.includes("danyalpassgen.vercel.app"), false);

  const canonical = indexHtml.match(
    /<link\s+rel="canonical"\s+href="([^"]+)"/
  )?.[1];
  const ogUrl = indexHtml.match(
    /<meta\s+property="og:url"\s+content="([^"]+)"/
  )?.[1];
  const ogImage = indexHtml.match(
    /<meta\s+[\s\S]*?property="og:image"\s+content="([^"]+)"/
  )?.[1];
  const twitterImage = indexHtml.match(
    /<meta\s+[\s\S]*?name="twitter:image"\s+content="([^"]+)"/
  )?.[1];

  assert.equal(canonical, "https://danyalpassfusebeta.vercel.app/");
  assert.equal(ogUrl, "https://danyalpassfusebeta.vercel.app/");
  assert.ok(
    ogImage?.startsWith(
      "https://danyalpassfusebeta.vercel.app/images/og-image.png"
    )
  );
  assert.equal(ogImage, twitterImage, "og:image and twitter:image must match");

  assert.deepEqual(pngDimensions("images/og-image.png"), {
    width: 1200,
    height: 630,
  });
  assert.deepEqual(pngDimensions("images/apple-touch-icon.png"), {
    width: 180,
    height: 180,
  });
  assert.deepEqual(pngDimensions("images/favicon-16.png"), {
    width: 16,
    height: 16,
  });
  assert.deepEqual(pngDimensions("images/favicon-32.png"), {
    width: 32,
    height: 32,
  });
  assert.deepEqual(pngDimensions("images/favicon-48.png"), {
    width: 48,
    height: 48,
  });

  // Ensure no obsolete green-key SVG or outer stroke border remains in icon SVGs
  const roundedSvg = read("images/logo-rounded.svg");
  const maskableSvg = read("images/logo-maskable.svg");
  assert.equal(roundedSvg.includes("stroke="), false);
  assert.equal(roundedSvg.includes('rx="112"'), false);
  assert.equal(maskableSvg.includes("#4ade80"), false);
  assert.equal(maskableSvg.includes("key logo"), false);
  assert.equal(existsSync(resolve(ROOT, "images/logo-mark.svg")), true);
  assert.equal(existsSync(resolve(ROOT, "images/logo-mark-light.svg")), true);
});

test("repository stays source-first without generated bundle or unused SVG icon duplicates", () => {
  for (const file of [
    "css/styles.bundle.css",
    "css/styles.min.css",
    "js/app.js",
    "js/app.min.js",
    "scripts/build-assets.mjs",
    "sw.template.js",
    "FINAL-AUDIT.md",
    "UX-AUDIT.md",
    "netlify.toml",
    ".npmrc",
    "css/layout/footer.css",
    "images/icons/copy.svg",
    "images/icons/copy-check.svg",
    "images/icons/checkbox.svg",
    "images/icons/sun.svg",
    "images/icons/moon.svg",
    "images/icons/alert-triangle.svg",
    "images/icons/arrow-right.svg",
  ]) {
    assert.equal(
      existsSync(resolve(ROOT, file)),
      false,
      `${file} should be absent`
    );
  }
});

test("deployment CSP permits only self origins and exact inline script hashes", () => {
  const csp = cspFromVercel();
  assert.equal(csp.includes("'unsafe-inline'"), false);
  assert.equal(csp.includes("object-src 'none'"), true);
  assert.equal(csp.includes("frame-ancestors 'none'"), true);
  assert.equal(csp.includes("style-src 'self'"), true);
  assert.equal(csp.includes("font-src 'self'"), true);
  assert.equal(csp.includes("fonts.googleapis.com"), false);
  assert.equal(csp.includes("fonts.gstatic.com"), false);

  for (const file of ["index.html", "404.html"]) {
    const inlineScripts = [
      ...read(file).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),
    ]
      .map((match) => match[1])
      .filter((source) => source.trim().length > 0);
    for (const source of inlineScripts) {
      assert.equal(
        csp.includes(`'sha256-${sha256(source)}'`),
        true,
        `${file} CSP hash`
      );
    }
  }
});

test("primary heading PASSWORD GENERATOR, uppercase primary/copy labels, smooth strength meter, motion tokens, and 4-layer Dot Grid + animated ambient architecture are present", () => {
  const indexHtml = read("index.html");
  assert.equal(indexHtml.includes("skip-link"), false);
  assert.equal(indexHtml.includes("Skip to settings"), false);
  assert.equal(indexHtml.includes("exclude-ambiguous"), false);
  assert.equal(indexHtml.includes("Exclude ambiguous"), false);
  assert.equal(indexHtml.includes("data-strength-bits"), false);
  assert.equal(indexHtml.includes("strength__bits"), false);
  assert.equal(indexHtml.includes("length-hint"), false);
  assert.equal(indexHtml.includes("generator__footnote"), false);
  assert.equal(indexHtml.includes("<footer"), false);
  assert.equal(indexHtml.includes('<div class="ambient-background"'), true);
  assert.equal(indexHtml.includes('id="generator-title"'), true);
  assert.equal(indexHtml.includes("PASSWORD GENERATOR"), true);
  assert.equal(indexHtml.includes("GENERATE PASSWORD"), true);
  assert.equal(indexHtml.includes(">Generate password<"), false);

  const mainJs = read("js/main.js");
  assert.equal(mainJs.includes('"GENERATE PASSWORD"'), true);
  assert.equal(mainJs.includes('"GENERATE ANOTHER"'), true);
  assert.equal(mainJs.includes('"COPIED"'), true);
  assert.equal(mainJs.includes('"Generate password"'), false);
  assert.equal(mainJs.includes('"Generate another"'), false);
  assert.equal(mainJs.includes('textContent = "Copied"'), false);

  const variablesCss = read("css/base/variables.css");
  assert.equal(variablesCss.includes("--duration-press:"), true);
  assert.equal(variablesCss.includes("--duration-meter:"), true);
  assert.equal(variablesCss.includes("--duration-theme:"), true);
  assert.equal(variablesCss.includes("--ambient-primary-duration: 32s"), true);
  assert.equal(
    variablesCss.includes("--ambient-secondary-duration: 26s"),
    true
  );
  assert.equal(variablesCss.includes("--dot-grid-color"), true);
  assert.equal(variablesCss.includes("--dot-grid-size: 22px"), true);

  const baseCss = read("css/base/base.css");
  assert.equal(baseCss.includes(".ambient-background"), true);
  assert.equal(baseCss.includes("pg-ambient-primary"), true);
  assert.equal(baseCss.includes("pg-ambient-secondary"), true);

  const strengthCss = read("css/components/strength-meter.css");
  assert.equal(strengthCss.includes("strength__bits"), false);
  assert.equal(strengthCss.includes(".strength__bar::after"), true);
  assert.equal(strengthCss.includes("width var(--duration-meter)"), true);

  const animationsCss = read("css/utilities/animations.css");
  assert.equal(animationsCss.includes("@keyframes pg-ambient-primary"), true);
  assert.equal(animationsCss.includes("@keyframes pg-ambient-secondary"), true);

  // Ensure no CSS file uses `transition: all` or `filter: invert(`
  for (const cssFile of [
    "css/base/reset.css",
    "css/base/variables.css",
    "css/base/typography.css",
    "css/base/base.css",
    "css/layout/container.css",
    "css/layout/header.css",
    "css/components/card.css",
    "css/components/slider.css",
    "css/components/checkbox.css",
    "css/components/strength-meter.css",
    "css/components/button.css",
    "css/components/form.css",
    "css/components/notfound.css",
    "css/utilities/helpers.css",
    "css/utilities/animations.css",
    "css/utilities/responsive.css",
  ]) {
    const css = read(cssFile);
    assert.equal(
      /transition\s*:\s*all\b/.test(css),
      false,
      `${cssFile} must not use transition: all`
    );
    assert.equal(
      css.includes("invert("),
      false,
      `${cssFile} must not use filter: invert()`
    );
  }
});

test("vercel.json schema, production URLs, and privacy claims are accurate", () => {
  const vercelConfig = JSON.parse(read("vercel.json"));
  assert.equal(vercelConfig.$schema, "https://openapi.vercel.sh/vercel.json");
  assert.equal(existsSync(resolve(ROOT, ".editorconfig")), true);
  assert.equal(existsSync(resolve(ROOT, ".nvmrc")), true);
  const indexHtml = read("index.html");
  assert.equal(indexHtml.includes("your-domain.example"), false);
  assert.equal(read("robots.txt").includes("your-domain.example"), false);
  assert.equal(read("sitemap.xml").includes("your-domain.example"), false);
  assert.equal(indexHtml.includes("Nothing is stored or sent"), false);
  assert.equal(
    read("manifest.webmanifest").includes("Nothing is stored or sent"),
    false
  );
});

test("repository contains no broken GitHub badge placeholder", () => {
  assert.equal(read("README.md").includes("your-username"), false);
});
