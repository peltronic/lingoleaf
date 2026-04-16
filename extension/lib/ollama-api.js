(() => {
  const prompts = globalThis.LingoLeafPrompts;
  const segmentUtils = globalThis.LingoLeafSegmentUtils;

  // Sends a single non-streaming chat request to Ollama; shared by segmentation and translation calls.
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

  // Requests lexical segmentation from the model and parses the response into clean string items for storage.
  async function segmentIntoLexicalItems({
    baseUrl,
    model,
    text,
    maxChars,
    maxItems,
    forceMultiple = false
  }) {
    const slice = text.length > maxChars ? text.slice(0, maxChars) : text;
    const content = await ollamaChat({
      baseUrl,
      model,
      content: prompts.buildSegmentPrompt({
        text: slice,
        maxItems,
        forceMultiple
      }),
      temperature: 0.1
    });
    return segmentUtils.extractJsonStringArray(content, maxItems);
  }

  // Translates one item to English; used in save flow and backfill flow for consistent glossing.
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
    segmentIntoLexicalItems,
    translateToEnglish
  };
})();
