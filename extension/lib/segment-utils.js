;(() => {
  const DEFAULTS = {
    minWords: 4,
    maxChars: 1500,
    maxItems: 40,
    punctuationMinWords: 3,
  }

  // Counts words separated by whitespace (after trim).
  // Input:
  //   text — string.
  // Output:
  //   number, word count (0 for empty or whitespace-only).
  function countWords(text) {
    return text.trim().split(/\s+/).filter(Boolean).length
  }

  // Decides whether the save flow should run the word-list merge pipeline vs saving the selection as one string.
  // Input:
  //   text — string, user selection.
  //   cfg — optional object with minWords, maxChars, maxItems, punctuationMinWords (defaults from DEFAULTS).
  // Output:
  //   boolean.
  function shouldSegmentSelection(text, cfg = DEFAULTS) {
    const t = text.trim()
    if (!t) return false
    if (t.length > cfg.maxChars) return true
    if (/[,.!?;:]/.test(t) && countWords(t) >= cfg.punctuationMinWords)
      return true
    return countWords(t) >= cfg.minWords
  }

  // Lowercases, strips accents, replaces non letter/digit runs with spaces, collapses whitespace.
  // Input:
  //   text — string.
  // Output:
  //   string, normalized form for comparisons (empty when input trims to nothing).
  function normalizeForCompare(text) {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  // True when items are missing, a single chunk, or join to the same normalized text as the original (no useful split).
  // Input:
  //   original — string.
  //   items — string[] | null | undefined.
  // Output:
  //   boolean.
  function looksLikeUnsplittedSelection(original, items) {
    if (!items || items.length <= 1) return true
    const joined = normalizeForCompare(items.join(" "))
    const raw = normalizeForCompare(original)
    if (!joined || !raw) return true
    return joined === raw
  }

  // Extracts the first word-like substring, allowing internal apostrophe or hyphen for French compounds.
  // Input:
  //   token — string, one whitespace-delimited piece from the selection.
  // Output:
  //   string, extracted word, or empty string when no letters/digits remain.
  function extractWordFromToken(token) {
    const m = String(token).match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/u)
    return m ? m[0] : ""
  }

  // Tokenizes the selection into a word array for the merge model (punctuation stripped per token).
  // Input:
  //   text — string, raw user selection.
  // Output:
  //   string[], non-empty tokens in order (empty array when nothing tokenizes).
  function tokenizeSelectionToWords(text) {
    const t = text.trim()
    if (!t) return []
    const out = []
    for (const tok of t.split(/\s+/)) {
      const w = extractWordFromToken(tok)
      if (w) out.push(w)
    }
    return out
  }

  // Validates model segments as a strict partition of `words` and rebuilds surface strings from the original tokens.
  // Input:
  //   words — string[].
  //   modelSegments — string[] from the model.
  //   options — optional `{ maxSpan }`, caps words per output string (default 3).
  // Output:
  //   string[] when the partition is valid; null on mismatch, reorder, skip, or span overflow.
  function materializeWordPartitionOrNull(
    words,
    modelSegments,
    { maxSpan = 3 } = {},
  ) {
    if (!words || !words.length) return null
    const segments = modelSegments.map((s) => String(s).trim()).filter(Boolean)
    if (!segments.length) return null
    let i = 0
    const out = []
    for (const seg of segments) {
      const parts = seg.split(/\s+/).filter(Boolean)
      if (!parts.length) return null
      const start = i
      for (const p of parts) {
        if (i >= words.length) return null
        if (normalizeForCompare(p) !== normalizeForCompare(words[i]))
          return null
        i += 1
      }
      const span = i - start
      if (span > maxSpan) return null
      out.push(words.slice(start, i).join(" "))
    }
    if (i !== words.length) return null
    return out
  }

  // True if `pageUrl` (after trim) is already present in `urls` (string compare after trim on each list entry).
  // Input:
  //   urls — string[].
  //   pageUrl — string to test (may be empty; empty after trim is not considered duplicate of anything).
  // Output:
  //   boolean.
  function isDuplicatePageUrl(urls, pageUrl) {
    if (!Array.isArray(urls) || !pageUrl || typeof pageUrl !== "string" || !pageUrl.trim())
      return false
    const t = pageUrl.trim()
    for (let i = 0; i < urls.length; i += 1) {
      const s = urls[i]
      if (typeof s === "string" && s.trim() === t) return true
    }
    return false
  }

  // Appends the current page URL only if `isDuplicatePageUrl` is false.
  // Input:
  //   urls — string[].
  //   pageUrl — string (may be empty).
  // Output:
  //   string[], new array (never mutates `urls`).
  function mergePageUrlIntoUrls(urls, pageUrl) {
    const base = Array.isArray(urls) ? [...urls] : []
    if (!pageUrl || typeof pageUrl !== "string" || !pageUrl.trim()) return base
    const u = pageUrl.trim()
    if (isDuplicatePageUrl(base, u)) return base
    return [...base, u]
  }

  // Shallow-copies a vocabRow so the `urls` array is not shared (safe before mutating rows in memory).
  // Input:
  //   row — object from storage, or any value.
  // Output:
  //   a plain object with `urls` as a new array, or the original value if not a non-array object.
  function copyVocabRow(row) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row
    return { ...row, urls: Array.isArray(row.urls) ? [...row.urls] : [] }
  }

  // Finds a vocab row index by word match
  // Input:
  //   vocabRows — object[]
  //   word — string
  // Output:
  //   number index, or -1.
  function findVocabRowIndex(vocabRows, word) {
    const k = normalizeForCompare(String(word || "").trim())
    if (!k) return -1
    return vocabRows.findIndex(
      (vw) =>
        vw &&
        typeof vw.word === "string" &&
        normalizeForCompare(vw.word.trim()) === k,
    )
  }

  // Drops later duplicates using normalizeForCompare keys while preserving first-seen order and surface spelling.
  // Input:
  //   segments — string[].
  // Output:
  //   string[], subset of segments with unique normalized keys.
  function dedupeSegmentsPreserveOrder(segments) {
    const seen = new Set()
    const out = []
    for (const s of segments) {
      const k = normalizeForCompare(s)
      if (!k) continue
      if (seen.has(k)) continue
      seen.add(k)
      out.push(s)
    }
    return out
  }

  // Parses `{"count":N}` from incremental merge replies; count must be an integer from 1 through maxSpan.
  // Input:
  //   raw — string, model body.
  //   maxSpan — number, upper bound for count (e.g. 3).
  // Output:
  //   integer count, or null when parsing fails or count is out of range.
  function extractMergeNextLeadCount(raw, maxSpan) {
    if (!raw || typeof raw !== "string") return null
    let s = raw.trim()
    const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(s)
    if (fence) s = fence[1].trim()
    // Parses a single JSON object and validates `count`; helper for extractMergeNextLeadCount.
    // Input:
    //   jsonStr — string.
    // Output:
    //   integer count or null when shape or range is invalid.
    const parseObj = (jsonStr) => {
      try {
        const o = JSON.parse(jsonStr)
        if (!o || typeof o !== "object" || Array.isArray(o)) return null
        const c = o.count
        if (typeof c !== "number" || !Number.isInteger(c)) return null
        if (c < 1 || c > maxSpan) return null
        return c
      } catch {
        return null
      }
    }
    let c = parseObj(s)
    if (c != null) return c
    const start = s.indexOf("{")
    const end = s.lastIndexOf("}")
    if (start >= 0 && end > start) c = parseObj(s.slice(start, end + 1))
    return c
  }

  // Parses a top-level JSON array of strings from model output; tolerates markdown fences and trailing junk outside the array.
  // Input:
  //   raw — string, raw model body.
  //   maxItems — number, max entries kept from the parsed array.
  // Output:
  //   string[] when at least one string parses; otherwise null.
  function extractJsonStringArray(raw, maxItems = DEFAULTS.maxItems) {
    if (!raw || typeof raw !== "string") return null
    let s = raw.trim()
    const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(s)
    if (fence) s = fence[1].trim()
    try {
      const parsed = JSON.parse(s)
      if (!Array.isArray(parsed)) return null
      const out = []
      for (const x of parsed) {
        if (typeof x !== "string") continue
        const item = x.trim()
        if (item) out.push(item)
      }
      return out.length ? out.slice(0, maxItems) : null
    } catch {
      const start = s.indexOf("[")
      const end = s.lastIndexOf("]")
      if (start < 0 || end <= start) return null
      try {
        const parsed = JSON.parse(s.slice(start, end + 1))
        if (!Array.isArray(parsed)) return null
        const out = []
        for (const x of parsed) {
          if (typeof x !== "string") continue
          const item = x.trim()
          if (item) out.push(item)
        }
        return out.length ? out.slice(0, maxItems) : null
      } catch {
        return null
      }
    }
  }

  // Constructs a new persisted vocabRow for a saved word or phrase.
  // Input:
  //   word — string, French surface form.
  //   pageUrl — string, URL of the page where the word was saved; empty string for none.
  //   baseTime — number, ms timestamp for the save session (Date.now() at session start).
  //   ordinal — number, 0-based index within the save session (used to order rows).
  //   saveSessionId — string or undefined, shared UUID for all rows from one segmented save.
  // Output:
  //   object, vocabRow with id, word, translation, translationPending, urls, savedAt, and optionally saveSessionId.
  function buildVocabRow(word, { pageUrl = "", baseTime, ordinal, saveSessionId } = {}) {
    return {
      id: crypto.randomUUID(),
      word: String(word || "").trim(),
      translation: "",
      translationPending: true,
      urls: pageUrl ? [pageUrl.trim()] : [],
      savedAt: baseTime + ordinal,
      ...(saveSessionId ? { saveSessionId } : {}),
    }
  }

  globalThis.LingoLeafSegmentUtils = {
    DEFAULTS,
    countWords,
    shouldSegmentSelection,
    normalizeForCompare,
    looksLikeUnsplittedSelection,
    extractWordFromToken,
    tokenizeSelectionToWords,
    materializeWordPartitionOrNull,
    dedupeSegmentsPreserveOrder,
    buildVocabRow,
    isDuplicatePageUrl,
    mergePageUrlIntoUrls,
    copyVocabRow,
    findVocabRowIndex,
    extractMergeNextLeadCount,
    extractJsonStringArray,
  }
})()
