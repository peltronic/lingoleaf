(() => {
  const segmentUtils = globalThis.LingoLeafSegmentUtils;
  const ollamaApi = globalThis.LingoLeafOllamaApi;

  const MERGE_MAX_SPAN = 3;

  // Caps the token list by count and by approximate JSON length so the merge prompt fits in maxChars.
  // Params: words — string[]; maxItems — number from segment config; maxChars — number, max JSON length for the clipped array.
  // Returns: string[], prefix of words (possibly shortened until JSON fits).
  function clipWordsForMerge(words, maxItems, maxChars) {
    const spanCap = maxItems * MERGE_MAX_SPAN;
    let clipped = words.length > spanCap ? words.slice(0, spanCap) : words.slice();
    while (clipped.length > 1 && JSON.stringify(clipped).length > maxChars) {
      clipped = clipped.slice(0, clipped.length - 1);
    }
    return clipped;
  }

  // Concatenates tokens after the merge prefix as individual pieces so nothing after the clipped head is lost.
  // Params: headWords — string[], tokens sent to the model; mergedPieces — string[], merge output for the head; allWords — string[], full tokenization.
  // Returns: string[], mergedPieces plus one string per tail token when head is shorter than allWords.
  function appendTailSingles(headWords, mergedPieces, allWords) {
    if (headWords.length >= allWords.length) return mergedPieces;
    const tail = allWords.slice(headWords.length);
    return mergedPieces.concat(tail);
  }

  // Tokenizes, merges via Ollama, materializes or falls back to single tokens, appends tail, dedupes; background then translates each piece.
  // Params: rawSelection — string; second arg — `{ baseUrl, model, segmentCfg }` where segmentCfg has maxItems and maxChars (and other segment-utils thresholds if extended).
  // Returns: string[], vocabulary pieces (falls back to `[rawSelection]` when tokenization yields nothing after dedupe).
  async function getLexicalPieces(rawSelection, { baseUrl, model, segmentCfg }) {
    const allWords = segmentUtils.tokenizeSelectionToWords(rawSelection);
    if (!allWords.length) return [rawSelection];
    if (allWords.length === 1) return [allWords[0]];

    const headWords = clipWordsForMerge(allWords, segmentCfg.maxItems, segmentCfg.maxChars);
    let modelSegments = null;
    try {
      modelSegments = await ollamaApi.mergeConsecutiveWordGroups({
        baseUrl,
        model,
        words: headWords,
        maxItems: segmentCfg.maxItems,
        maxSpan: MERGE_MAX_SPAN
      });
    } catch {
      modelSegments = null;
    }

    let pieces = segmentUtils.materializeWordPartitionOrNull(headWords, modelSegments || [], {
      maxSpan: MERGE_MAX_SPAN
    });
    if (!pieces || !pieces.length) {
      pieces = headWords.slice();
    }

    pieces = appendTailSingles(headWords, pieces, allWords);
    pieces = segmentUtils.dedupeSegmentsPreserveOrder(pieces);
    if (!pieces.length) return [rawSelection];
    return pieces;
  }

  globalThis.LingoLeafSegmentationPipeline = {
    getLexicalPieces
  };
})();
