"use strict"

const assert = require("node:assert/strict")
const { describe, test } = require("node:test")
const { buildPhraseExtractPromptPayload } = require("#extension/lib2/prompts.js")

// Expected payload is JSON-serializable; word-pipeline passes JSON.stringify(this) to Ollama as `messages[0].content`.
const EXPECTED_EXTRACT_PHRASES = [
  {
    type: "idioms",
    min_length: 2,
    max_length: 4,
  },
]

describe("lib2/prompts buildPhraseExtractPromptPayload", () => {
  test("returns fixed extract_phrases + output_format, sentence coerced, suitable for Ollama body", () => {
    const french = "il y a beaucoup de monde"
    const out = buildPhraseExtractPromptPayload({ sentence: french })
    const expected = {
      sentence: french,
      extract_phrases: EXPECTED_EXTRACT_PHRASES,
      output_format: "list",
    }
    assert.deepEqual(out, expected)

    const outNull = buildPhraseExtractPromptPayload({ sentence: null })
    assert.deepEqual(outNull, {
      sentence: "",
      extract_phrases: EXPECTED_EXTRACT_PHRASES,
      output_format: "list",
    })

    // Sanity: round-trip through JSON matches what ollamaChat stringifies
    const roundTrip = JSON.parse(JSON.stringify(out))
    assert.deepEqual(roundTrip, expected)
  })
})
