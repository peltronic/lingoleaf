;(() => {
  const segmentUtils = globalThis.LingoLeafSegmentUtils
  const ollamaApi = globalThis.LingoLeafOllamaApi

  const MERGE_MAX_SPAN = 3
  const MERGE_LOOKAHEAD = 12

  // Caps the token list by count and by approximate JSON length so merge prompts stay bounded.
  // Params: words — string[]; maxItems — number from segment config; maxChars — number, max JSON length for the clipped array.
  // Returns: string[], prefix of words (possibly shortened until JSON fits).
  function clipWordsForMerge(words, maxItems, maxChars) {
    const spanCap = maxItems * MERGE_MAX_SPAN
    let clipped =
      words.length > spanCap ? words.slice(0, spanCap) : words.slice()
    while (clipped.length > 1 && JSON.stringify(clipped).length > maxChars) {
      clipped = clipped.slice(0, clipped.length - 1)
    }
    return clipped
  }

  // Yields each merged or single-token surface string as soon as it is decided (one Ollama call per yield, except single-token inputs).
  // Params: rawSelection — string; second arg — `{ baseUrl, model, segmentCfg }` with maxItems and maxChars on segmentCfg.
  // Yields: string, French phrase or word in reading order (yields rawSelection when tokenization is empty).
  async function* streamLexicalPieces(
    rawSelection,
    { baseUrl, model, segmentCfg },
  ) {
    const allWords = segmentUtils.tokenizeSelectionToWords(rawSelection)
    if (!allWords.length) {
      yield rawSelection
      return
    }
    if (allWords.length === 1) {
      yield allWords[0]
      return
    }

    const headWords = clipWordsForMerge(
      allWords,
      segmentCfg.maxItems,
      segmentCfg.maxChars,
    )
    const seen = new Set()
    let i = 0

    while (i < headWords.length) {
      const window = headWords.slice(
        i,
        Math.min(i + MERGE_LOOKAHEAD, headWords.length),
      )
      let count = 1
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
      const surface = headWords.slice(i, i + count).join(" ")
      const key = segmentUtils.normalizeForCompare(surface)
      if (key && !seen.has(key)) {
        seen.add(key)
        yield surface
      }
      i += count
    }

    for (let j = headWords.length; j < allWords.length; j += 1) {
      const w = allWords[j]
      const key = segmentUtils.normalizeForCompare(w)
      if (key && !seen.has(key)) {
        seen.add(key)
        yield w
      }
    }
  }

  // Collects the async generator into an array for callers that need the full list at once.
  // Params: rawSelection — string; opts — same object as streamLexicalPieces.
  // Returns: Promise<string[]>, never empty (falls back to `[rawSelection]`).
  async function getLexicalPieces(rawSelection, opts) {
    const out = []
    for await (const piece of streamLexicalPieces(rawSelection, opts))
      out.push(piece)
    return out.length ? out : [rawSelection]
  }

  globalThis.LingoLeafSegmentationPipeline = {
    streamLexicalPieces,
    getLexicalPieces,
  }
})()
