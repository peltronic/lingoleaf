(() => {
  // Builds the Ollama user message for one merge decision at the start of a token window (incremental merge).
  // Params: words — string[], lookahead slice whose first element is the only merge anchor; maxSpan — max tokens the model may return in count.
  // Returns: string, full prompt body including the serialized token list.
  function buildMergeNextSegmentPrompt({ words, maxSpan }) {
    const payload = JSON.stringify(words);
    return (
      "You help French learners group adjacent French tokens. The JSON array is only the NEXT tokens in a sentence.\n" +
      "You must decide how many LEADING tokens (from index 0) form the next single learnable chunk.\n" +
      "Return JSON ONLY in this exact shape: {\"count\": N}\n" +
      "- N is an integer: 1, 2, or up to " +
      maxSpan +
      " (never more than " +
      maxSpan +
      " and never more than the array length).\n" +
      "- Use N>1 when those leading tokens are one unit: fixed expression, verb+clitic, verb+à/de+infinitive, reflexive se+verb, article/determiner+noun chunk, preposition+tight object, etc.\n" +
      "- Otherwise N must be 1.\n" +
      "- Do not reorder tokens; count always starts from the first array element.\n" +
      "- Reply with strict JSON only, e.g. {\"count\": 2}.\n\n" +
      "Tokens:\n" +
      payload
    );
  }

  // Builds the Ollama user message for a single French gloss into English.
  // Params: text — string, phrase or word to translate (already trimmed upstream when needed).
  // Returns: string, full prompt body.
  function buildTranslatePrompt({ text }) {
    return (
      "Translate the following text into English. Reply with only the English translation, with no quotes or explanation.\n\n" +
      text
    );
  }

  globalThis.LingoLeafPrompts = {
    buildMergeNextSegmentPrompt,
    buildTranslatePrompt
  };
})();
