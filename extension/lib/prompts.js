(() => {
  // Builds the segmentation prompt; used by the Ollama API wrapper to request chunked vocabulary items.
  function buildSegmentPrompt({ text, maxItems, forceMultiple }) {
    return (
      "You help French learners build vocabulary from real sentences. Return a JSON array of strings ONLY.\n" +
      "Goal: keep useful multi-word chunks whenever they represent one learnable unit.\n" +
      "- Keep idioms, fixed expressions, preposition+verb chunks, and common collocations together.\n" +
      "- Prefer phrase chunks of 2-5 words when meaningful (not only isolated words).\n" +
      "- Still include important standalone content words when needed.\n" +
      "- No duplicates. Preserve left-to-right order. Max " +
      maxItems +
      " items.\n" +
      "- Exclude punctuation-only tokens and obvious stopword-only fragments.\n" +
      (forceMultiple
        ? "- IMPORTANT: do NOT return the whole sentence as one item. Return at least 2 items.\n"
        : "") +
      '- Reply with strict JSON only, e.g. ["en train de", "prendre son temps", "rapidement"].\n\n' +
      "French text:\n" +
      text
    );
  }

  // Builds the translation prompt; used for per-item English gloss generation.
  function buildTranslatePrompt({ text }) {
    return (
      "Translate the following text into English. Reply with only the English translation, with no quotes or explanation.\n\n" +
      text
    );
  }

  globalThis.LingoLeafPrompts = {
    buildSegmentPrompt,
    buildTranslatePrompt
  };
})();
