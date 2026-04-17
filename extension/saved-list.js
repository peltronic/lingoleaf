const STORAGE_KEY = "lingoleafSaved"
const SEGMENTING_KEY = "lingoleafSegmenting"

const buildMetaEl = document.getElementById("build-meta")

const statusEl = document.getElementById("status")
const refreshBtn = document.getElementById("refresh")
const clearBtn = document.getElementById("clear")
const lockSideBtn = document.getElementById("lock-side")
const unlockPopupBtn = document.getElementById("unlock-popup")

function setStatus(text = "") {
  if (statusEl) statusEl.textContent = text
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ""
  }
}

// Small chain-link icon (source page).
function createSourceLinkIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("width", "16")
  svg.setAttribute("height", "16")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "2")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("aria-hidden", "true")
  const p1 = document.createElementNS("http://www.w3.org/2000/svg", "path")
  p1.setAttribute(
    "d",
    "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
  )
  const p2 = document.createElementNS("http://www.w3.org/2000/svg", "path")
  p2.setAttribute(
    "d",
    "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  )
  svg.appendChild(p1)
  svg.appendChild(p2)
  return svg
}

function createCloseIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("width", "14")
  svg.setAttribute("height", "14")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "2")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("aria-hidden", "true")
  const p1 = document.createElementNS("http://www.w3.org/2000/svg", "path")
  p1.setAttribute("d", "M18 6L6 18")
  const p2 = document.createElementNS("http://www.w3.org/2000/svg", "path")
  p2.setAttribute("d", "M6 6l12 12")
  svg.appendChild(p1)
  svg.appendChild(p2)
  return svg
}

function urlsFromItem(item) {
  if (!item || typeof item !== "object") return []
  if (Array.isArray(item.urls) && item.urls.length) {
    return item.urls.filter((u) => typeof u === "string" && u.trim())
  }
  if (typeof item.url === "string" && item.url.trim()) return [item.url.trim()]
  return []
}

function sameEntry(a, b) {
  if (a.id && b.id) return a.id === b.id
  const urlsA = urlsFromItem(a).slice().sort().join("\n")
  const urlsB = urlsFromItem(b).slice().sort().join("\n")
  return a.savedAt === b.savedAt && a.word === b.word && urlsA === urlsB
}

async function deleteEntry(item) {
  const { [STORAGE_KEY]: entries = [] } =
    await chrome.storage.local.get(STORAGE_KEY)
  const next = entries.filter((e) => !sameEntry(e, item))
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
}

function render(entries, showSegmentingBanner) {
  const list = document.getElementById("list")
  const empty = document.getElementById("empty")
  const banner = document.getElementById("segmenting-banner")
  if (banner) {
    banner.hidden = !showSegmentingBanner
  }
  list.innerHTML = ""

  if (!entries.length && !showSegmentingBanner) {
    empty.hidden = false
    return
  }
  empty.hidden = true

  for (const item of entries) {
    const li = document.createElement("li")
    li.className = "entry-card"

    const del = document.createElement("button")
    del.type = "button"
    del.className = "entry-delete"
    del.title = "Remove this entry"
    del.setAttribute("aria-label", "Remove this entry")
    del.appendChild(createCloseIcon())
    del.addEventListener("click", () => {
      void deleteEntry(item)
    })
    li.appendChild(del)

    const word = document.createElement("div")
    word.className = "word"
    word.textContent = item.word

    const trans = document.createElement("div")
    if (item.translationPending) {
      trans.className = "translation translation-pending"
      trans.setAttribute("aria-busy", "true")
      const spin = document.createElement("span")
      spin.className = "ll-spinner"
      spin.setAttribute("aria-hidden", "true")
      const label = document.createElement("span")
      label.className = "ll-spinner-label"
      label.textContent = "Translating…"
      trans.appendChild(spin)
      trans.appendChild(label)
    } else {
      trans.className = "translation" + (item.translation ? "" : " muted")
      trans.textContent = item.translation
        ? `EN: ${item.translation}`
        : "Translation unavailable"
    }

    const urlRow = document.createElement("div")
    const sourceUrls = urlsFromItem(item)
    urlRow.className =
      "source-row" + (sourceUrls.length > 1 ? " source-row-multi" : "")
    if (sourceUrls.length) {
      for (let ui = 0; ui < sourceUrls.length; ui += 1) {
        const href = sourceUrls[ui]
        const a = document.createElement("a")
        a.className = "source-link"
        a.href = href
        a.target = "_blank"
        a.rel = "noopener noreferrer"
        a.title = href
        a.setAttribute(
          "aria-label",
          `Open source page ${ui + 1} of ${sourceUrls.length} in new tab`,
        )
        a.appendChild(createSourceLinkIcon())
        urlRow.appendChild(a)
      }
    } else {
      const span = document.createElement("span")
      span.className = "source-link-missing"
      span.title = "No source URL saved"
      span.setAttribute("aria-label", "No source URL")
      span.appendChild(createSourceLinkIcon())
      urlRow.appendChild(span)
    }

    const meta = document.createElement("div")
    meta.className = "meta"
    meta.textContent = formatDate(item.savedAt)

    li.appendChild(word)
    li.appendChild(trans)
    li.appendChild(urlRow)
    li.appendChild(meta)
    list.appendChild(li)
  }
}

async function load() {
  const data = await chrome.storage.local.get([STORAGE_KEY, SEGMENTING_KEY])
  const entries = data[STORAGE_KEY] || []
  const showSegmentingBanner = !!(
    data[SEGMENTING_KEY] && data[SEGMENTING_KEY].active
  )
  render(entries, showSegmentingBanner)
}

async function renderBuildMeta() {
  if (!buildMetaEl) return
  const { version } = chrome.runtime.getManifest()
  buildMetaEl.replaceChildren()
  buildMetaEl.appendChild(document.createTextNode(`LingoLeaf v${version}`))

  try {
    const res = await fetch(chrome.runtime.getURL("build-meta.json"))
    if (res.ok) {
      const data = await res.json()
      const c =
        data && typeof data.commit === "string" ? data.commit.trim() : ""
      if (c && c !== "unknown") {
        buildMetaEl.appendChild(document.createTextNode(" · "))
        const code = document.createElement("code")
        code.textContent = c
        buildMetaEl.appendChild(code)
      }
    }
  } catch {
    /* ignore */
  }
}

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] })
  await chrome.storage.local.remove(SEGMENTING_KEY).catch(() => {})
  setStatus("")
  await load()
})

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true
  setStatus("Filling missing translations...")
  try {
    const result = await chrome.runtime.sendMessage({
      type: "backfill-missing-translations",
    })
    if (result && result.ok) {
      setStatus(
        `Added ${result.filledCount} translation${result.filledCount === 1 ? "" : "s"}.`,
      )
    } else {
      setStatus("Unable to backfill right now.")
    }
  } catch {
    setStatus("Unable to backfill right now.")
  } finally {
    refreshBtn.disabled = false
  }
})

if (lockSideBtn) {
  lockSideBtn.addEventListener("click", async () => {
    lockSideBtn.disabled = true
    try {
      const w = await chrome.windows.getCurrent()
      await chrome.runtime.sendMessage({
        type: "set-panel-mode",
        mode: "sidepanel",
        windowId: w.id,
      })
      await chrome.sidePanel.open({ windowId: w.id })
    } catch {
      setStatus("Could not open side panel.")
    } finally {
      lockSideBtn.disabled = false
    }
  })
}

if (unlockPopupBtn) {
  unlockPopupBtn.addEventListener("click", async () => {
    unlockPopupBtn.disabled = true
    try {
      await chrome.runtime.sendMessage({
        type: "set-panel-mode",
        mode: "popup",
      })
      setStatus("Toolbar icon now opens the popup again.")
    } catch {
      setStatus("Could not switch to popup mode.")
    } finally {
      unlockPopupBtn.disabled = false
    }
  })
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[STORAGE_KEY] || changes[SEGMENTING_KEY])) {
    void load()
  }
})

load()
renderBuildMeta()
