import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = join(ROOT, "docs", "screenshots");

function resolveChromiumExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/usr/local/bin/chromium",
    "/usr/bin/chromium",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function resolveHost() {
  const policyPath = "/etc/chromium/policies/managed/chrome_policy.json";
  if (existsSync(policyPath)) {
    try {
      const policy = JSON.parse(readFileSync(policyPath, "utf8"));
      if (policy.URLBlocklist?.includes("127.0.0.1")) return "127.0.0.2";
    } catch {
      /* ignore policy read error */
    }
  }
  return "127.0.0.1";
}

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const HOST = resolveHost();
const PORT = 4179;
const server = createServer(async (req, res) => {
  const decoded = decodeURIComponent((req.url || "/").split("?")[0]);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const filePath = normalize(join(ROOT, requested));
  try {
    if (!filePath.startsWith(ROOT)) throw new Error("unsafe");
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(filePath)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});

await new Promise((r) => server.listen(PORT, HOST, r));
const executablePath = resolveChromiumExecutable();

mkdirSync(DOCS_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});

const scenarios = [
  {
    file: "laptop-dark.png",
    theme: "dark",
    width: 1440,
    height: 900,
    length: 18,
  },
  {
    file: "laptop-light.png",
    theme: "light",
    width: 1440,
    height: 900,
    length: 18,
  },
  {
    file: "tablet-dark.png",
    theme: "dark",
    width: 834,
    height: 1194,
    length: 18,
  },
  {
    file: "tablet-light.png",
    theme: "light",
    width: 834,
    height: 1194,
    length: 18,
  },
  {
    file: "mobile-dark.png",
    theme: "dark",
    width: 390,
    height: 844,
    length: 16,
  },
  {
    file: "mobile-light.png",
    theme: "light",
    width: 390,
    height: 844,
    length: 16,
  },
  {
    file: "iphone-se-dark.png",
    theme: "dark",
    width: 375,
    height: 667,
    length: 16,
  },
  {
    file: "iphone-se-light.png",
    theme: "light",
    width: 375,
    height: 667,
    length: 16,
  },
];

try {
  for (const scenario of scenarios) {
    const page = await browser.newPage({
      viewport: { width: scenario.width, height: scenario.height },
      deviceScaleFactor: 2,
    });

    await page.addInitScript((theme) => {
      try {
        localStorage.setItem("pg-theme", theme);
      } catch {
        /* ignore restricted storage */
      }
      document.documentElement.setAttribute("data-theme", theme);
    }, scenario.theme);

    await page.emulateMedia({
      colorScheme: scenario.theme,
      reducedMotion: "no-preference",
    });
    await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "networkidle" });

    for (const option of ["uppercase", "lowercase", "numbers", "symbols"]) {
      await page.locator(`[data-option="${option}"]`).evaluate((input) => {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    await page.locator("[data-length-input]").fill(String(scenario.length));
    await page.locator("[data-form]").evaluate((form) => form.requestSubmit());

    await page.waitForTimeout(420);
    await page.evaluate(() => {
      for (const anim of document.getAnimations({ subtree: true })) {
        if (
          typeof CSSTransition !== "undefined" &&
          anim instanceof CSSTransition
        ) {
          anim.finish();
        }
      }
    });
    await page.screenshot({ path: join(DOCS_DIR, scenario.file) });
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}

process.stdout.write("Screenshots regenerated.\n");
