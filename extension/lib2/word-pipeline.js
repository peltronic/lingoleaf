;(() => {
  const MERGE_MAX_SPAN = 3
  const MERGE_LOOKAHEAD = 12
  const DEFAULT_SEGMENT_CFG = { maxItems: 40, maxChars: 1500 }

  // Same clipping rule as `clipWordsForMerge` in segmentation-pipeline.js (kept local so this lib stays self-contained).
  // Input:
  //   words — string[].
  //   maxItems — number from segment config.
  //   maxChars — number, max JSON length for the clipped array.
  // Output:
  //   string[], prefix of words (possibly shortened until JSON fits).
  function clipWordsForMerge(words, maxItems, maxChars) {
    const spanCap = maxItems * MERGE_MAX_SPAN
    let clipped =
      words.length > spanCap ? words.slice(0, spanCap) : words.slice()
    while (clipped.length > 1 && JSON.stringify(clipped).length > maxChars) {
      clipped = clipped.slice(0, clipped.length - 1)
    }
    return clipped
  }

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
  function extractWordFromSegment(rawSegment) {
    const m = String(rawSegment).match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/u)
    return m ? m[0] : ""
  }

  // Splits user text into ordered `vocabRow`s (self-contained; does not call segment-utils).
  // Input:
  //   text — string, raw phrase or sentence.
  // Output:
  //   vocabRow[], one row per extracted surface word (empty when nothing parses).
  function parseTokens(text) {
    const t = String(text || "").trim()
    if (!t) return []
    const out = []
    for (const piece of t.split(/\s+/)) {
      const w = extractWordFromSegment(piece)
      if (w) out.push(makeVocabRow(w))
    }
    return out
  }

  // Groups adjacent single-word `vocabRow`s using the same window, clip, merge-count, and dedupe
  // rules as `streamLexicalPieces` in segmentation-pipeline.js (merge call is injectable for tests).
  // Input:
  //   vocabRows — object[], each a vocabRow whose `word` is one surface word (same order as `tokenizeSelectionToWords` on that text).
  //   opts — optional object; all keys optional:
  //    - mergeNextSegmentLead — on `opts`, async fn `(args) => count` with args `{ baseUrl, model, words, maxSpan }` 
  //     like Ollama merge; returns how many leading `words` to merge. Defaults to `globalThis.LingoLeafOllamaApi.mergeNextSegmentLead` 
  //     when that exists; if absent, every chunk size is 1 (no merge, no network).
  //    - segmentUtils — on `opts`, object with `normalizeForCompare` for dedupe keys; defaults to `globalThis.LingoLeafSegmentUtils` 
  //      (required for multi-word input).
  //    - segmentCfg — on `opts`, partial `{ maxItems, maxChars }` merged with pipeline defaults; caps how many surface words 
  //      enter the merge window and JSON size for clipping.
  //    - baseUrl — on `opts`, string, Ollama base URL; forwarded to `mergeNextSegmentLead` (needed 
  //      for the real API implementation).
  //    - model — on `opts`, string, model id; forwarded to `mergeNextSegmentLead` (needed for the real API implementation).
  // Output:
  //   Promise<vocabRow[]>, merged rows (`word` may contain spaces); empty when `vocabRows` is empty.
  async function identifyIdioms(vocabRows, opts = {}) {
    if (!vocabRows || !vocabRows.length) return []
    const allWords = vocabRows
      .map((row) => String(row && row.word != null ? row.word : "").trim())
      .filter(Boolean)
    if (!allWords.length) return []
    if (allWords.length === 1) return [{ ...vocabRows[0] }]

    const segmentUtils =
      opts.segmentUtils ?? globalThis.LingoLeafSegmentUtils
    if (!segmentUtils || typeof segmentUtils.normalizeForCompare !== "function") {
      throw new Error(
        "identifyIdioms: LingoLeafSegmentUtils missing; load segment-utils.js or pass opts.segmentUtils",
      )
    }

    const segmentCfg = { ...DEFAULT_SEGMENT_CFG, ...opts.segmentCfg }
    const mergeNext =
      opts.mergeNextSegmentLead ??
      globalThis.LingoLeafOllamaApi?.mergeNextSegmentLead ??
      null
    const baseUrl = opts.baseUrl
    const model = opts.model

    const headWords = clipWordsForMerge(
      allWords,
      segmentCfg.maxItems,
      segmentCfg.maxChars,
    )
    const seen = new Set()
    const out = []
    let i = 0

    while (i < headWords.length) {
      const window = headWords.slice(
        i,
        Math.min(i + MERGE_LOOKAHEAD, headWords.length),
      )
      let count = 1
      if (mergeNext) {
        try {
          count = await mergeNext({
            baseUrl,
            model,
            words: window,
            maxSpan: MERGE_MAX_SPAN,
          })
        } catch {
          count = 1
        }
      }
      count = Math.max(1, Math.min(count, MERGE_MAX_SPAN, headWords.length - i))
      const surface = headWords.slice(i, i + count).join(" ")
      const key = segmentUtils.normalizeForCompare(surface)
      if (key && !seen.has(key)) {
        seen.add(key)
        out.push(makeVocabRow(surface))
      }
      i += count
    }

    for (let j = headWords.length; j < allWords.length; j += 1) {
      const w = allWords[j]
      const key = segmentUtils.normalizeForCompare(w)
      if (key && !seen.has(key)) {
        seen.add(key)
        out.push(makeVocabRow(w))
      }
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
