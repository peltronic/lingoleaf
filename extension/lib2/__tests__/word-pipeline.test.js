"use strict"

// Debug: use `test.only` / `describe.only`, then `yarn test` (uses `--test-only`). Before commit, remove `.only` and run `yarn test:all` for the full suite.

const assert = require("node:assert/strict")
const { describe, test } = require("node:test")

require("./segment-utils.js")
require("./word-pipeline.js")

const { parseTokens, identifyIdioms, translate } =
  globalThis.LingoLeafWordPipeline

describe("parseTokens", () => {
  test("empty and whitespace yield no vocabRows", () => {
    assert.deepEqual(parseTokens(""), [])
    assert.deepEqual(parseTokens("   \n\t  "), [])
  })

  test("single word becomes one vocabRow without save-time ids", () => {
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
      out.map((row) => row.word),
      ["Oh", "l'amour", "vite"],
    )
  })

  test("hyphenated and apostrophe forms stay one surface word per raw segment", () => {
    const out = parseTokens("porte-manteau aujourd'hui")
    assert.deepEqual(
      out.map((row) => row.word),
      ["porte-manteau", "aujourd'hui"],
    )
  })
})

describe("identifyIdioms", () => {
  test("merge count 1 preserves words and returns new vocabRows matching parseTokens shape", async () => {
    const a = parseTokens("un deux")
    const b = await identifyIdioms(a, {
      mergeNextSegmentLead: async () => 1,
    })
    assert.notEqual(b, a)
    assert.deepEqual(b, a)
    assert.notEqual(b[0], a[0])
    assert.deepEqual(b[0], a[0])
  })

  test.only("merges leading vocabRows when mergeNext returns 3 (same window + clip rules as streamLexicalPieces)", async () => {
    const wordList = ["il", "y", "a", "un", "chat"]
    const promptBody =
      'Reply with JSON only: {"count": N} where N is 1..3 for leading tokens.\n' +
      "Tokens:\n" +
      JSON.stringify(wordList)
    assert.ok(promptBody.includes("Tokens:\n"))
    assert.ok(promptBody.endsWith(JSON.stringify(wordList)))

    const vocabRows = parseTokens("il y a un chat")
    let calls = 0
    const mergeNextSegmentLead = async ({ words }) => {
      calls += 1
      if (calls === 1) {
        assert.deepEqual(words, wordList)
        return 3
      }
      if (calls === 2) assert.deepEqual(words, ["un", "chat"])
      if (calls === 3) assert.deepEqual(words, ["chat"])
      return 1
    }
    const out = await identifyIdioms(vocabRows, {
      mergeNextSegmentLead,
      segmentUtils: globalThis.LingoLeafSegmentUtils,
    })
    assert.equal(calls, 3)
    assert.deepEqual(
      out.map((row) => row.word),
      ["il y a", "un", "chat"],
    )
  })
})

describe("translate", () => {
  test("noop leaves translation empty and pending true", async () => {
    const a = parseTokens("chat")
    const idioms = await identifyIdioms(a)
    const b = translate(idioms)
    assert.equal(b[0].translation, "")
    assert.equal(b[0].translationPending, true)
    assert.notEqual(b[0], a[0])
  })
})
