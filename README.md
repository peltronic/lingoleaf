# LingoLeaf

## Local translation engine (Ollama in Docker)

This repo includes a small **Ollama** stack so you can run a local LLM for LingoLeaf without calling a remote translation API.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose v2 (`docker compose`).

### Start Ollama

From the repository root:

```bash
docker compose up -d
```

The API listens on **http://127.0.0.1:11434**. Models are stored in the named volume **`ollama_models`** (under `/root/.ollama` in the container), so they survive container restarts.

### Pull the translation model

After the container is running, download **qwen2.5:3b** (one-time per volume, or when you change models):

```bash
chmod +x setup_model.sh   # optional, first time only
./setup_model.sh
```

The script checks that the **ollama** service is up, then runs `ollama pull qwen2.5:3b` inside the container.

Alternative (Compose-only) one-shot pull:

```bash
docker compose --profile setup run --rm model-setup
```

### Configuration notes

- **`OLLAMA_ORIGINS`** is set to `chrome-extension://*` so the Chrome extension can send cross-origin requests to `http://127.0.0.1:11434` from extension pages (subject to your `manifest.json` `host_permissions`).
- **`OLLAMA_HOST`** is `0.0.0.0:11434` so the server accepts connections on the published port.

### Stop Ollama

```bash
docker compose down
```

Model files remain in the `ollama_models` volume until you remove it (e.g. `docker compose down -v`).

### Restart behavior

- The `ollama` service uses `restart: unless-stopped`, so it will come back automatically after Docker daemon restarts.
- If you see `{"models":[]}` from `/api/tags`, the model is not present in the current volume yet - run `./setup_model.sh` (or the `model-setup` command above).

### Quick check

List local models:

```bash
curl -s http://127.0.0.1:11434/api/tags
```
