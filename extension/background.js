importScripts("lib/segment-utils.js", "lib/prompts.js", "lib/ollama-api.js");

const MENU_ID = "save-to-lingoleaf";
const ACTION_MENU_USE_POPUP = "lingoleaf-use-popup-toolbar";
const STORAGE_KEY = "lingoleafSaved";
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

/** Serializes menu rebuilds so concurrent removeAll/create races cannot duplicate ids. */
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
        updated.push({ ...item, translation });
      } else {
        updated.push(item);
      }
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: updated });
    sendResponse({ ok: true, filledCount });
  })().catch(() => sendResponse({ ok: false, filledCount: 0 }));

  return true;
});

// Handles context menu saves: optional segmentation, per-item translation, then prepend entries to storage.
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === ACTION_MENU_USE_POPUP) {
    await chrome.storage.local.set({ [PANEL_MODE_KEY]: "popup" });
    await applyPanelMode("popup");
    return;
  }

  if (info.menuItemId !== MENU_ID) return;

  const rawSelection = (info.selectionText || "").trim();
  const pageUrl = info.pageUrl || "";
  if (!rawSelection) return;

  let pieces = [rawSelection];

  if (segmentUtils.shouldSegmentSelection(rawSelection, SEGMENT_CONFIG)) {
    try {
      // UX goal: when users save sentence-like selections, prefer multiple learnable entries
      // (words + useful phrases) instead of one long sentence item in the list.
      // We try a normal split first, then a stricter prompt if needed, and only adopt
      // segmented output when it meaningfully improves what appears in the vocab UI.
      let segmented = await ollamaApi.segmentIntoLexicalItems({
        baseUrl: OLLAMA_BASE,
        model: OLLAMA_MODEL,
        text: rawSelection,
        maxChars: SEGMENT_CONFIG.maxChars,
        maxItems: SEGMENT_CONFIG.maxItems,
        forceMultiple: false
      });
      if (
        !segmented ||
        segmented.length === 0 ||
        segmentUtils.looksLikeUnsplittedSelection(rawSelection, segmented)
      ) {
        segmented = await ollamaApi.segmentIntoLexicalItems({
          baseUrl: OLLAMA_BASE,
          model: OLLAMA_MODEL,
          text: rawSelection,
          maxChars: SEGMENT_CONFIG.maxChars,
          maxItems: SEGMENT_CONFIG.maxItems,
          forceMultiple: true
        });
      }
      if (
        segmented &&
        segmented.length > 0 &&
        !segmentUtils.looksLikeUnsplittedSelection(rawSelection, segmented)
      ) {
        pieces = segmented;
      }
    } catch {
      pieces = [rawSelection];
    }
  }

  const { [STORAGE_KEY]: existing = [] } = await chrome.storage.local.get(STORAGE_KEY);
  const baseTime = Date.now();
  const newEntries = [];

  for (let i = 0; i < pieces.length; i += 1) {
    const word = pieces[i];
    let translation = "";
    try {
      translation = await ollamaApi.translateToEnglish({
        baseUrl: OLLAMA_BASE,
        model: OLLAMA_MODEL,
        text: word,
        maxChars: TRANSLATE_MAX_CHARS
      });
    } catch {
      translation = "";
    }
    newEntries.push({
      id: crypto.randomUUID(),
      word,
      translation,
      url: pageUrl,
      savedAt: baseTime + i
    });
  }

  await chrome.storage.local.set({
    [STORAGE_KEY]: [...newEntries, ...existing]
  });
});
