// Libs are plain scripts (no bundler): `importScripts` runs each file in this service worker's shared global scope.
// Each `lib/*.js` registers APIs on `globalThis` (e.g. `LingoLeafSegmentUtils`); we read them below—same pattern Node tests use when they `require` those files.
importScripts(
  "lib/segment-utils.js",
  "lib/prompts.js",
  "lib/ollama-api.js",
  "lib/translation-pipeline.js",
  "lib/segmentation-pipeline.js",
)

const MENU_ID = "save-to-lingoleaf"
const ACTION_MENU_USE_POPUP = "lingoleaf-use-popup-toolbar"
const VOCABLIST_KEY = "lingoleafSaved"
const SEGMENTING_KEY = "lingoleafSegmenting"
const PANEL_MODE_KEY = "lingoleafPanelMode"

const OLLAMA_BASE = "http://127.0.0.1:11434"
const OLLAMA_MODEL = "qwen2.5:3b"

const SEGMENT_CONFIG = {
  minWords: 4,
  maxChars: 1500,
  maxItems: 40,
  punctuationMinWords: 3,
}
const TRANSLATE_MAX_CHARS = 2000

const segmentUtils = globalThis.LingoLeafSegmentUtils
const ollamaApi = globalThis.LingoLeafOllamaApi
const translationPipeline = globalThis.LingoLeafTranslationPipeline
const segmentationPipeline = globalThis.LingoLeafSegmentationPipeline

// Serializes menu rebuilds so concurrent removeAll/create races cannot duplicate ids.
let contextMenuChain = Promise.resolve()

// Rebuilds extension context menus safely; used at install/startup to keep ids consistent across reloads.
function registerContextMenu() {
  contextMenuChain = contextMenuChain
    .then(
      () =>
        new Promise((resolve) => {
          chrome.contextMenus.removeAll(() => {
            chrome.contextMenus.create(
              {
                id: MENU_ID,
                title: "Save to LingoLeaf",
                contexts: ["selection"],
              },
              () => {
                chrome.contextMenus.create(
                  {
                    id: ACTION_MENU_USE_POPUP,
                    title: "Use popup for toolbar icon",
                    contexts: ["action"],
                  },
                  () => resolve(),
                )
              },
            )
          })
        }),
    )
    .catch(() => {})
}

// Applies popup vs side panel behavior; used on startup and when UI mode is toggled.
async function applyPanelMode(mode) {
  const useSidePanel = mode === "sidepanel"
  try {
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: useSidePanel,
    })
  } catch {
    /* ignore if API unavailable */
  }
  if (useSidePanel) {
    await chrome.action.setPopup({ popup: "" })
  } else {
    await chrome.action.setPopup({ popup: "popup.html" })
  }
}

// Restores persisted panel mode from local storage; needed so toolbar behavior survives browser restarts.
async function initPanelMode() {
  const { [PANEL_MODE_KEY]: stored } =
    await chrome.storage.local.get(PANEL_MODE_KEY)
  const mode = stored === "sidepanel" ? "sidepanel" : "popup"
  await applyPanelMode(mode)
}

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenu()
  initPanelMode()
})
chrome.runtime.onStartup.addListener(() => {
  registerContextMenu()
  initPanelMode()
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return

  switch (message.type) {
    case "set-panel-mode":
      ;(async () => {
        const mode = message.mode === "sidepanel" ? "sidepanel" : "popup"
        await chrome.storage.local.set({ [PANEL_MODE_KEY]: mode })
        await applyPanelMode(mode)
        sendResponse({ ok: true })
      })().catch(() => sendResponse({ ok: false }))
      return true

    // Backfills missing translations in saved entries; triggered by popup/sidepanel "Fill missing" button.
    case "backfill-missing-translations":
      ;(async () => {
        const { [VOCABLIST_KEY]: existing = [] } = await chrome.storage.local.get(VOCABLIST_KEY)
        const { updated, filledCount } =
          await translationPipeline.fillMissingTranslations(existing, {
            baseUrl: OLLAMA_BASE,
            model: OLLAMA_MODEL,
            maxChars: TRANSLATE_MAX_CHARS,
          })
        await chrome.storage.local.set({ [VOCABLIST_KEY]: updated })
        sendResponse({ ok: true, filledCount })
      })().catch(() => sendResponse({ ok: false, filledCount: 0 }))
      return true

    default:
      return
  }
})

// Writes each row’s English gloss by id; one Ollama request per row (not batched). 
// Runs after the list is saved so the UI can show French first.
async function setTranslations(vocabRows) {
  for (const vr of vocabRows) {
    if (!vr || !vr.id || !vr.word) continue
    let translation = ""
    try {
      translation = await ollamaApi.translateToEnglish({
        baseUrl: OLLAMA_BASE,
        model: OLLAMA_MODEL,
        text: vr.word,
        maxChars: TRANSLATE_MAX_CHARS,
      })
    } catch {
      translation = ""
    }
    const { [VOCABLIST_KEY]: list = [] } = await chrome.storage.local.get(VOCABLIST_KEY)
    const idx = list.findIndex((e) => e && e.id === vr.id)
    if (idx < 0) continue
    const copy = [...list]
    copy[idx] = {
      ...copy[idx],
      translation,
      translationPending: false,
    }
    await chrome.storage.local.set({ [VOCABLIST_KEY]: copy })
  }
}

// Handles context menu saves: optional segmentation, prepend rows with pending translations, then translate each row in the background.
chrome.contextMenus.onClicked.addListener((info) => {
  // %HERE 0423
  void (async () => {
    if (info.menuItemId === ACTION_MENU_USE_POPUP) {
      await chrome.storage.local.set({ [PANEL_MODE_KEY]: "popup" })
      await applyPanelMode("popup")
      return
    }

    if (info.menuItemId !== MENU_ID) return

    const rawSelection = (info.selectionText || "").trim()
    if (!rawSelection) return

    const pageUrl = info.pageUrl || ""

    const { [VOCABLIST_KEY]: existing = [] } =
      await chrome.storage.local.get(VOCABLIST_KEY)
    const baseTime = Date.now()

    const shouldSegmentSelection = segmentUtils.shouldSegmentSelection(rawSelection, SEGMENT_CONFIG)
    console.log('HERE.A')

    // Same normalized French as an existing row → only append `pageUrl` to that row’s `urls`; otherwise a new list item (no post-pass merge).
    if (shouldSegmentSelection) {
      const saveSessionId = crypto.randomUUID()
      const accumulated = []
      let newOrdinal = 0
      let clearedSegmentingBanner = false
      console.log('HERE.B')

      // indicate that we are segmenting the selection
      await chrome.storage.local.set({ [SEGMENTING_KEY]: { active: true } })

      try {
        for await (const word of segmentationPipeline.streamLexicalPieces(
          rawSelection,
          {
            baseUrl: OLLAMA_BASE,
            model: OLLAMA_MODEL,
            segmentCfg: SEGMENT_CONFIG,
          },
        )) {
          console.log('HERE.C')
          // Retrieve the full list of saved words
          const { [VOCABLIST_KEY]: currentVocablistRaw = [] } = await chrome.storage.local.get(VOCABLIST_KEY)

          // filter out any rows that are part of the current save session; then shallow-copy so we can mutate without aliasing storage
          const currentVocablist = currentVocablistRaw.filter(
            (e) => !e.saveSessionId || e.saveSessionId !== saveSessionId,
          ).map((e) => segmentUtils.copyVocabRow(e))

          const normalizedAccumulated = accumulated.map((e) => segmentUtils.copyVocabRow(e))

          const wi = segmentUtils.findEntryIndexByNormalizedWord(normalizedAccumulated, word)
          if (wi >= 0) {
            normalizedAccumulated[wi] = {
              ...normalizedAccumulated[wi],
              urls: segmentUtils.mergePageUrlIntoUrls(
                normalizedAccumulated[wi].urls || [],
                pageUrl,
              ),
            }
            accumulated.length = 0
            accumulated.push(...normalizedAccumulated)
          } else {
            const ri = segmentUtils.findEntryIndexByNormalizedWord(currentVocablist, word)
            if (ri >= 0) {
              currentVocablist[ri] = {
                ...currentVocablist[ri],
                urls: segmentUtils.mergePageUrlIntoUrls(
                  currentVocablist[ri].urls || [],
                  pageUrl,
                ),
              }
              accumulated.length = 0
              accumulated.push(...normalizedAccumulated)
            } else {
              normalizedAccumulated.push(segmentUtils.buildVocabRow(word, { pageUrl, baseTime, ordinal: newOrdinal, saveSessionId }))
              newOrdinal += 1
              accumulated.length = 0
              accumulated.push(...normalizedAccumulated)
            }
          }

          await chrome.storage.local.set({ [VOCABLIST_KEY]: [...accumulated, ...currentVocablist] })
          if (!clearedSegmentingBanner) {
            await chrome.storage.local.remove(SEGMENTING_KEY)
            clearedSegmentingBanner = true
          }
        }
        void setTranslations(accumulated).catch(() => {})
        return

      } catch {

        // TL;DR: merge/stream or storage failed — keep any rows already built, else save the whole selection as one card; always re-merge list without dup session rows.
        const { [VOCABLIST_KEY]: list = [] } =
          await chrome.storage.local.get(VOCABLIST_KEY)
        const rest = list
          .map((e) => segmentUtils.copyVocabRow(e))
          .filter((e) => !e.saveSessionId || e.saveSessionId !== saveSessionId)
        if (accumulated.length) {
          const vocablist = accumulated.map((e) => segmentUtils.copyVocabRow(e))
          await chrome.storage.local.set({
            [VOCABLIST_KEY]: [...vocablist, ...rest],
          })
          void setTranslations(vocablist).catch(() => {})
        } else {
          const fb = segmentUtils.buildVocabRow(rawSelection, { pageUrl, baseTime, ordinal: 0, saveSessionId })
          await chrome.storage.local.set({
            [VOCABLIST_KEY]: [fb, ...rest],
          })
          void setTranslations([fb]).catch(() => {})
        }
        return
      } finally {
        await chrome.storage.local.remove(SEGMENTING_KEY).catch(() => {})
      }
    }

    const normalizedExisting = existing.map((e) => segmentUtils.copyVocabRow(e))

    const dupIdx = segmentUtils.findEntryIndexByNormalizedWord(
      normalizedExisting,
      rawSelection,
    )
    // Short selection: merge URL onto the matching row, or prepend one new row (same upsert idea as the segmented loop).
    if (dupIdx >= 0) {
      const copy = [...normalizedExisting]
      copy[dupIdx] = {
        ...copy[dupIdx],
        urls: segmentUtils.mergePageUrlIntoUrls(
          copy[dupIdx].urls || [],
          pageUrl,
        ),
      }
      await chrome.storage.local.set({ [VOCABLIST_KEY]: copy })
      return
    }

    const vocabRow = segmentUtils.buildVocabRow(rawSelection, { pageUrl, baseTime, ordinal: 0 })
    await chrome.storage.local.set({
      [VOCABLIST_KEY]: [vocabRow, ...normalizedExisting],
    })

    void setTranslations([vocabRow]).catch(() => {})
  })().catch(() => {})
})
