;(() => {
  const BASE_URL = "http://127.0.0.1:11434"
  // Must match native Ollama model tags (see `OLLAMA_MODEL` in background.js); not OpenAI-style `provider/model` ids.
  const MODEL = "qwen2.5:3b"

  const prompts = globalThis.LingoLeafPrompts

  // POSTs one non-streaming `/api/chat` request to Ollama.
  // Input:
  //   baseUrl — string, e.g. `http://127.0.0.1:11434`.
  //   model — string.
  //   content — string, user message body.
  //   temperature — number.
  // Output:
  //   string, trimmed assistant text, or empty string on failure or missing content.
  async function ollamaChat({ content, temperature = 0.1, baseUrl = BASE_URL, model = MODEL }) {
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

  // Calls Ollama with the translate prompt for one saved vocabulary string.
  // Input:
  //   baseUrl — string.
  //   model — string.
  //   text — string, French phrase or word.
  //   maxChars — number, max length of text slice sent to the model.
  // Output:
  //   string, English gloss or empty string when input is blank or the request fails.
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
    ollamaChat,
    translateToEnglish,
  }
})()
