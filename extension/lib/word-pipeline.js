;(() => {
  // Builds one list-row-shaped token for pipeline stages; omits save-time fields (`id`, `savedAt`, `saveSessionId`).
  // Params: word — string, surface French (one lexical unit after extraction).
  // Returns: object, same core fields as `buildEntry` in background.js before ids/timestamps are applied.
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
  // Params: token — string.
  // Returns: string, empty when no letters/digits remain.
  function extractWordFromToken(token) {
    const m = String(token).match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/u)
    return m ? m[0] : ""
  }

  // Splits user text into ordered saved-row-shaped tokens (self-contained; does not call segment-utils).
  // Params: text — string, raw phrase or sentence.
  // Returns: object[], tokens with `word`, `translation`, `translationPending`, `urls` (empty array when nothing parses).
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

  // Placeholder for idiom grouping; currently returns one token per input word unchanged.
  // Params: tokens — object[], saved-row-shaped items from `parseTokens` or a prior stage.
  // Returns: object[], shallow copy per item in the same order (idiom pass is a no-op for now).
  function identifyIdioms(tokens) {
    if (!tokens || !tokens.length) return []
    return tokens.map((x) => ({ ...x }))
  }

  // Placeholder for English gloss; leaves `translation` empty and `translationPending` true.
  // Params: tokens — object[], saved-row-shaped items after idiom pass.
  // Returns: object[], shallow copy per item (translate pass is a no-op for now).
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
