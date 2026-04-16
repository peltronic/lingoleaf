(() => {
  const DEFAULTS = {
    minWords: 4,
    maxChars: 1500,
    maxItems: 40,
    punctuationMinWords: 3
  };

  // Counts whitespace-delimited words; used by segmentation heuristics to decide when splitting is worth doing.
  function countWords(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  // Decides if a selection should be segmented; called by background flow to avoid unnecessary LLM split calls.
  function shouldSegmentSelection(text, cfg = DEFAULTS) {
    const t = text.trim();
    if (!t) return false;
    if (t.length > cfg.maxChars) return true;
    if (/[,.!?;:]/.test(t) && countWords(t) >= cfg.punctuationMinWords) return true;
    return countWords(t) >= cfg.minWords;
  }

  // Normalizes text for loose equality checks; needed to detect when segmentation output is effectively unchanged.
  function normalizeForCompare(text) {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Detects no-op segmentation results; used to trigger the stricter second segmentation pass.
  function looksLikeUnsplittedSelection(original, items) {
    if (!items || items.length <= 1) return true;
    const joined = normalizeForCompare(items.join(" "));
    const raw = normalizeForCompare(original);
    if (!joined || !raw) return true;
    return joined === raw;
  }

  // Parses LLM output into a bounded string array; used by API layer to recover JSON even with minor formatting noise.
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
    extractJsonStringArray
  };
})();
