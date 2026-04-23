;(() => {
  const segmentUtils = globalThis.LingoLeafSegmentUtils
  const ollamaApi = globalThis.LingoLeafOllamaApi

  // Normalizes saved rows and fills only entries that are missing English translations.
  // Input:
  //   existing — array, saved storage entries (may contain invalid items).
  //   opts — object `{ baseUrl, model, maxChars }` for translation requests.
  // Output:
  //   Promise<{ updated: object[], filledCount: number }>, normalized entries plus count of newly filled translations.
  async function fillMissingTranslations(existing, { baseUrl, model, maxChars }) {
    const updated = []
    let filledCount = 0

    for (const item of existing) {
      if (!item || typeof item !== "object") continue
      const row = segmentUtils.normalizeEntryUrls(item)
      if (row && row.word && !row.translation) {
        let translation = ""
        try {
          translation = await ollamaApi.translateToEnglish({
            baseUrl,
            model,
            text: row.word,
            maxChars,
          })
        } catch {
          translation = ""
        }
        if (translation) filledCount += 1
        updated.push({ ...row, translation, translationPending: false })
      } else {
        updated.push(row)
      }
    }

    return { updated, filledCount }
  }

  globalThis.LingoLeafTranslationPipeline = {
    fillMissingTranslations,
  }
})()
