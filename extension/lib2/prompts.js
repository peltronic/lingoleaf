;(() => {
  // Assembles the phrase-extraction request object; `extract_phrases` is fixed (idioms + pattern rules) per product spec.
  // Input:
  //   sentence — string, full French text to analyze.
  //   output_format — string, e.g. `"list"`; defaults to `"list"` when null/empty.
  // Output:
  //   object, JSON-serializable payload `{ sentence, extract_phrases, output_format }` (new object each call).
  function buildPhraseExtractPromptPayload({ sentence, output_format }) {
    return {
      sentence: sentence == null ? "" : String(sentence),
      extract_phrases: [
        {
          type: "idioms",
          min_length: 4,
          max_length: 10,
        },
        {
          type: "phrases_with_patterns",
          patterns: [
            {
              pattern: "(?:m'attendais|y étais allée)",
              min_matches: 2,
              ignore_case: true,
            },
          ],
        },
      ],
      output_format:
        output_format == null || output_format === ""
          ? "list"
          : String(output_format),
    }
  }

  const api = { buildPhraseExtractPromptPayload }
  globalThis.LingoLeafLib2Prompts = api
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api
  }
})()
