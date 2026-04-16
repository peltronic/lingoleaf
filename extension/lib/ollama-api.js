(() => {
  const prompts = globalThis.LingoLeafPrompts;
  const segmentUtils = globalThis.LingoLeafSegmentUtils;

  // POSTs one non-streaming `/api/chat` request to Ollama.
  // Params: baseUrl — string, e.g. `http://127.0.0.1:11434`; model — string; content — user message string; temperature — number.
  // Returns: string, trimmed assistant text, or empty string on failure or missing content.
  async function ollamaChat({ baseUrl, model, content, temperature }) {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        stream: false,
        options: { temperature }
      })
    });

    if (!res.ok) return "";
    const data = await res.json();
    return data && data.message && typeof data.message.content === "string"
      ? data.message.content.trim()
      : "";
  }

  // Calls Ollama with the merge prompt and parses a JSON string array from the reply.
  // Params: baseUrl, model — strings; words — string[] sent to the prompt; maxItems — cap on parsed array length; maxSpan — passed through to the prompt (max tokens per merged string).
  // Returns: string[] | null, parsed merge groups, or null when JSON parsing fails.
  async function mergeConsecutiveWordGroups({ baseUrl, model, words, maxItems, maxSpan }) {
    const content = await ollamaChat({
      baseUrl,
      model,
      content: prompts.buildMergeConsecutiveWordsPrompt({
        words,
        maxItems,
        maxSpan
      }),
      temperature: 0.1
    });
    return segmentUtils.extractJsonStringArray(content, maxItems);
  }

  // Calls Ollama with the translate prompt for one saved vocabulary string.
  // Params: baseUrl, model — strings; text — French string; maxChars — max length of text slice sent to the model.
  // Returns: string, English gloss or empty string when input is blank or the request fails.
  async function translateToEnglish({ baseUrl, model, text, maxChars }) {
    const q = text.trim();
    if (!q) return "";
    const slice = q.length > maxChars ? q.slice(0, maxChars) : q;
    return ollamaChat({
      baseUrl,
      model,
      content: prompts.buildTranslatePrompt({ text: slice }),
      temperature: 0.2
    });
  }

  globalThis.LingoLeafOllamaApi = {
    mergeConsecutiveWordGroups,
    translateToEnglish
  };
})();
