;(() => {
  const prompts = globalThis.LingoLeafPrompts
  const segmentUtils = globalThis.LingoLeafSegmentUtils

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
        options: { temperature },
      }),
    })

    if (!res.ok) return ""
    const data = await res.json()
    return data && data.message && typeof data.message.content === "string"
      ? data.message.content.trim()
      : ""
  }

  // Asks how many leading tokens in `words` to merge next; used once per segment in the streaming merge pipeline.
  // Params: baseUrl, model — strings; words — non-empty string[] (lookahead window); maxSpan — cap for returned count (e.g. 3).
  // Returns: integer from 1 to min(maxSpan, words.length); defaults to 1 when the model output does not parse.
  async function mergeNextSegmentLead({ baseUrl, model, words, maxSpan }) {
    if (!words || !words.length) return 1
    const content = await ollamaChat({
      baseUrl,
      model,
      content: prompts.buildMergeNextSegmentPrompt({ words, maxSpan }),
      temperature: 0.1,
    })
    const parsed = segmentUtils.extractMergeNextLeadCount(content, maxSpan)
    const cap = Math.min(maxSpan, words.length)
    if (parsed == null) return 1
    return Math.min(Math.max(1, parsed), cap)
  }

  // Calls Ollama with the translate prompt for one saved vocabulary string.
  // Params: baseUrl, model — strings; text — French string; maxChars — max length of text slice sent to the model.
  // Returns: string, English gloss or empty string when input is blank or the request fails.
  async function translateToEnglish({ baseUrl, model, text, maxChars }) {
    const q = text.trim()
    if (!q) return ""
    const slice = q.length > maxChars ? q.slice(0, maxChars) : q
    return ollamaChat({
      baseUrl,
      model,
      content: prompts.buildTranslatePrompt({ text: slice }),
      temperature: 0.2,
    })
  }

  globalThis.LingoLeafOllamaApi = {
    mergeNextSegmentLead,
    translateToEnglish,
  }
})()
