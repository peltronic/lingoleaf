importScripts(
  "lib/segment-utils.js",
  "lib/prompts.js",
  "lib/ollama-api.js",
  "lib/segmentation-pipeline.js"
);

const MENU_ID = "save-to-lingoleaf";
const ACTION_MENU_USE_POPUP = "lingoleaf-use-popup-toolbar";
const STORAGE_KEY = "lingoleafSaved";
const SEGMENTING_KEY = "lingoleafSegmenting";
const PANEL_MODE_KEY = "lingoleafPanelMode";

const OLLAMA_BASE = "http://127.0.0.1:11434";
const OLLAMA_MODEL = "qwen2.5:3b";

const SEGMENT_CONFIG = {
  minWords: 4,
  maxChars: 1500,
  maxItems: 40,
  punctuationMinWords: 3
};
const TRANSLATE_MAX_CHARS = 2000;

const segmentUtils = globalThis.LingoLeafSegmentUtils;
const ollamaApi = globalThis.LingoLeafOllamaApi;
const segmentationPipeline = globalThis.LingoLeafSegmentationPipeline;

// Serializes menu rebuilds so concurrent removeAll/create races cannot duplicate ids.
let contextMenuChain = Promise.resolve();

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
                contexts: ["selection"]
              },
              () => {
                chrome.contextMenus.create(
                  {
                    id: ACTION_MENU_USE_POPUP,
                    title: "Use popup for toolbar icon",
                    contexts: ["action"]
                  },
                  () => resolve()
                );
              }
            );
          });
        })
    )
    .catch(() => {});
}

// Applies popup vs side panel behavior; used on startup and when UI mode is toggled.
async function applyPanelMode(mode) {
  const useSidePanel = mode === "sidepanel";
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: useSidePanel });
  } catch {
    /* ignore if API unavailable */
  }
  if (useSidePanel) {
    await chrome.action.setPopup({ popup: "" });
  } else {
    await chrome.action.setPopup({ popup: "popup.html" });
  }
}

// Restores persisted panel mode from local storage; needed so toolbar behavior survives browser restarts.
async function initPanelMode() {
  const { [PANEL_MODE_KEY]: stored } = await chrome.storage.local.get(PANEL_MODE_KEY);
  const mode = stored === "sidepanel" ? "sidepanel" : "popup";
  await applyPanelMode(mode);
}

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenu();
  initPanelMode();
});
chrome.runtime.onStartup.addListener(() => {
  registerContextMenu();
  initPanelMode();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "set-panel-mode") {
    (async () => {
      const mode = message.mode === "sidepanel" ? "sidepanel" : "popup";
      await chrome.storage.local.set({ [PANEL_MODE_KEY]: mode });
      await applyPanelMode(mode);
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (!message || message.type !== "backfill-missing-translations") return;

  // Backfills missing translations in saved entries; triggered by popup/sidepanel "Fill missing" button.
  (async () => {
    const { [STORAGE_KEY]: existing = [] } = await chrome.storage.local.get(STORAGE_KEY);
    const updated = [];
    let filledCount = 0;

    for (const item of existing) {
      if (item && item.word && !item.translation) {
        let translation = "";
        try {
          translation = await ollamaApi.translateToEnglish({
            baseUrl: OLLAMA_BASE,
            model: OLLAMA_MODEL,
            text: item.word,
            maxChars: TRANSLATE_MAX_CHARS
          });
        } catch {
          translation = "";
        }
        if (translation) filledCount += 1;
        updated.push({ ...item, translation, translationPending: false });
      } else {
        updated.push(item);
      }
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: updated });
    sendResponse({ ok: true, filledCount });
  })().catch(() => sendResponse({ ok: false, filledCount: 0 }));

  return true;
});

// Writes each row’s English gloss by id; one Ollama request per row (not batched). Runs after the list is saved so the UI can show French first.
async function translateSavedEntriesInBackground(entries) {
  for (const entry of entries) {
    if (!entry || !entry.id || !entry.word) continue;
    let translation = "";
    try {
      translation = await ollamaApi.translateToEnglish({
        baseUrl: OLLAMA_BASE,
        model: OLLAMA_MODEL,
        text: entry.word,
        maxChars: TRANSLATE_MAX_CHARS
      });
    } catch {
      translation = "";
    }
    const { [STORAGE_KEY]: list = [] } = await chrome.storage.local.get(STORAGE_KEY);
    const idx = list.findIndex((e) => e && e.id === entry.id);
    if (idx < 0) continue;
    const copy = [...list];
    copy[idx] = { ...copy[idx], translation, translationPending: false };
    await chrome.storage.local.set({ [STORAGE_KEY]: copy });
  }
}

// Handles context menu saves: optional segmentation, prepend rows with pending translations, then translate each row in the background.
chrome.contextMenus.onClicked.addListener((info) => {
  void (async () => {
    if (info.menuItemId === ACTION_MENU_USE_POPUP) {
      await chrome.storage.local.set({ [PANEL_MODE_KEY]: "popup" });
      await applyPanelMode("popup");
      return;
    }

    if (info.menuItemId !== MENU_ID) return;

    const rawSelection = (info.selectionText || "").trim();
    const pageUrl = info.pageUrl || "";
    if (!rawSelection) return;

    const { [STORAGE_KEY]: existing = [] } = await chrome.storage.local.get(STORAGE_KEY);
    const baseTime = Date.now();

    const buildEntry = (word, idx, saveSessionId) => ({
      id: crypto.randomUUID(),
      word,
      translation: "",
      translationPending: true,
      url: pageUrl,
      savedAt: baseTime + idx,
      ...(saveSessionId ? { saveSessionId } : {})
    });

    if (segmentUtils.shouldSegmentSelection(rawSelection, SEGMENT_CONFIG)) {
      const saveSessionId = crypto.randomUUID();
      const accumulated = [];
      const persistSessionBatch = async () => {
        const { [STORAGE_KEY]: list = [] } = await chrome.storage.local.get(STORAGE_KEY);
        const rest = list.filter((e) => !e.saveSessionId || e.saveSessionId !== saveSessionId);
        await chrome.storage.local.set({
          [STORAGE_KEY]: [...accumulated, ...rest]
        });
      };

      await chrome.storage.local.set({ [SEGMENTING_KEY]: { active: true } });
      try {
        let idx = 0;
        for await (const word of segmentationPipeline.streamLexicalPieces(rawSelection, {
          baseUrl: OLLAMA_BASE,
          model: OLLAMA_MODEL,
          segmentCfg: SEGMENT_CONFIG
        })) {
          accumulated.push(buildEntry(word, idx, saveSessionId));
          idx += 1;
          await persistSessionBatch();
          if (accumulated.length === 1) {
            await chrome.storage.local.remove(SEGMENTING_KEY);
          }
        }
        void translateSavedEntriesInBackground(accumulated).catch(() => {});
        return;
      } catch {
        const { [STORAGE_KEY]: list = [] } = await chrome.storage.local.get(STORAGE_KEY);
        const rest = list.filter((e) => !e.saveSessionId || e.saveSessionId !== saveSessionId);
        if (accumulated.length) {
          await chrome.storage.local.set({
            [STORAGE_KEY]: [...accumulated, ...rest]
          });
          void translateSavedEntriesInBackground(accumulated).catch(() => {});
        } else {
          const fb = buildEntry(rawSelection, 0, saveSessionId);
          await chrome.storage.local.set({
            [STORAGE_KEY]: [fb, ...rest]
          });
          void translateSavedEntriesInBackground([fb]).catch(() => {});
        }
        return;
      } finally {
        await chrome.storage.local.remove(SEGMENTING_KEY).catch(() => {});
      }
    }

    const newEntries = [buildEntry(rawSelection, 0)];

    await chrome.storage.local.set({
      [STORAGE_KEY]: [...newEntries, ...existing]
    });

    void translateSavedEntriesInBackground(newEntries).catch(() => {});
  })().catch(() => {});
});
