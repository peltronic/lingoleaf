"use strict"

// Debug: use `test.only` / `describe.only`, then `yarn test` (uses `--test-only`). Before commit, remove `.only` and run `yarn test:all` for the full suite.

const assert = require("node:assert/strict")
const { describe, test } = require("node:test")
const prompts = require("#extension/lib2/prompts.js")

// Imports resolve from repo root via `package.json` → `"imports"` → `#extension/*` (run tests from project root).
require("#extension/lib/segment-utils.js")
require("#extension/lib/ollama-api.js")
require("#extension/lib2/word-pipeline.js")

const { parseTokens, identifyIdioms, translate } =
  globalThis.LingoLeafWordPipeline
const ollamaApi = globalThis.LingoLeafOllamaApi

const TEST_STRING_CONTENT_1 = "Donc c'est vrai que moi je m'attendais pas à ça et surtout par rapport à quand j'y étais allée il y a quelques années, ça m'a semblé beaucoup plus cher. Donc si vous êtes américain et que vous regardez cette vidéo, peut-être que vous pouvez nous dire si effectivement le coût de la vie a beaucoup augmenté ces dernières années."

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

describe("buildPhraseExtractPromptPayload", () => {
  test("merges leading vocabRows when mergeNext returns 3 (same window + clip rules as streamLexicalPieces)", async () => {
    const wordList = ["il", "y", "a", "un", "chat"]
    //const stringContent = wordList.join(" ")
    const stringContent = TEST_STRING_CONTENT_1
    const promptPayload = prompts.buildPhraseExtractPromptPayload({ sentence: stringContent })

    //const vocabRows = parseTokens("il y a un chat")
    //const out = await identifyIdioms(vocabRows)
    const response = await ollamaApi.ollamaChat({
      content: JSON.stringify(promptPayload),
    })
    console.log('HERE.T1', {
      stringContent,
      promptPayload,
      response,
    })
    //assert.deepEqual(
    //  out.map((row) => row.word),
    //  ["il y a", "un", "chat"],
    //)
  })
})

describe("identifyIdioms", () => {
  test("merge count 1 preserves words and returns new vocabRows matching parseTokens shape", async () => {
    const a = parseTokens("un deux")
    const prev = ollamaApi.ollamaChat
    ollamaApi.ollamaChat = async () => '{"count": 1}'
    let b
    try {
      b = await identifyIdioms(a)
    } finally {
      ollamaApi.ollamaChat = prev
    }
    assert.notEqual(b, a)
    assert.deepEqual(b, a)
    assert.notEqual(b[0], a[0])
    assert.deepEqual(b[0], a[0])
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
