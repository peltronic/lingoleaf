## ⚠️ Alpha Release Disclaimer
LingoLeaf is currently in **Alpha**. It is an experimental tool under active development. 

* **Hardware Requirements:** Running local LLMs (via Ollama/Docker) requires significant CPU/GPU and RAM. Performance will vary based on your local machine.
* **Liability:** By using this software, you acknowledge that it is provided "as is." The developers are not responsible for any data loss, system instability, or hardware strain caused by running local models.
* **No Cloud Connectivity:** While we do not send your data to external servers, you are responsible for securing your own local environment and Docker instances.

---

# LingoLeaf (Alpha)

LingoLeaf is in **early development**. Features and documentation may change between releases.

---

## 1. What is LingoLeaf?

**What it is:** A **private, local-first** Chrome extension that saves highlighted **French** text and the page URL, then asks a **local LLM** (Ollama in Docker on your machine) for a quick **English** gloss—without using a cloud translation API for that step. Your data stays on your device unless you choose to share it elsewhere.

---

## 2. Prerequisites

| Requirement | Purpose |
|-------------|---------|
| **Docker Desktop** (or equivalent Docker engine + Compose v2) | Runs the Ollama container and stores models in a persistent volume. |
| **Google Chrome** (or another Chromium browser that supports unpacked extensions) | Installs and runs the LingoLeaf extension. |

You need network access **only** when pulling the AI model the first time (or after wiping the Docker volume). Day-to-day use of translation does not require outbound calls to a third-party API for that step.

---

## 3. Quick Start

From the **repository root**, run these two commands in order.

**1. Start the local translation engine**

```bash
docker compose up -d
```

**2. Download the translation model** (once per machine/volume, or after `docker compose down -v`)

```bash
docker compose --profile setup run --rm model-setup
```

The first command starts Ollama and exposes the API at **http://127.0.0.1:11434**. The second pulls the configured model (`qwen2.5:3b`) into the named volume so it survives container restarts.

**Equivalent alternative:** if you prefer a shell helper, `./setup_model.sh` performs the same pull after checking that the Ollama service is running.

**Sanity check** (optional):

```bash
curl -s http://127.0.0.1:11434/api/tags
```

You should see your model listed. If the list is empty, run step 2 again.

---

## 4. Chrome installation

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (toggle in the top-right).
3. Click **Load unpacked**.
4. Select the **`extension`** folder inside this repository (the folder that contains `manifest.json`).

After loading, pin the extension if you like (**Extensions** menu → pin LingoLeaf). Open the toolbar popup to view saved items and use actions such as **Fill missing** when the local engine was offline earlier.

To pick up code changes after editing files, return to `chrome://extensions` and click **Reload** on LingoLeaf. There is no separate build step—Chrome reads the files from the **`extension`** folder (the one that contains `manifest.json`) directly.

Optional: run `./scripts/update-build-meta.sh` so the footer shows the current git short hash (stored in `extension/build-meta.json`).

---

## Additional notes

- **Stop the engine:** `docker compose down` (model files remain in the `ollama_models` volume unless you remove volumes with `docker compose down -v`).
- **Configuration:** The Compose file sets `OLLAMA_HOST` and `OLLAMA_ORIGINS` so the extension can reach Ollama from a `chrome-extension://` origin; see `docker-compose.yml` for details.
