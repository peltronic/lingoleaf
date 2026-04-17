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

  // Builds one list-row-shaped token for pipeline stages; omits save-time fields (`id`, `savedAt`, `saveSessionId`).
  // Input:
  //   word — string, surface French (one lexical unit after extraction).
  // Output:
  //   object, same core fields as `buildEntry` in background.js before ids/timestamps are applied.
  function savedRowShapedToken(word) {
    const w = String(word || "").trim()
    return {
      word: w,
      translation: "",
      translationPending: true,
      urls: [],
    }
  }

  // Pulls the first word-like substring from one whitespace-delimited piece (apostrophe/hyphen for compounds).
  // Input:
  //   token — string.
  // Output:
  //   string, empty when no letters/digits remain.
  function extractWordFromToken(token) {
    const m = String(token).match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/u)
    return m ? m[0] : ""
  }

  // Splits user text into ordered saved-row-shaped tokens (self-contained; does not call segment-utils).
  // Input:
  //   text — string, raw phrase or sentence.
  // Output:
  //   object[], tokens with `word`, `translation`, `translationPending`, `urls` (empty array when nothing parses).
  function parseTokens(text) {
    const t = String(text || "").trim()
    if (!t) return []
    const out = []
    for (const piece of t.split(/\s+/)) {
      const w = extractWordFromToken(piece)
      if (w) out.push(savedRowShapedToken(w))
    }
    return out
  }

  // Groups adjacent single-word rows using the same window, clip, merge-count, and dedupe 
  // rules as `streamLexicalPieces` in segmentation-pipeline.js (merge call is injectable for tests).
  // Input:
  //   tokens — object[], saved-row-shaped items whose `word` fields 
  //            are the same sequence tokenizeSelectionToWords would produce.
  //   opts — optional `{ mergeNextSegmentLead, segmentUtils, segmentCfg, baseUrl, model }`; 
  //          `mergeNextSegmentLead` defaults to `globalThis.LingoLeafOllamaApi.mergeNextSegmentLead` when set; if no merge function exists, chunk size stays 1 (no network). Pass `baseUrl` and `model` when using the default Ollama merge.
  // Output:
  //   Promise<object[]>, merged rows (`word` may contain spaces); empty when `tokens` is empty.
  async function identifyIdioms(tokens, opts = {}) {
    if (!tokens || !tokens.length) return []
    const allWords = tokens
      .map((t) => String(t && t.word != null ? t.word : "").trim())
      .filter(Boolean)
    if (!allWords.length) return []
    if (allWords.length === 1) return [{ ...tokens[0] }]

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
        out.push(savedRowShapedToken(surface))
      }
      i += count
    }

    for (let j = headWords.length; j < allWords.length; j += 1) {
      const w = allWords[j]
      const key = segmentUtils.normalizeForCompare(w)
      if (key && !seen.has(key)) {
        seen.add(key)
        out.push(savedRowShapedToken(w))
      }
    }

    return out
  }

  // Placeholder for English gloss; leaves `translation` empty and `translationPending` true.
  // Input:
  //   tokens — object[], saved-row-shaped items after idiom pass.
  // Output:
  //   object[], shallow copy per item (translate pass is a no-op for now).
  function translate(tokens) {
    if (!tokens || !tokens.length) return []
    return tokens.map((x) => ({ ...x }))
  }

  const api = { parseTokens, identifyIdioms, translate }
  globalThis.LingoLeafWordPipeline = api
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api
  }
})()
