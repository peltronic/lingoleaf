;(() => {
  const segmentUtils = globalThis.LingoLeafSegmentUtils
  const ollamaApi = globalThis.LingoLeafOllamaApi
  const prompts = globalThis.LingoLeafPrompts

  const MERGE_MAX_SPAN = 3
  const MERGE_LOOKAHEAD = 12

  // Given a list of words, clip (slice) the list to a maximum length
  // Input:
  //   words — string[].
  //   maxItems — number from segment config.
  //   maxChars — number, max JSON length for the clipped array.
  // Output:
  //   string[], prefix of words (possibly shortened until JSON fits).
  function sliceWordArray(words, maxItems, maxChars) {
    const spanCap = maxItems * MERGE_MAX_SPAN
    let clipped = words.length > spanCap ? words.slice(0, spanCap) : words.slice()
    while (clipped.length > 1 && JSON.stringify(clipped).length > maxChars) {
      clipped = clipped.slice(0, clipped.length - 1)
    }
    return clipped
  }

  // Yields each merged or single-token surface (idiom/phrase) string as soon as it is decided 
  // (one Ollama call per yield, except single-token inputs).
  // Input:
  //   rawSelection — string.
  //   opts — `{ baseUrl, model, segmentCfg }` with maxItems and maxChars on segmentCfg.
  // Output:
  //   async generator yields string, French phrase or word in reading order
  async function* streamLexicalPieces(
    rawSelection,
    { baseUrl, model, segmentCfg },
  ) {
    const allWords = segmentUtils.parseWords(rawSelection)
    if (!allWords.length) {
      // no words
      yield rawSelection
      return
    }
    if (allWords.length === 1) {
      // single word
      yield allWords[0]
      return
    }

    // Multiple Words: select the first N words as a candidateion idiom/phrase
    const headWords = sliceWordArray( allWords, segmentCfg.maxItems, segmentCfg.maxChars )
    const seen = new Set()

    let i = 0
    while (i < headWords.length) {

      // lookahead window
      const window = headWords.slice( i, Math.min(i+MERGE_LOOKAHEAD, headWords.length))
      const cap = Math.min(MERGE_MAX_SPAN, window.length)

      let idiomCount = 1

      try {
        if (!window.length) {
          idiomCount = 1 // no window, so count is 1
        } else {
          // returns N next words that compose an idiom or phrase (JSON format)
          const promptWithContent = prompts.buildPromptToIdentifyIdioms({words: window, maxSpan: MERGE_MAX_SPAN})
          const responseJSON = await ollamaApi.ollamaChat({
            baseUrl, // %FIXME %TODO: use DI
            model,
            content: promptWithContent,
            temperature: 0.1,
          })
          const _count = segmentUtils.postProcessIdentifyIdiomsResponse(responseJSON, MERGE_MAX_SPAN)
          idiomCount = _count == null ? 1 : Math.min(Math.max(1, _count), cap)
        }
      } catch {
        idiomCount = 1
      }
      idiomCount = Math.max(1, Math.min(idiomCount, MERGE_MAX_SPAN, headWords.length - i))
      const idiomStr = headWords.slice(i, i + idiomCount).join(" ")
      const key = segmentUtils.normalizeForCompare(idiomStr)
      if (key && !seen.has(key)) {
        seen.add(key)
        yield idiomStr
      }
      i += idiomCount // skip over the idiom/phrase just identified
    }

    // In the case of a long selection (allWords.length > headWords.length), yield any 
    // remaining words that are not part of an idiom/phrase (NOTE only yields single words)
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
  // Input:
  //   rawSelection — string.
  //   opts — same object as streamLexicalPieces.
  // Output:
  //   Promise<string[]>, never empty (falls back to `[rawSelection]`).
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
