(() => {
  // Builds the Ollama user message that asks for a token partition into short learnable strings (validated later in code).
  // Params: 
  //  ~ words — string[]
  //  ~ French tokens in reading order
  //  ~ maxItems — max strings in the JSON array the model returns
  //  ~ maxSpan — max tokens joined per output string.
  // Returns: string, full prompt body including the serialized token list.
  function buildMergeConsecutiveWordsPrompt({ words, maxItems, maxSpan }) {
    const payload = JSON.stringify(words);
    return (
      "You help French learners by grouping adjacent words from a token list into short learnable strings.\n" +
      "Input: a JSON array of French tokens in reading order (punctuation already removed).\n" +
      "Output: a JSON array of strings ONLY.\n" +
      "Rules:\n" +
      "- Use every input token exactly once, in the same order, with no reordering and no omissions.\n" +
      "- Each output string is 1 to " +
      maxSpan +
      " tokens joined with a single ASCII space.\n" +
      "- Merge when it clearly helps learning: fixed expressions, verb + clitic (y/en), verb + à/de + infinitive, reflexive se + verb, article or determiner + noun when it is one nominal chunk, common preposition + tightly bound object.\n" +
      "- Otherwise keep a single token per output string.\n" +
      "- Copy surface forms from the input exactly (no lemmatization, no translation).\n" +
      "- At most " +
      maxItems +
      " output strings (if that is impossible while covering all tokens, merge more aggressively within the " +
      maxSpan +
      "-token cap).\n" +
      "- Reply with strict JSON only, e.g. [\"il\", \"se peut\", \"que\"].\n\n" +
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
    buildMergeConsecutiveWordsPrompt,
    buildTranslatePrompt
  };
})();
