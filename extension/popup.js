const STORAGE_KEY = "lingoleafSaved";
const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh");
const clearBtn = document.getElementById("clear");

function setStatus(text = "") {
  statusEl.textContent = text;
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    render(changes[STORAGE_KEY].newValue || []);
  }
});

load();
