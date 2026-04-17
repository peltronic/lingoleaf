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

  // Reads source URLs from a saved row; supports legacy single `url` string or `urls` array.
  // Input:
  //   entry — object from storage (may be legacy shape).
  // Output:
  //   string[], trimmed http(s) URLs in stored order, deduped.
  function urlsFromEntry(entry) {
    if (!entry || typeof entry !== "object") return []
    if (Array.isArray(entry.urls)) {
      const out = []
      const seen = new Set()
      for (const u of entry.urls) {
        if (typeof u !== "string") continue
        const t = u.trim()
        if (!t || seen.has(t)) continue
        seen.add(t)
        out.push(t)
      }
      if (out.length) return out
    }
    if (typeof entry.url === "string" && entry.url.trim())
      return [entry.url.trim()]
    return []
  }

  // Builds the next `urls` array for an existing row when the learner saves the same phrase from another page (caller writes the row back).
  // Input:
  //   urls — string[].
  //   pageUrl — string (may be empty).
  // Output:
  //   string[], new array (never mutates `urls`).
  function mergePageUrlIntoUrls(urls, pageUrl) {
    const base = Array.isArray(urls) ? urlsFromEntry({ urls }) : []
    if (!pageUrl || typeof pageUrl !== "string" || !pageUrl.trim()) return base
    const u = pageUrl.trim()
    if (base.includes(u)) return base.slice()
    return [...base, u]
  }

  // Normalizes a stored row to `{ …, urls }` and drops legacy `url` so new writes stay consistent.
  // Input:
  //   entry — object from storage.
  // Output:
  //   object, same row with `urls` array and without `url`.
  function normalizeEntryUrls(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return entry
    const urls = urlsFromEntry(entry)
    const { url, ...rest } = entry
    return { ...rest, urls }
  }

  // Finds a row index for save-time upsert: same normalized French as `word` means merge `urls`, not append a duplicate row.
  // Input:
  //   entries — object[].
  //   word — string.
  // Output:
  //   number index, or -1.
  function findEntryIndexByNormalizedWord(entries, word) {
    const k = normalizeForCompare(String(word || "").trim())
    if (!k) return -1
    return entries.findIndex(
      (e) =>
        e &&
        typeof e.word === "string" &&
        normalizeForCompare(e.word.trim()) === k,
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
    urlsFromEntry,
    mergePageUrlIntoUrls,
    normalizeEntryUrls,
    findEntryIndexByNormalizedWord,
    extractMergeNextLeadCount,
    extractJsonStringArray,
  }
})()
