# Nova AI Chatbot

A beginner-friendly AI chatbot web application built with **FastAPI** (Python backend)
and plain **HTML, CSS, JavaScript** (frontend). It uses any OpenAI-compatible chat API.

> **Security rule:** your API key lives only in the `.env` file on your own computer.
> It is never sent to the browser and must never be shared publicly.

---

## Features

- Modern, dark, responsive chat interface (works on desktop and mobile).
- User and AI messages shown in separate chat bubbles.
- Send with **Enter**, new line with **Shift + Enter**.
- Loading indicator while Nova thinks.
- Empty messages are blocked.
- Clear conversation button.
- Conversation history is kept during the current browser session.
- Helpful error messages when the API key is missing or a request fails.

---

## 1. Open the project in VS Code

1. Open VS Code.
2. Click **File > Open Folder...** and select the `nova-ai-chatbot` folder.
3. Open the integrated terminal: **Terminal > New Terminal** (or press `` Ctrl + ` ``).

---

## 2. Create a virtual environment

In the VS Code terminal, run:

```
python -m venv .venv
```

---

## 3. Activate the virtual environment

**In PowerShell (the default VS Code terminal on Windows):**

```
.venv\Scripts\Activate.ps1
```

> **PowerShell blocks activation?**
> You may see an "execution policy" error. Easiest fix: use the Windows
> **Command Prompt** terminal instead. In VS Code, click the dropdown arrow next
> to the `+` in the terminal and choose **Command Prompt**, then run:

```
.venv\Scripts\activate.bat
```

> If you prefer to keep using PowerShell, you can temporarily allow scripts once:

```
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Then run the `Activate.ps1` command again.

You know the environment is active when `(.venv)` appears at the start of your prompt.

---

## 4. Install the required packages

```
pip install -r requirements.txt
```

---

## 5. Set up your `.env` file

1. Copy `.env.example` to a new file named `.env` (same folder).
2. Open `.env` and fill in the values:

```
AI_API_KEY=your_real_api_key_here
AI_BASE_URL=
AI_MODEL=gpt-4o-mini
APP_HOST=127.0.0.1
APP_PORT=8000
```

- `AI_API_KEY` — your key from the AI provider (e.g. OpenAI platform, then
  API keys section).
- `AI_MODEL` — the model name, e.g. `gpt-4o-mini`, `gpt-4o`, or `claude-*` /
  `gemini-*` depending on your provider.
- `AI_BASE_URL` — leave empty to use the default OpenAI API. Change it to use
  another OpenAI-compatible provider (see section 8).

> The `.env` file is already in `.gitignore`, so your key is never committed.

---

## 6. Start the server

```
uvicorn app.main:app --reload
```

Or double-click **`run.bat`** — it activates the environment and starts the server.

---

## 7. Open the app

In your browser, go to:

```
http://127.0.0.1:8000
```

---

## 8. Stop the server

In the terminal where uvicorn is running, press **Ctrl + C**.
The terminal should return to the normal prompt.

---

## 9. Change the AI provider

Nova works with any provider that exposes an **OpenAI-compatible** API.
In `.env`:

```
AI_BASE_URL=https://your-provider-endpoint.com/v1
AI_MODEL=your-provider-model-name
AI_API_KEY=your-provider-key
```

Examples of providers that are OpenAI-compatible: OpenAI, or local/third-party
servers such as those that expose a `/v1/chat/completions` endpoint (e.g. Ollama
with its OpenAI-compatible endpoint, or many others). Check your provider's
documentation for the correct base URL and model name.

---

## Common errors and fixes

| Error | Fix |
| --- | --- |
| `pip` is not recognized | Activate the environment first (step 3), or run `python -m pip install -r requirements.txt`. |
| `'uvicorn' is not recognized` | The environment is not active, or packages were not installed. Re-check steps 3 and 4. |
| Server starts but page shows "missing AI_API_KEY" | Open `.env`, add your real key, save, and restart the server (Ctrl + C, then start again). |
| `Authentication failed` | Your API key is wrong or expired. Double-check it in `.env`. |
| `Could not reach the AI service` | Check your internet connection and that `AI_BASE_URL` is correct (or empty for the default OpenAI endpoint). |
| `Rate limit reached` | Wait a bit and try again (free tier limits). |
| Port 8000 already in use | Change `APP_PORT` in `.env` (or run `uvicorn app.main:app --reload --port 8001`) and open the new URL. |
| PowerShell blocks the activation script | Use Command Prompt instead (step 3). |

---

## How the project is organised

```
nova-ai-chatbot/
├── app/
│   ├── main.py        # FastAPI app: routes, health check, /api/chat
│   ├── config.py      # Reads settings from the .env file
│   ├── ai_service.py  # Talks to the AI provider (OpenAI SDK)
│   ├── models.py      # Pydantic models: request and response validation
│   ├── static/
│   │   ├── index.html # The chatbot page
│   │   ├── style.css  # Dark modern styling
│   │   └── script.js  # Frontend logic (fetch, rendering, events)
│   └── __init__.py
├── .env.example       # Template for your .env file
├── .gitignore         # Keeps secrets and junk out of git
├── requirements.txt   # Python dependencies
├── run.bat            # One-click Windows launcher
└── README.md          # This file
```

**How it works, briefly:**

1. The browser loads `index.html` from the backend.
2. When you press Send, `script.js` keeps your conversation in an array and
   POSTs it to **`POST /api/chat`**.
3. FastAPI validates the request with Pydantic (`models.py`) and limits history
   size and message length.
4. `ai_service.py` prepends Nova's system prompt, calls the configured model
   through the official `openai` SDK, and returns the reply.
5. The backend answers `{"reply": "..."}`, which `script.js` renders in a new
   chat bubble.

---

## Deploy to Vercel

The project is ready to deploy as a single Vercel Function (FastAPI is detected
automatically; `pyproject.toml` pins the entrypoint to `app.main:app`).

1. **Push this repo to GitHub** and import it in Vercel
   (vercel.com → *Add New Project* → GitHub repo).

2. **Set the environment variables** in Vercel:
   Project → *Settings → Environment Variables*, add for **Production**:
   ```
   AI_API_KEY=<your_api_key>
   AI_BASE_URL=https://api.groq.com/openai/v1
   AI_MODEL=qwen/qwen3.8-27b
   ```
   (If you use a different provider, set `AI_BASE_URL`/`AI_MODEL` accordingly.)

3. **Deploy.** After the build finishes, open your app URL and verify the health
   endpoint returns `"api_key_configured": true`:
   ```
   https://<your-project>.vercel.app/api/health
   ```

4. **If you get `500 FUNCTION_INVOCATION_FAILED`:** redeploy after pushing the
   current commit, then check *Logs* in Vercel for the exact traceback. Common
   causes are a missing env var or a provider/model that cannot be reached.

> Your local `.env` is gitignored — on Vercel the key comes only from
> Vercel's own Environment Variables.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Notes

- **Python 3.11+** is required (tested with Python 3.14).
- No database, no React, no Docker — just FastAPI + one HTML page.
- The API key is only ever read on the server from `.env` and is never exposed
  to the frontend.