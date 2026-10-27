import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const HOST = "127.0.0.2";
const PORT = 4173;
const ORIGIN = `http://${HOST}:${PORT}`;
const vercelConfig = JSON.parse(
  await readFile(join(ROOT, "vercel.json"), "utf8")
);
const CSP =
  vercelConfig.headers?.[0]?.headers?.find(
    (header) => header.key === "Content-Security-Policy"
  )?.value || "";

const SYSTEM_BROWSER_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
].filter(Boolean);

async function resolveChromiumExecutable() {
  for (const candidate of SYSTEM_BROWSER_CANDIDATES) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue checking fallback candidates.
    }
  }
  return undefined;
}

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

async function waitForText(locator, expected) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await locator.textContent()) === expected) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  assert.equal(await locator.textContent(), expected);
}

async function auditAccessibility(page, context, theme) {
  await page.mouse.move(0, 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate((nextTheme) => {
    document.documentElement.setAttribute("data-theme", nextTheme);
    for (const anim of document.getAnimations({ subtree: true })) {
      if (
        typeof CSSTransition !== "undefined" &&
        anim instanceof CSSTransition
      ) {
        anim.finish();
      }
    }
  }, theme);
  await page.waitForTimeout(30);

  const audit = await page.evaluate(() => {
    const parse = (value) => {
      const parts = value.match(/[\d.]+/g)?.map(Number) || [];
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    };
    const composite = (foreground, background) => ({
      r: foreground.r * foreground.a + background.r * (1 - foreground.a),
      g: foreground.g * foreground.a + background.g * (1 - foreground.a),
      b: foreground.b * foreground.a + background.b * (1 - foreground.a),
      a: 1,
    });
    const luminance = ({ r, g, b }) => {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratio = (foreground, background) => {
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    };
    const backgroundFor = (element) => {
      let current = element;
      while (current) {
        const color = parse(getComputedStyle(current).backgroundColor);
        if (color.a > 0) return color;
        current = current.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };

    const selectors = [
      ".generator__title",
      ".generator__password",
      ".pw-char",
      ".field__label",
      ".field__value",
      ".option__label",
      ".form-error",
      ".strength__label",
      ".strength__text",
      ".btn__label",
    ];
    const contrast = selectors.flatMap((selector) =>
      [...document.querySelectorAll(selector)]
        .filter(
          (element) =>
            getComputedStyle(element).display !== "none" &&
            element.textContent.trim().length > 0
        )
        .map((element) => {
          const background = backgroundFor(element);
          const foreground = composite(
            parse(getComputedStyle(element).color),
            background
          );
          return { selector, ratio: ratio(foreground, background) };
        })
    );

    const targets = [
      ...document.querySelectorAll("button, input[type='range'], .option"),
    ]
      .filter((element) => getComputedStyle(element).display !== "none")
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label:
            element.getAttribute("aria-label") ||
            element.textContent.trim() ||
            element.className,
          width: rect.width,
          height: rect.height,
        };
      });
    return { contrast, targets };
  });

  for (const result of audit.contrast) {
    assert.equal(
      result.ratio >= 4.5,
      true,
      `${theme} ${result.selector} contrast ${result.ratio.toFixed(2)}:1`
    );
  }
  for (const target of audit.targets) {
    assert.equal(
      target.width >= 44 && target.height >= 44,
      true,
      `${target.label} target ${target.width}x${target.height}`
    );
  }

  const session = await context.newCDPSession(page);
  const { nodes } = await session.send("Accessibility.getFullAXTree");
  const interactiveRoles = new Set(["button", "checkbox", "link", "slider"]);
  const unnamed = nodes.filter(
    (node) =>
      !node.ignored &&
      interactiveRoles.has(node.role?.value) &&
      !node.name?.value?.trim()
  );
  assert.deepEqual(unnamed, [], `${theme} has unnamed interactive controls`);
  await session.detach();
}

function safePath(pathname) {
  const decoded = decodeURIComponent(pathname.split("?")[0]);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const filePath = normalize(join(ROOT, requested));
  return filePath.startsWith(ROOT) ? filePath : null;
}

const server = createServer(async (request, response) => {
  const filePath = safePath(request.url || "/");
  try {
    if (!filePath) throw new Error("unsafe path");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": TYPES[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "Content-Security-Policy": CSP,
    });
    response.end(body);
  } catch {
    const body = await readFile(join(ROOT, "404.html"));
    response.writeHead(404, { "Content-Type": TYPES[".html"] });
    response.end(body);
  }
});

await new Promise((resolveListen) => server.listen(PORT, HOST, resolveListen));
const executablePath = await resolveChromiumExecutable();
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const runtimeErrors = [];
  const externalRequests = [];
  page.on("request", (req) => {
    const reqUrl = new URL(req.url());
    if (reqUrl.origin !== ORIGIN && reqUrl.protocol !== "data:") {
      externalRequests.push(req.url());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error")
      runtimeErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => runtimeErrors.push(`page: ${error.message}`));

  await page.goto(ORIGIN, { waitUntil: "networkidle" });
  assert.deepEqual(externalRequests, [], "zero external runtime requests");
  assert.equal(await page.locator("h1").count(), 1);
  assert.equal(
    (await page.locator("h1#generator-title").textContent())?.trim(),
    "PASSWORD GENERATOR"
  );
  assert.equal(await page.locator("main").count(), 1);
  assert.equal(await page.locator(".ambient-background").count(), 1);
  assert.equal(await page.locator(".skip-link").count(), 0);
  assert.equal(await page.locator("[data-exclude-ambiguous]").count(), 0);
  assert.equal(await page.locator("[data-strength-bits]").count(), 0);
  assert.equal(await page.locator(".generator__footnote").count(), 0);
  assert.equal(await page.locator("footer").count(), 0);
  assert.equal(
    await page.locator("[data-password-output]").textContent(),
    "Generate a password"
  );
  // 1. Verify initial uppercase Generate button label
  assert.equal(
    (await page.locator("[data-generate-label]").textContent())?.trim(),
    "GENERATE PASSWORD"
  );
  // Neutral initial state before the first password is generated
  assert.equal(await page.locator("[data-strength-text]").textContent(), "—");
  assert.equal(await page.locator("[data-copy-button]").isDisabled(), true);
  assert.equal(
    await page.locator("[data-length-input]").getAttribute("aria-valuetext"),
    "16 characters"
  );

  // Verify live normal-motion animation properties, stacking order, and multi-frame movement
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(40);
  const normalMotionState = await page.evaluate(async () => {
    const before1 = getComputedStyle(document.body, "::before");
    const after1 = getComputedStyle(document.body, "::after");
    const dotGrid = getComputedStyle(
      document.querySelector(".ambient-background")
    );
    const mainGen = getComputedStyle(document.querySelector("main.generator"));

    const anims = document.getAnimations({ subtree: true });
    const beforeAnim = anims.find(
      (a) => a.animationName === "pg-ambient-primary"
    );
    const afterAnim = anims.find(
      (a) => a.animationName === "pg-ambient-secondary"
    );

    const t0Before = before1.transform;
    const t0After = after1.transform;
    const t0DotTransform = dotGrid.transform;

    // Advance the Web Animations timeline by 8 seconds to inspect a distinct frame
    if (beforeAnim) beforeAnim.currentTime = 8000;
    if (afterAnim) afterAnim.currentTime = 8000;
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    );

    const t1Before = getComputedStyle(document.body, "::before").transform;
    const t1After = getComputedStyle(document.body, "::after").transform;
    const t1DotTransform = getComputedStyle(
      document.querySelector(".ambient-background")
    ).transform;

    return {
      beforeName: before1.animationName,
      beforeDuration: before1.animationDuration,
      beforeZ: Number(before1.zIndex),
      beforePointer: before1.pointerEvents,
      afterName: after1.animationName,
      afterDuration: after1.animationDuration,
      afterZ: Number(after1.zIndex),
      afterPointer: after1.pointerEvents,
      dotZ: Number(dotGrid.zIndex),
      dotPointer: dotGrid.pointerEvents,
      dotBgImage: dotGrid.backgroundImage,
      dotMask: dotGrid.maskImage || dotGrid.webkitMaskImage,
      mainZ: Number(mainGen.zIndex),
      t0Before,
      t1Before,
      t0After,
      t1After,
      t0DotTransform,
      t1DotTransform,
    };
  });

  assert.equal(normalMotionState.beforeName, "pg-ambient-primary");
  assert.equal(normalMotionState.beforeDuration, "32s");
  assert.equal(normalMotionState.beforeZ, 0);
  assert.equal(normalMotionState.beforePointer, "none");

  assert.equal(normalMotionState.afterName, "pg-ambient-secondary");
  assert.equal(normalMotionState.afterDuration, "26s");
  assert.equal(normalMotionState.afterZ, 0);
  assert.equal(normalMotionState.afterPointer, "none");

  assert.equal(normalMotionState.dotZ, 1);
  assert.equal(normalMotionState.dotPointer, "none");
  assert.equal(normalMotionState.dotBgImage.includes("radial-gradient"), true);
  assert.equal(normalMotionState.dotMask.includes("radial-gradient"), true);
  assert.equal(normalMotionState.mainZ, 2);

  // Verify the ambient gradient layers actually move between frames while the Dot Grid stays sharp and stationary
  assert.notEqual(
    normalMotionState.t0Before,
    normalMotionState.t1Before,
    "primary ambient glow must animate across frames under normal motion"
  );
  assert.notEqual(
    normalMotionState.t0After,
    normalMotionState.t1After,
    "secondary ambient glow must animate across frames under normal motion"
  );
  assert.equal(
    normalMotionState.t0DotTransform,
    normalMotionState.t1DotTransform,
    "Dot Grid layer must remain stationary without shimmering"
  );

  // Verify prefers-reduced-motion disables ambient movement while preserving Dot Grid + static ambient lighting
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(40);
  const reducedMotionState = await page.evaluate(() => {
    const before = getComputedStyle(document.body, "::before");
    const after = getComputedStyle(document.body, "::after");
    const dotGrid = getComputedStyle(
      document.querySelector(".ambient-background")
    );
    return {
      beforeName: before.animationName,
      afterName: after.animationName,
      beforeBg: before.backgroundImage,
      afterBg: after.backgroundImage,
      dotBg: dotGrid.backgroundImage,
    };
  });
  assert.equal(reducedMotionState.beforeName, "none");
  assert.equal(reducedMotionState.afterName, "none");
  assert.equal(reducedMotionState.beforeBg.includes("radial-gradient"), true);
  assert.equal(reducedMotionState.afterBg.includes("radial-gradient"), true);
  assert.equal(reducedMotionState.dotBg.includes("radial-gradient"), true);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // Measure initial strength meter container height to ensure zero layout jump across states
  const initialMeterHeight = await page.evaluate(
    () => document.querySelector(".strength").getBoundingClientRect().height
  );

  // 2. Generate first password via button click -> label becomes "GENERATE ANOTHER"
  await page.locator("[data-generate-button]").click();
  const firstPassword =
    (await page.locator("[data-password-output]").textContent()) || "";
  assert.equal(firstPassword.length, 16);
  assert.equal(await page.locator("[data-copy-button]").isDisabled(), false);
  assert.equal(
    await page.locator("[data-strength-text]").textContent(),
    "VERY STRONG"
  );
  assert.equal(
    await page.locator(".strength").getAttribute("data-strength-level"),
    "very-strong"
  );
  assert.equal(await page.locator(".pw-char").count(), 16);
  await waitForText(
    page.locator("[data-generation-status]"),
    "New password generated. Use the copy button to copy it."
  );
  assert.equal(
    await page.locator("[data-generate-label]").textContent(),
    "GENERATE ANOTHER"
  );

  // Finish active CSS transitions deterministically and verify properties and invariant container height
  const meterAudit = await page.evaluate(() => {
    for (const anim of document.getAnimations({ subtree: true })) {
      if (
        typeof CSSTransition !== "undefined" &&
        anim instanceof CSSTransition
      ) {
        anim.finish();
      }
    }
    const bar = document.querySelector("[data-strength-bar]");
    const afterStyle = getComputedStyle(bar, "::after");
    return {
      height: document.querySelector(".strength").getBoundingClientRect()
        .height,
      transitionProperty: afterStyle.transitionProperty,
      transitionDuration: afterStyle.transitionDuration,
      opacity: afterStyle.opacity,
      fillWidth: Number.parseFloat(afterStyle.width),
      trackWidth: bar.getBoundingClientRect().width,
    };
  });
  assert.equal(meterAudit.height, initialMeterHeight);
  assert.equal(meterAudit.transitionProperty.includes("width"), true);
  assert.equal(
    meterAudit.transitionProperty.includes("background-color"),
    true
  );
  assert.equal(meterAudit.opacity, "1");
  assert.equal(
    Math.abs(meterAudit.fillWidth - meterAudit.trackWidth) < 2,
    true
  );

  // 3. Copy password and verify uppercase "COPIED" and exact raw password on clipboard
  await page.locator("[data-copy-button]").click();
  await page.locator("[data-copy-text]").waitFor({ state: "visible" });
  await waitForText(
    page.locator("[data-copy-announcement]"),
    "Password copied to clipboard."
  );
  assert.equal(await page.locator("[data-copy-text]").textContent(), "COPIED");
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    firstPassword
  );

  // 4. Verify copy error state transitions cleanly when clipboard fails
  await page.evaluate(() => {
    window.__origWriteText = navigator.clipboard.writeText.bind(
      navigator.clipboard
    );
    window.__origExecCommand = document.execCommand.bind(document);
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new Error("COPY_FAILED")),
    });
    document.execCommand = () => false;
  });
  await page.locator("[data-copy-button]").click();
  await waitForText(page.locator("[data-copy-text]"), "Copy failed");
  assert.equal(
    await page.evaluate(() =>
      document
        .querySelector("[data-copy-button]")
        .classList.contains("is-error")
    ),
    true
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: window.__origWriteText,
    });
    document.execCommand = window.__origExecCommand;
  });

  // 5. Changing options invalidates stale password -> meter empties smoothly and label resets to "GENERATE PASSWORD"
  await page.locator("[data-length-input]").fill("8");
  await page
    .locator("[data-length-input]")
    .dispatchEvent("input", { bubbles: true });
  assert.equal(
    await page.locator("[data-password-output]").textContent(),
    "Generate a password"
  );
  assert.equal(await page.locator("[data-strength-text]").textContent(), "—");
  assert.equal(
    await page.locator(".strength").getAttribute("data-strength-level"),
    null
  );
  assert.equal(await page.locator("[data-copy-button]").isDisabled(), true);
  assert.equal(
    await page.locator("[data-generate-label]").textContent(),
    "GENERATE PASSWORD"
  );
  const emptyMeterAudit = await page.evaluate(() => {
    for (const anim of document.getAnimations({ subtree: true })) {
      if (
        typeof CSSTransition !== "undefined" &&
        anim instanceof CSSTransition
      ) {
        anim.finish();
      }
    }
    const bar = document.querySelector("[data-strength-bar]");
    const afterStyle = getComputedStyle(bar, "::after");
    return {
      height: document.querySelector(".strength").getBoundingClientRect()
        .height,
      fillWidth: Number.parseFloat(afterStyle.width),
      opacity: afterStyle.opacity,
    };
  });
  assert.equal(emptyMeterAudit.height, initialMeterHeight);
  assert.equal(emptyMeterAudit.fillWidth, 0);
  assert.equal(emptyMeterAudit.opacity, "0");

  // 6. Attempting to uncheck all categories displays inline error while keeping "GENERATE PASSWORD"
  for (const name of ["uppercase", "lowercase", "numbers", "symbols"]) {
    await page.locator(`label[for="${name}"]`).click();
  }
  await page.locator("[data-error]").waitFor({ state: "visible" });
  assert.equal(
    await page.locator("[data-generate-label]").textContent(),
    "GENERATE PASSWORD"
  );
  await page.locator('label[for="lowercase"]').click();
  await page.locator("[data-error]").waitFor({ state: "hidden" });

  // 7. Generate 8-char password -> WEAK, label becomes "GENERATE ANOTHER"
  await page.locator("[data-form]").evaluate((form) => form.requestSubmit());
  assert.equal(
    await page.locator("[data-strength-text]").textContent(),
    "WEAK"
  );
  assert.equal(
    await page.locator(".strength").getAttribute("data-strength-level"),
    "weak"
  );
  assert.equal(
    await page.locator("[data-generate-label]").textContent(),
    "GENERATE ANOTHER"
  );

  await page.locator("[data-length-input]").fill("16");
  await page.locator("[data-form]").evaluate((form) => form.requestSubmit());
  await auditAccessibility(page, context, "dark");
  await auditAccessibility(page, context, "light");

  // 8. Verify theme toggle icon transition properties and theme switching without layout shift
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const initialTheme = await page.locator("html").getAttribute("data-theme");
  const toggleBeforeRect = await page
    .locator("[data-theme-toggle]")
    .boundingBox();
  await page.locator("[data-theme-toggle]").click({ position: { x: 4, y: 4 } });
  const toggledTheme = await page.locator("html").getAttribute("data-theme");
  const toggleAfterRect = await page
    .locator("[data-theme-toggle]")
    .boundingBox();
  assert.notEqual(toggledTheme, initialTheme);
  assert.deepEqual(toggleBeforeRect, toggleAfterRect);
  assert.match(
    (await page.locator("[data-theme-toggle]").getAttribute("aria-label")) ||
      "",
    /^Switch to (light|dark) theme$/
  );

  // Finish theme transition (--duration-theme: 260ms) deterministically and verify active/inactive icon opacities
  const iconState = await page.evaluate(() => {
    for (const anim of document.getAnimations({ subtree: true })) {
      if (
        typeof CSSTransition !== "undefined" &&
        anim instanceof CSSTransition
      ) {
        anim.finish();
      }
    }
    const theme = document.documentElement.getAttribute("data-theme");
    const sun = getComputedStyle(
      document.querySelector(".theme-toggle__icon--sun")
    );
    const moon = getComputedStyle(
      document.querySelector(".theme-toggle__icon--moon")
    );
    return {
      theme,
      sunOpacity: sun.opacity,
      moonOpacity: moon.opacity,
      sunTransition: sun.transitionProperty,
    };
  });
  assert.equal(iconState.sunTransition.includes("opacity"), true);
  assert.equal(iconState.sunTransition.includes("transform"), true);
  if (iconState.theme === "dark") {
    assert.equal(iconState.sunOpacity, "1");
    assert.equal(iconState.moonOpacity, "0");
  } else {
    assert.equal(iconState.sunOpacity, "0");
    assert.equal(iconState.moonOpacity, "1");
  }

  // Verify iPhone SE 2022 (375x667) first-load background continuity and faded dot-grid in both themes
  await page.setViewportSize({ width: 375, height: 667 });
  for (const theme of ["dark", "light"]) {
    await page.evaluate((nextTheme) => {
      document.documentElement.setAttribute("data-theme", nextTheme);
      for (const anim of document.getAnimations({ subtree: true })) {
        if (
          typeof CSSTransition !== "undefined" &&
          anim instanceof CSSTransition
        ) {
          anim.finish();
        }
      }
    }, theme);
    await page.waitForTimeout(20);
    const seAudit = await page.evaluate(() => {
      const htmlStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      const ambientEl = document.querySelector(".ambient-background");
      const ambientStyle = getComputedStyle(ambientEl);
      const ambientRect = ambientEl.getBoundingClientRect();
      const mainRect = document
        .querySelector("main.generator")
        .getBoundingClientRect();
      const btnRect = document
        .querySelector("[data-generate-button]")
        .getBoundingClientRect();
      const labelRect = document
        .querySelector("[data-generate-label]")
        .getBoundingClientRect();
      return {
        htmlBg: htmlStyle.backgroundColor,
        bodyBg: bodyStyle.backgroundColor,
        bodyBgAttach: bodyStyle.backgroundAttachment,
        ambientBgImage: ambientStyle.backgroundImage,
        ambientWidth: ambientRect.width,
        ambientHeight: ambientRect.height,
        mainTop: mainRect.top,
        mainBottom: mainRect.bottom,
        btnWidth: btnRect.width,
        labelWidth: labelRect.width,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        docOverflowX:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });
    const expectedBg =
      theme === "dark" ? "rgb(9, 11, 15)" : "rgb(243, 245, 248)";
    assert.equal(
      seAudit.htmlBg,
      expectedBg,
      `iPhone SE html background (${theme})`
    );
    assert.equal(
      seAudit.bodyBg,
      expectedBg,
      `iPhone SE body background (${theme})`
    );
    assert.equal(
      seAudit.bodyBgAttach,
      "scroll",
      "body must not use background-attachment: fixed on mobile"
    );
    assert.equal(
      seAudit.ambientBgImage.includes("radial-gradient"),
      true,
      "ambient dot-grid must render radial-gradient dots"
    );
    assert.equal(seAudit.ambientWidth, seAudit.innerWidth);
    assert.equal(seAudit.ambientHeight, seAudit.innerHeight);
    assert.equal(seAudit.mainTop >= 0, true);
    assert.equal(seAudit.mainBottom <= seAudit.innerHeight, true);
    assert.equal(seAudit.labelWidth < seAudit.btnWidth, true);
    assert.equal(seAudit.docOverflowX <= 0, true);
  }

  const widths = [
    280, 320, 360, 375, 390, 414, 430, 480, 576, 600, 768, 820, 834, 1024, 1280,
    1366, 1440, 1536, 1600, 1728, 1920, 2560,
  ];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator("[data-length-input]").fill("32");
    await page.locator("[data-form]").evaluate((form) => form.requestSubmit());
    await page.waitForTimeout(20);
    const passwordLayout = await page
      .locator("[data-password-output]")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          height: element.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(style.lineHeight),
          text: element.textContent,
        };
      });
    assert.equal(
      passwordLayout.text.length,
      32,
      `password length at ${width}px`
    );
    const overflow = await page.evaluate(() => ({
      document:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      card:
        document.querySelector(".generator__panel").scrollWidth -
        document.querySelector(".generator__panel").clientWidth,
      labelFitsButton:
        document.querySelector("[data-generate-label]").getBoundingClientRect()
          .width <
        document.querySelector("[data-generate-button]").getBoundingClientRect()
          .width,
    }));
    assert.equal(
      overflow.document <= 0,
      true,
      `document overflow at ${width}px`
    );
    assert.equal(overflow.card <= 0, true, `card overflow at ${width}px`);
    assert.equal(
      overflow.labelFitsButton,
      true,
      `uppercase button label fits inside button at ${width}px`
    );
  }

  const serviceWorkerReady = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  assert.equal(serviceWorkerReady, true);

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(
    await page.locator("[data-generate-label]").textContent(),
    "GENERATE PASSWORD"
  );
  await page.locator("[data-generate-button]").click();
  assert.equal(
    ((await page.locator("[data-password-output]").textContent()) || "").length,
    32
  );
  assert.equal(
    await page.locator("[data-generate-label]").textContent(),
    "GENERATE ANOTHER"
  );
  await context.setOffline(false);

  assert.deepEqual(runtimeErrors, []);

  const response404 = await page.goto(`${ORIGIN}/missing-route`, {
    waitUntil: "domcontentloaded",
  });
  assert.equal(response404?.status(), 404);
  assert.equal(
    await page.locator("#notfound-title").textContent(),
    "Page not found"
  );
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
