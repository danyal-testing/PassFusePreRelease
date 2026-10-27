import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Authoritative social-preview revision token (`OG_IMAGE_VERSION`).
 * Increment this value (or pass `OG_IMAGE_VERSION=<n>`) whenever
 * `images/og-image.png` is replaced so messaging platforms (iMessage,
 * Telegram, WhatsApp, Slack, X) fetch the new preview asset.
 */
export const OG_IMAGE_VERSION = process.env.OG_IMAGE_VERSION || "7";

const input = process.argv[2] || "https://danyalpassfusebeta.vercel.app";

const url = new URL(input);
if (url.protocol !== "https:") {
  throw new Error("The production URL must use HTTPS");
}
if (url.username || url.password || url.search || url.hash) {
  throw new Error("Provide only the production origin and optional base path");
}

const productionBase = url.href.replace(/\/$/, "");
const ogImageUrl = `${productionBase}/images/og-image.png?v=${OG_IMAGE_VERSION}`;

// 1. Update index.html canonical, Open Graph, Twitter, and JSON-LD URLs.
const indexPath = resolve(ROOT, "index.html");
let indexSource = await readFile(indexPath, "utf8");
indexSource = indexSource
  .replace(
    /(<link\s+rel="canonical"\s+href=")https:\/\/[^"]+(")/,
    `$1${productionBase}/$2`
  )
  .replace(
    /(<meta\s+property="og:url"\s+content=")https:\/\/[^"]+(")/,
    `$1${productionBase}/$2`
  )
  .replace(
    /(<meta\s+[\s\S]*?property="og:image"\s+content=")https:\/\/[^"]+\/images\/og-image\.png(?:\?[^"]*)?(")/,
    `$1${ogImageUrl}$2`
  )
  .replace(
    /(<meta\s+[\s\S]*?property="og:image:secure_url"\s+content=")https:\/\/[^"]+\/images\/og-image\.png(?:\?[^"]*)?(")/,
    `$1${ogImageUrl}$2`
  )
  .replace(
    /(<meta\s+[\s\S]*?name="twitter:image"\s+content=")https:\/\/[^"]+\/images\/og-image\.png(?:\?[^"]*)?(")/,
    `$1${ogImageUrl}$2`
  )
  .replace(/("url":\s*")https:\/\/[^"]+(")/, `$1${productionBase}/$2`)
  .replace(
    /("image":\s*")https:\/\/[^"]+\/images\/og-image\.png(?:\?[^"]*)?(")/,
    `$1${ogImageUrl}$2`
  );
await writeFile(indexPath, indexSource);

// 2. Update robots.txt
const robotsPath = resolve(ROOT, "robots.txt");
let robotsSource = await readFile(robotsPath, "utf8");
robotsSource = robotsSource.replace(
  /Sitemap:\s*https:\/\/[^\s]+\/sitemap\.xml/,
  `Sitemap: ${productionBase}/sitemap.xml`
);
await writeFile(robotsPath, robotsSource);

// 3. Update sitemap.xml
const sitemapPath = resolve(ROOT, "sitemap.xml");
let sitemapSource = await readFile(sitemapPath, "utf8");
sitemapSource = sitemapSource.replace(
  /<loc>https:\/\/[^<]+<\/loc>/,
  `<loc>${productionBase}/</loc>`
);
await writeFile(sitemapPath, sitemapSource);

// 4. Sync inline script SHA-256 hashes in vercel.json CSP header
const hashes = new Set();
for (const htmlFile of ["index.html", "404.html"]) {
  const html = await readFile(resolve(ROOT, htmlFile), "utf8");
  const scripts = [
    ...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),
  ]
    .map((match) => match[1])
    .filter((source) => source.trim().length > 0);
  for (const script of scripts) {
    const digest = createHash("sha256").update(script).digest("base64");
    hashes.add(`'sha256-${digest}'`);
  }
}

const vercelPath = resolve(ROOT, "vercel.json");
const vercelConfig = JSON.parse(await readFile(vercelPath, "utf8"));
for (const rule of vercelConfig.headers) {
  for (const header of rule.headers) {
    if (header.key === "Content-Security-Policy") {
      header.value = header.value.replace(
        /script-src 'self'(?:\s+'sha256-[^']+')+/,
        `script-src 'self' ${[...hashes].join(" ")}`
      );
    }
  }
}
await writeFile(vercelPath, JSON.stringify(vercelConfig, null, 2) + "\n");

console.log(
  `Updated production URL references to ${productionBase} (OG_IMAGE_VERSION=${OG_IMAGE_VERSION}) and synced CSP hashes.`
);
