/**
 * random.js
 * -------------------------------------------------------------------------
 * Cryptographically secure randomness helpers built on the Web Crypto API
 * (crypto.getRandomValues). Math.random() is never used as a fallback: if
 * cryptographic randomness is unavailable, helpers throw an explicit error.
 * -------------------------------------------------------------------------
 */
(function (PG) {
  "use strict";

  /**
   * Return a uniformly distributed integer in the range [0, max).
   * Rejection sampling eliminates modulo bias when 2^32 is not an exact
   * multiple of `max`.
   * @param {number} max Exclusive upper bound (integer in 1..2^32).
   * @returns {number}
   */
  function secureRandomInt(max) {
    if (!Number.isInteger(max) || max <= 0 || max > 0x100000000) {
      throw new RangeError("max must be an integer between 1 and 2^32");
    }
    if (
      typeof crypto === "undefined" ||
      !crypto ||
      typeof crypto.getRandomValues !== "function"
    ) {
      throw new Error("CRYPTO_UNAVAILABLE");
    }
    if (max === 1) {
      // Still verify crypto works by filling a buffer once.
      const verifyBuf = new Uint32Array(1);
      crypto.getRandomValues(verifyBuf);
      return 0;
    }
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    let value;
    do {
      crypto.getRandomValues(buf);
      value = buf[0];
    } while (value >= limit);
    return value % max;
  }

  /** Pick a single uniformly distributed character from a non-empty string. */
  function pick(str) {
    if (typeof str !== "string" || str.length === 0) {
      throw new TypeError("str must be a non-empty string");
    }
    return str[secureRandomInt(str.length)];
  }

  /** Return an unbiased Fisher-Yates shuffled copy of an array. */
  function secureShuffle(items) {
    if (!Array.isArray(items)) throw new TypeError("items must be an array");
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = secureRandomInt(i + 1);
      const tmp = result[i];
      result[i] = result[j];
      result[j] = tmp;
    }
    return result;
  }

  PG.random = Object.freeze({
    secureRandomInt: secureRandomInt,
    pick: pick,
    secureShuffle: secureShuffle,
  });
})((window.PasswordGen = window.PasswordGen || {}));
