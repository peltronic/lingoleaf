;(() => {
  const MERGE_MAX_SPAN = 3
  const MERGE_LOOKAHEAD = 12
  const DEFAULT_SEGMENT_CFG = { maxItems: 40, maxChars: 1500 }

  const ollamaApi = globalThis.LingoLeafOllamaApi
  const segmentUtils = globalThis.LingoLeafSegmentUtils

  // Builds one `vocabRow` for the pipeline: same core fields as `buildEntry` in background.js before `id` / `savedAt` / `saveSessionId`.
  // Input:
  //   surfaceFrench — string, one surface form (single word or merged phrase).
  // Output:
  //   object, vocabRow shape `{ word, translation, translationPending, urls }`.
  function makeVocabRow(surfaceFrench) {
    const w = String(surfaceFrench || "").trim()
    return {
      word: w,
      translation: "",
      translationPending: true,
      urls: [],
    }
  }

  // Pulls the first word-like substring from one whitespace-delimited piece (apostrophe/hyphen for compounds).
  // Input:
  //   rawSegment — string, one chunk from `split(/\s+/)` (may include punctuation).
  // Output:
  //   string, empty when no letters/digits remain.
  function extractCleanWordFromText(rawSegment) {
    const m = String(rawSegment).match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/u)
    return m ? m[0] : ""
  }

  // Splits user text into ordered `vocabRow`s
  // Input:
  //   text — string, raw phrase or sentence.
  // Output:
  //   vocabRow[], one row per extracted surface word (empty when nothing parses).
  function parseTokens(text) {
    const t = String(text || "").trim()
    if (!t) return []
    const out = []
    for (const piece of t.split(/\s+/)) {
      const w = extractCleanWordFromText(piece)
      if (w) out.push(makeVocabRow(w))
    }
    return out
  }

  // Caps the token list by count and by approximate JSON length so merge prompts 
  // stay bounded.
  // Input:
  //   words — string[].
  //   maxItems — number from segment config.
  //   maxChars — number, max JSON length for the clipped array.
  // Output:
  //   string[], prefix of words (possibly shortened until JSON fits).
  function clipWordsForPrompt(words, maxItems, maxChars) {
    const spanCap = maxItems * MERGE_MAX_SPAN
    let clipped = words.length > spanCap ? words.slice(0, spanCap) : words.slice()
    while (clipped.length > 1 && JSON.stringify(clipped).length > maxChars) {
      clipped = clipped.slice(0, clipped.length - 1)
    }
    return clipped
  }

  // Groups adjacent single-word `vocabRow`s using the same window, clip, merge-count, and dedupe
  // rules as `streamLexicalPieces` in segmentation-pipeline.js (merge call is injectable for tests).
  // Input:
  //   vocabRows — object[], each a vocabRow whose `word` is one surface word (same order as `tokenizeSelectionToWords` on that text).
  //   opts — optional object; all keys optional:
  //    - baseUrl — on `opts`, string, Ollama base URL; forwarded to `mergeNextSegmentLead` (needed 
  //      for the real API implementation).
  //    - model — on `opts`, string, model id; forwarded to `mergeNextSegmentLead` (needed for the real API implementation).
  // Output:
  //   Promise<vocabRow[]>, merged rows (`word` may contain spaces); empty when `vocabRows` is empty.
  async function identifyIdioms(vocabRows, opts = {}) {
    if (!vocabRows || !vocabRows.length) return []

    // Extract words from the vocabRows, filter out empty words
    const allWords = vocabRows
      .map((row) => String(row && row.word != null ? row.word : "").trim())
      .filter(Boolean)
    if (!allWords.length) return []
    if (allWords.length === 1) return [{ ...vocabRows[0] }]

    const MAX_ITEMS = 40
    const MAX_CHARS = 1500
    const headWords = clipWordsForPrompt( allWords, MAX_ITEMS, MAX_CHARS )
    const seen = new Set() // detect duplicates
    const out = [] // stored words/idioms

    let i = 0
    while (i < headWords.length) {
      const lookaheadIndex = Math.min(i + MERGE_LOOKAHEAD, headWords.length)
      const window = headWords.slice( i, lookaheadIndex )
      let count = 1 // holds the number of words identified to combine as an idiom
      let response = ""
      try {
        count = await ollamaApi.mergeNextSegmentLead({
          baseUrl,
          model,
          words: window,
          maxSpan: MERGE_MAX_SPAN,
        })
      } catch {
        count = 1
      }
      count = Math.max(1, Math.min(count, MERGE_MAX_SPAN, headWords.length - i))
      const idiomStr = headWords.slice(i, i + count).join(" ") // join the words into one string
      const key = segmentUtils.normalizeForCompare(idiomStr)
      if (key && !seen.has(key)) {
        seen.add(key)
        out.push(makeVocabRow(idiomStr))
      }
      i += count
    }

    return out
  }

  // Placeholder for English gloss; leaves `translation` empty and `translationPending` true.
  // Input:
  //   vocabRows — object[], vocabRows after idiom pass.
  // Output:
  //   vocabRow[], shallow copy per row (translate pass is a no-op for now).
  function translate(vocabRows) {
    if (!vocabRows || !vocabRows.length) return []
    return vocabRows.map((row) => ({ ...row }))
  }

  const api = { parseTokens, identifyIdioms, translate }
  globalThis.LingoLeafWordPipeline = api
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api
  }
})()
