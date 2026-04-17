"use strict"

const assert = require("node:assert/strict")
const { describe, test } = require("node:test")

require("./word-pipeline.js")
const { parseTokens, identifyIdioms, translate } =
  globalThis.LingoLeafWordPipeline

describe("parseTokens", () => {
  test("empty and whitespace yield no tokens", () => {
    assert.deepEqual(parseTokens(""), [])
    assert.deepEqual(parseTokens("   \n\t  "), [])
  })

  test("single word becomes one saved-shaped row without save-time ids", () => {
    const out = parseTokens("  bonjour  ")
    assert.equal(out.length, 1)
    assert.deepEqual(out[0], {
      word: "bonjour",
      translation: "",
      translationPending: true,
      urls: [],
    })
    assert.equal("id" in out[0], false)
    assert.equal("savedAt" in out[0], false)
  })

  test("splits on whitespace and strips punctuation around words", () => {
    const out = parseTokens("Oh, l'amour — vite!")
    assert.deepEqual(
      out.map((t) => t.word),
      ["Oh", "l'amour", "vite"],
    )
  })

  test("hyphenated and apostrophe forms stay one surface word when inside token", () => {
    const out = parseTokens("porte-manteau aujourd'hui")
    assert.deepEqual(
      out.map((t) => t.word),
      ["porte-manteau", "aujourd'hui"],
    )
  })
})

describe("identifyIdioms", () => {
  test("noop preserves words and returns new array and new objects", () => {
    const a = parseTokens("un deux")
    const b = identifyIdioms(a)
    assert.notEqual(b, a)
    assert.deepEqual(b, a)
    assert.notEqual(b[0], a[0])
    assert.deepEqual(b[0], a[0])
  })
})

describe("translate", () => {
  test("noop leaves translation empty and pending true", () => {
    const a = parseTokens("chat")
    const b = translate(identifyIdioms(a))
    assert.equal(b[0].translation, "")
    assert.equal(b[0].translationPending, true)
    assert.notEqual(b[0], a[0])
  })
})
