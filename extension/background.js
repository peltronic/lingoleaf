const MENU_ID = "save-to-lingoleaf";
const ACTION_MENU_USE_POPUP = "lingoleaf-use-popup-toolbar";
const STORAGE_KEY = "lingoleafSaved";
const PANEL_MODE_KEY = "lingoleafPanelMode";
const TRANSLATE_MAX_CHARS = 2000;

const OLLAMA_BASE = "http://127.0.0.1:11434";
const OLLAMA_MODEL = "qwen2.5:3b";

/** Selections with at least this many words are split into lexical items before translating. */
const SEGMENT_MIN_WORDS = 6;
const SEGMENT_MAX_CHARS = 1500;
const SEGMENT_MAX_ITEMS = 48;

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function shouldSegmentSelection(text) {
  const t = text.trim();
  if (!t) return false;
  if (t.length > SEGMENT_MAX_CHARS) return true;
  return countWords(t) >= SEGMENT_MIN_WORDS;
}

function extractJsonStringArray(raw) {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(s);
  if (fence) s = fence[1].trim();
  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return null;
    const out = [];
    for (const x of parsed) {
      if (typeof x !== "string") continue;
      const item = x.trim();
      if (item) out.push(item);
    }
    return out.length ? out.slice(0, SEGMENT_MAX_ITEMS) : null;
  } catch {
    const start = s.indexOf("[");
    const end = s.lastIndexOf("]");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(s.slice(start, end + 1));
      if (!Array.isArray(parsed)) return null;
      const out = [];
      for (const x of parsed) {
        if (typeof x !== "string") continue;
        const item = x.trim();
        if (item) out.push(item);
      }
      return out.length ? out.slice(0, SEGMENT_MAX_ITEMS) : null;
    } catch {
      return null;
    }
  }
}

/**
 * Split longer French text into words and multi-word idioms via local LLM. Returns null on failure.
 */
async function segmentIntoLexicalItems(text) {
  const slice = text.length > SEGMENT_MAX_CHARS ? text.slice(0, SEGMENT_MAX_CHARS) : text;

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        {
          role: "user",
          content:
            "You help French learners build vocabulary. Split the text below into a JSON array of strings ONLY.\n" +
            "- Keep common French idioms and fixed expressions as one string (e.g. \"à tout prix\", \"en train de\").\n" +
            "- Otherwise use single words (meaningful tokens; no bare punctuation-only entries).\n" +
            "- No duplicates. Preserve left-to-right order. Max " +
            SEGMENT_MAX_ITEMS +
            " items.\n" +
            "- Reply with nothing except valid JSON, e.g. [\"mot\", \"expression fixe\", \"autre\"].\n\n" +
            "Text:\n" +
            slice
        }
      ],
      stream: false,
      options: { temperature: 0.1 }
    })
  });

  if (!res.ok) return null;
  const data = await res.json();
  const content =
    data && data.message && typeof data.message.content === "string" ? data.message.content : "";
  return extractJsonStringArray(content);
}

/**
 * English gloss via local Ollama (Docker). Fails quietly if Ollama is down or the model is missing.
 */
async function translateToEnglish(text) {
  const q = text.trim();
  if (!q) return "";
  const slice = q.length > TRANSLATE_MAX_CHARS ? q.slice(0, TRANSLATE_MAX_CHARS) : q;

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        {
          role: "user",
          content:
            "Translate the following text into English. Reply with only the English translation, with no quotes or explanation.\n\n" +
            slice
        }
      ],
      stream: false,
      options: { temperature: 0.2 }
    })
  });

  if (!res.ok) return "";
  const data = await res.json();
  const content =
    data && data.message && typeof data.message.content === "string" ? data.message.content : "";
  return content.trim();
}

/** Serializes menu rebuilds so concurrent removeAll/create races cannot duplicate ids. */
let contextMenuChain = Promise.resolve();

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

  (async () => {
    const { [STORAGE_KEY]: existing = [] } = await chrome.storage.local.get(STORAGE_KEY);
    const updated = [];
    let filledCount = 0;

    for (const item of existing) {
      if (item && item.word && !item.translation) {
        let translation = "";
        try {
          translation = await translateToEnglish(item.word);
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

  if (shouldSegmentSelection(rawSelection)) {
    try {
      const segmented = await segmentIntoLexicalItems(rawSelection);
      if (segmented && segmented.length > 0) {
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
      translation = await translateToEnglish(word);
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
