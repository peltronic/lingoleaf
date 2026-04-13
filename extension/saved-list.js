const STORAGE_KEY = "lingoleafSaved";

const buildMetaEl = document.getElementById("build-meta");

const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh");
const clearBtn = document.getElementById("clear");
const lockSideBtn = document.getElementById("lock-side");
const unlockPopupBtn = document.getElementById("unlock-popup");

function setStatus(text = "") {
  if (statusEl) statusEl.textContent = text;
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

function render(entries) {
  const list = document.getElementById("list");
  const empty = document.getElementById("empty");
  list.innerHTML = "";

  if (!entries.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const item of entries) {
    const li = document.createElement("li");
    const word = document.createElement("div");
    word.className = "word";
    word.textContent = item.word;

    const trans = document.createElement("div");
    trans.className = "translation" + (item.translation ? "" : " muted");
    trans.textContent = item.translation
      ? `EN: ${item.translation}`
      : "Translation unavailable";

    const urlRow = document.createElement("div");
    urlRow.className = "url";
    const a = document.createElement("a");
    a.href = item.url || "#";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = item.url || "(no URL)";
    if (!item.url) {
      a.removeAttribute("href");
    }
    urlRow.appendChild(a);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = formatDate(item.savedAt);

    li.appendChild(word);
    li.appendChild(trans);
    li.appendChild(urlRow);
    li.appendChild(meta);
    list.appendChild(li);
  }
}

async function load() {
  const { [STORAGE_KEY]: entries = [] } = await chrome.storage.local.get(STORAGE_KEY);
  render(entries);
}

async function renderBuildMeta() {
  if (!buildMetaEl) return;
  const { version } = chrome.runtime.getManifest();
  buildMetaEl.replaceChildren();
  buildMetaEl.appendChild(document.createTextNode(`LingoLeaf v${version}`));

  try {
    const res = await fetch(chrome.runtime.getURL("build-meta.json"));
    if (res.ok) {
      const data = await res.json();
      const c = data && typeof data.commit === "string" ? data.commit.trim() : "";
      if (c && c !== "unknown") {
        buildMetaEl.appendChild(document.createTextNode(" · "));
        const code = document.createElement("code");
        code.textContent = c;
        buildMetaEl.appendChild(code);
      }
    }
  } catch {
    /* ignore */
  }
}

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  setStatus("");
  render([]);
});

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  setStatus("Filling missing translations...");
  try {
    const result = await chrome.runtime.sendMessage({ type: "backfill-missing-translations" });
    if (result && result.ok) {
      setStatus(`Added ${result.filledCount} translation${result.filledCount === 1 ? "" : "s"}.`);
    } else {
      setStatus("Unable to backfill right now.");
    }
  } catch {
    setStatus("Unable to backfill right now.");
  } finally {
    refreshBtn.disabled = false;
  }
});

if (lockSideBtn) {
  lockSideBtn.addEventListener("click", async () => {
    lockSideBtn.disabled = true;
    try {
      const w = await chrome.windows.getCurrent();
      await chrome.runtime.sendMessage({
        type: "set-panel-mode",
        mode: "sidepanel",
        windowId: w.id
      });
      await chrome.sidePanel.open({ windowId: w.id });
    } catch {
      setStatus("Could not open side panel.");
    } finally {
      lockSideBtn.disabled = false;
    }
  });
}

if (unlockPopupBtn) {
  unlockPopupBtn.addEventListener("click", async () => {
    unlockPopupBtn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: "set-panel-mode", mode: "popup" });
      setStatus("Toolbar icon now opens the popup again.");
    } catch {
      setStatus("Could not switch to popup mode.");
    } finally {
      unlockPopupBtn.disabled = false;
    }
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    render(changes[STORAGE_KEY].newValue || []);
  }
});

load();
renderBuildMeta();
