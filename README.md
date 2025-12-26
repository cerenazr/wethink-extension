# WeThink 🧠✨

**WeThink — think together, browse smarter**

WeThink is a tiny browser assistant built by two friends who enjoy thinking together.

It quietly reads the page you're on, understands its context, and helps you make sense of it —
summaries, key ideas, and answers to your questions.

No control.  
No interruptions.  
Just thinking together.

---

## What WeThink does (Phase 1)

- Understands the content of the current webpage
- Summarizes long pages into clear key points
- Answers user questions based only on the page content
- Works as a lightweight Chrome extension

---

## Tech Stack

- Chrome Extension (Manifest V3)
- JavaScript / TypeScript
- Backend API (for AI model access)
- Large Language Models (Claude / Gemini)

---

## Local development

### Extension (Chrome)

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the `extension` folder.
4. Open any webpage and click the extension icon to show the side panel.

### Dev / Debug (MV3)

- Load the unpacked extension from the `extension` folder (`extension/manifest.json`).
- On a webpage, open the extension side panel via the extension icon.
- Go to `chrome://extensions`, find WeThink, and click **service worker** to open the MV3 console.

### Backend

The `backend` folder is not present in this repo, so there is no local server to start here.

Suggested structure if you plan to add it:
- `backend/` (source code)
- `backend/README.md` (start command, port)
- `backend/.env.example` (document required env vars)

Typical fields to document in that README:
- `PORT` (the HTTP port the API listens on)
- `ANTHROPIC_API_KEY` and/or `GEMINI_API_KEY` (provider credentials)

---

## Project Status

🚧 Phase 1 — In progress  
This is a weekly build project focused on learning, collaboration, and experimentation.

---

## Built by

Ceren & Ceyda 🤍  
*We think better together.*
