const MENU_ID = "save-to-lingolark";
const STORAGE_KEY = "lingoleafSaved";
const TRANSLATE_MAX_CHARS = 2000;

const OLLAMA_BASE = "http://127.0.0.1:11434";
const OLLAMA_MODEL = "qwen2.5:3b";

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

function registerContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Save to LingoLark",
      contexts: ["selection"]
    });
  });
}

chrome.runtime.onInstalled.addListener(registerContextMenu);
chrome.runtime.onStartup.addListener(registerContextMenu);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
  if (info.menuItemId !== MENU_ID) return;

  const word = (info.selectionText || "").trim();
  const pageUrl = info.pageUrl || "";
  if (!word) return;

  let translation = "";
  try {
    translation = await translateToEnglish(word);
  } catch {
    translation = "";
  }

  const { [STORAGE_KEY]: existing = [] } = await chrome.storage.local.get(STORAGE_KEY);
  const entry = {
    id: crypto.randomUUID(),
    word,
    translation,
    url: pageUrl,
    savedAt: Date.now()
  };
  await chrome.storage.local.set({
    [STORAGE_KEY]: [entry, ...existing]
  });
});
