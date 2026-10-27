import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadRuntime(cryptoImpl = webcrypto) {
  const window = {};
  window.window = window;
  const context = vm.createContext({
    window,
    crypto: cryptoImpl,
    Uint32Array,
    Boolean,
    String,
    Object,
    Array,
    Number,
    Math,
    Set,
    Error,
    RangeError,
    TypeError,
  });

  for (const file of ["config.js", "random.js", "generator.js"]) {
    const source = readFileSync(resolve(ROOT, "js", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  return window.PasswordGen;
}

const PG = loadRuntime();
const { SETS, OPTION_ORDER, UI_MIN_LENGTH, UI_MAX_LENGTH, DEFAULT_LENGTH } =
  PG.config;
const { secureRandomInt, pick, secureShuffle } = PG.random;
const { poolFor, generatePassword, classifyCharacter, classifyStrength } =
  PG.generator;

test("configuration and modules are immutable, slider range is 8..32 (default 16), and category sets are pairwise disjoint", () => {
  assert.equal(Object.isFrozen(PG.config), true);
  assert.equal(Object.isFrozen(SETS), true);
  assert.equal(Object.isFrozen(OPTION_ORDER), true);
  assert.equal(Object.isFrozen(PG.config.STRENGTH), true);
  assert.equal(Object.isFrozen(PG.random), true);
  assert.equal(Object.isFrozen(PG.generator), true);

  assert.equal(UI_MIN_LENGTH, 8);
  assert.equal(UI_MAX_LENGTH, 32);
  assert.equal(DEFAULT_LENGTH, 16);
  assert.equal("AMBIGUOUS_CHARS" in PG.config, false);
  assert.equal("filterAmbiguous" in PG.generator, false);

  const seen = new Set();
  for (const key of OPTION_ORDER) {
    for (const ch of SETS[key]) {
      assert.equal(
        seen.has(ch),
        false,
        `character ${ch} duplicated across sets`
      );
      seen.add(ch);
    }
  }
});

test("secureRandomInt validates bounds, stays in range, and rejects modulo-biased values", () => {
  for (const invalid of [0, -1, 1.5, Number.NaN, 0x100000001]) {
    assert.throws(() => secureRandomInt(invalid), RangeError);
  }
  for (const max of [1, 2, 3, 26, 92, 0x100000000]) {
    for (let i = 0; i < 300; i += 1) {
      const value = secureRandomInt(max);
      assert.equal(Number.isInteger(value), true);
      assert.equal(value >= 0 && value < max, true);
    }
  }

  let calls = 0;
  const seqCrypto = {
    getRandomValues(buf) {
      calls += 1;
      buf[0] = calls === 1 ? 4294967295 : 2;
      return buf;
    },
  };
  const pgSeq = loadRuntime(seqCrypto);
  assert.equal(pgSeq.random.secureRandomInt(3), 2);
  assert.equal(calls, 2);
});

test("secureRandomInt throws CRYPTO_UNAVAILABLE when Web Crypto is missing", () => {
  const pgNoCrypto = loadRuntime(null);
  assert.throws(
    () => pgNoCrypto.random.secureRandomInt(10),
    /CRYPTO_UNAVAILABLE/
  );
  assert.throws(
    () => pgNoCrypto.random.secureRandomInt(1),
    /CRYPTO_UNAVAILABLE/
  );
});

test("pick validates input and returns a member", () => {
  assert.throws(() => pick(""), TypeError);
  assert.throws(() => pick(null), TypeError);
  for (let i = 0; i < 200; i += 1) {
    assert.equal(SETS.symbols.includes(pick(SETS.symbols)), true);
  }
});

test("secureShuffle returns a permutation without mutating input", () => {
  const input = [1, 2, 3, 4, 5, 6];
  const before = input.slice();
  const shuffled = secureShuffle(input);
  assert.deepEqual(input, before);
  assert.deepEqual(shuffled.slice().sort(), before);
  assert.notEqual(shuffled, input);
  assert.throws(() => secureShuffle("not-an-array"), TypeError);
});

test("poolFor validates options and concatenates enabled category pools", () => {
  assert.equal(
    poolFor(["uppercase", "numbers"]),
    SETS.uppercase + SETS.numbers
  );
  const fullPool = poolFor(["uppercase", "lowercase", "numbers", "symbols"]);
  assert.equal(fullPool.length, 92);

  assert.throws(() => poolFor([]), /NO_OPTIONS/);
  assert.throws(() => poolFor(["uppercase", "uppercase"]), /INVALID_OPTIONS/);
  assert.throws(() => poolFor(["unknown"]), /INVALID_OPTIONS/);
});

test("classifyCharacter maps letters, numbers, and symbols accurately", () => {
  for (const ch of SETS.uppercase + SETS.lowercase) {
    assert.equal(classifyCharacter(ch), "letter");
  }
  for (const ch of SETS.numbers) {
    assert.equal(classifyCharacter(ch), "number");
  }
  for (const ch of SETS.symbols) {
    assert.equal(classifyCharacter(ch), "symbol");
  }
});

test("generated passwords preserve length, charset, and category coverage", () => {
  const combinations = [];
  for (let mask = 1; mask < 1 << OPTION_ORDER.length; mask += 1) {
    combinations.push(OPTION_ORDER.filter((_, index) => mask & (1 << index)));
  }

  for (const options of combinations) {
    const pool = poolFor(options);
    for (const length of new Set([options.length, 8, 16, 32])) {
      if (length < options.length) continue;
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const password = generatePassword(length, options);
        assert.equal(password.length, length);
        assert.equal(
          [...password].every((character) => pool.includes(character)),
          true
        );
        for (const option of options) {
          const categoryChars = SETS[option];
          assert.equal(
            [...password].some((character) =>
              categoryChars.includes(character)
            ),
            true
          );
        }
      }
    }
  }
});

test("generator rejects impossible, malformed, or non-terminating rejection requests", () => {
  assert.throws(() => generatePassword(0, ["uppercase"]), /INVALID_LENGTH/);
  assert.throws(() => generatePassword(65, ["uppercase"]), /INVALID_LENGTH/);
  assert.throws(() => generatePassword(8.5, ["uppercase"]), /INVALID_LENGTH/);
  assert.throws(() => generatePassword(3, OPTION_ORDER), /LENGTH_TOO_SHORT/);
  assert.throws(() => generatePassword(8, []), /NO_OPTIONS/);
  assert.throws(
    () => generatePassword(8, ["uppercase", "uppercase"]),
    /INVALID_OPTIONS/
  );
  assert.throws(() => generatePassword(8, ["not-real"]), /INVALID_OPTIONS/);

  const stuckCrypto = {
    getRandomValues(buf) {
      buf[0] = 0;
      return buf;
    },
  };
  const pgStuck = loadRuntime(stuckCrypto);
  assert.throws(
    () => pgStuck.generator.generatePassword(8, ["uppercase", "numbers"]),
    /REJECTION_LIMIT_EXCEEDED/
  );
});

test("qualitative strength classification returns WEAK, FAIR, STRONG, and VERY STRONG without numeric scores", () => {
  const weakShort = classifyStrength(8, OPTION_ORDER);
  assert.equal(weakShort.level, "weak");
  assert.equal(weakShort.label, "WEAK");
  assert.equal(weakShort.bars, 1);
  assert.equal("bits" in weakShort, false);

  const weakNumbers = classifyStrength(12, ["numbers"]);
  assert.equal(weakNumbers.level, "weak");

  const fairModerate = classifyStrength(11, ["uppercase", "lowercase"]);
  assert.equal(fairModerate.level, "fair");
  assert.equal(fairModerate.label, "FAIR");
  assert.equal(fairModerate.bars, 2);

  const strongThree = classifyStrength(14, [
    "uppercase",
    "lowercase",
    "numbers",
  ]);
  assert.equal(strongThree.level, "strong");
  assert.equal(strongThree.label, "STRONG");
  assert.equal(strongThree.bars, 3);

  const veryStrongAll = classifyStrength(16, OPTION_ORDER);
  assert.equal(veryStrongAll.level, "very-strong");
  assert.equal(veryStrongAll.label, "VERY STRONG");
  assert.equal(veryStrongAll.bars, 4);
  assert.equal("bits" in veryStrongAll, false);
});
