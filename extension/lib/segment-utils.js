(() => {
  const DEFAULTS = {
    minWords: 4,
    maxChars: 1500,
    maxItems: 40,
    punctuationMinWords: 3
  };

  // Counts words separated by whitespace (after trim).
  // Params: text — string.
  // Returns: number, word count (0 for empty or whitespace-only).
  function countWords(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  // Decides whether the save flow should run the word-list merge pipeline vs saving the selection as one string.
  // Params: text — string, user selection; cfg — optional object with minWords, maxChars, maxItems, punctuationMinWords (defaults from DEFAULTS).
  // Returns: boolean.
  function shouldSegmentSelection(text, cfg = DEFAULTS) {
    const t = text.trim();
    if (!t) return false;
    if (t.length > cfg.maxChars) return true;
    if (/[,.!?;:]/.test(t) && countWords(t) >= cfg.punctuationMinWords) return true;
    return countWords(t) >= cfg.minWords;
  }

  // Lowercases, strips accents, replaces non letter/digit runs with spaces, collapses whitespace.
  // Params: text — string.
  // Returns: string, normalized form for comparisons (empty when input trims to nothing).
  function normalizeForCompare(text) {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // True when items are missing, a single chunk, or join to the same normalized text as the original (no useful split).
  // Params: original — string; items — string[] | null | undefined.
  // Returns: boolean.
  function looksLikeUnsplittedSelection(original, items) {
    if (!items || items.length <= 1) return true;
    const joined = normalizeForCompare(items.join(" "));
    const raw = normalizeForCompare(original);
    if (!joined || !raw) return true;
    return joined === raw;
  }

  // Extracts the first word-like substring, allowing internal apostrophe or hyphen for French compounds.
  // Params: token — string, one whitespace-delimited piece from the selection.
  // Returns: string, extracted word, or empty string when no letters/digits remain.
  function extractWordFromToken(token) {
    const m = String(token).match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/u);
    return m ? m[0] : "";
  }

  // Tokenizes the selection into a word array for the merge model (punctuation stripped per token).
  // Params: text — string, raw user selection.
  // Returns: string[], non-empty tokens in order (empty array when nothing tokenizes).
  function tokenizeSelectionToWords(text) {
    const t = text.trim();
    if (!t) return [];
    const out = [];
    for (const tok of t.split(/\s+/)) {
      const w = extractWordFromToken(tok);
      if (w) out.push(w);
    }
    return out;
  }

  // Validates model segments as a strict partition of `words` and rebuilds surface strings from the original tokens.
  // Params: words — string[]; modelSegments — string[] from the model; optional third arg `{ maxSpan }` caps words per output string (default 3).
  // Returns: string[] when the partition is valid; null on mismatch, reorder, skip, or span overflow.
  function materializeWordPartitionOrNull(words, modelSegments, { maxSpan = 3 } = {}) {
    if (!words || !words.length) return null;
    const segments = modelSegments.map((s) => String(s).trim()).filter(Boolean);
    if (!segments.length) return null;
    let i = 0;
    const out = [];
    for (const seg of segments) {
      const parts = seg.split(/\s+/).filter(Boolean);
      if (!parts.length) return null;
      const start = i;
      for (const p of parts) {
        if (i >= words.length) return null;
        if (normalizeForCompare(p) !== normalizeForCompare(words[i])) return null;
        i += 1;
      }
      const span = i - start;
      if (span > maxSpan) return null;
      out.push(words.slice(start, i).join(" "));
    }
    if (i !== words.length) return null;
    return out;
  }

  // Drops later duplicates using normalizeForCompare keys while preserving first-seen order and surface spelling.
  // Params: segments — string[].
  // Returns: string[], subset of segments with unique normalized keys.
  function dedupeSegmentsPreserveOrder(segments) {
    const seen = new Set();
    const out = [];
    for (const s of segments) {
      const k = normalizeForCompare(s);
      if (!k) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }

  // Parses a top-level JSON array of strings from model output; tolerates markdown fences and trailing junk outside the array.
  // Params: raw — string, raw model body; maxItems — max entries kept from the parsed array.
  // Returns: string[] when at least one string parses; otherwise null.
  function extractJsonStringArray(raw, maxItems = DEFAULTS.maxItems) {
    if (!raw || typeof raw !== "string") return null;
    let s = raw.trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(s);
    if (fence) s = fence[1].trim();
    try {
      const parsed = JSON.parse(s);
      if (!Array.isArray(parsed)) return null;
      const out = [];
      for (const x of parsed) {
        if (typeof x !== "string") continue;
        const item = x.trim();
        if (item) out.push(item);
      }
      return out.length ? out.slice(0, maxItems) : null;
    } catch {
      const start = s.indexOf("[");
      const end = s.lastIndexOf("]");
      if (start < 0 || end <= start) return null;
      try {
        const parsed = JSON.parse(s.slice(start, end + 1));
        if (!Array.isArray(parsed)) return null;
        const out = [];
        for (const x of parsed) {
          if (typeof x !== "string") continue;
          const item = x.trim();
          if (item) out.push(item);
        }
        return out.length ? out.slice(0, maxItems) : null;
      } catch {
        return null;
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
    extractJsonStringArray
  };
})();
