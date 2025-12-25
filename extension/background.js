const DEFAULT_SETTINGS = {
  activeProvider: "gemini",
  summaryDefault: "short",
  modelGemini: "gemini-1.5-flash",
  modelClaude: "claude-3-haiku-20240307"
};
const SNIPPET_MAX_CHARS = 200;
const SNIPPET_MIN = 2;
const SNIPPET_MAX = 5;
const ERROR_SNIPPET_MAX = 300;
const REQUEST_TIMEOUT_MS = 20000;

const SUMMARY_PROMPTS = {
  short: "Summarize in 5 bullet points. Then provide 2-5 short quotes/snippets from the page supporting the summary.",
  medium: "Structured summary with headings + bullets. Then 2-5 snippets.",
  detailed: "Detailed structured summary (sections, key points, caveats). Then 2-5 snippets."
};
const QA_PROMPT =
  "Answer using ONLY the page content. If not found, say so. Then provide 2-5 supporting snippets.";

class LLMError extends Error {
  constructor(message, status, debug) {
    super(message);
    this.status = status;
    this.debug = debug;
  }
}

async function getSettings() {
  const stored = await chrome.storage.local.get();
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function sendSettings() {
  const settings = await getSettings();
  try {
    await chrome.runtime.sendMessage({ type: "SETTINGS", settings });
  } catch (_) {
    // Panel may be closed; ignore.
  }
}

async function deleteKey(provider) {
  const keyMap = {
    gemini: "geminiKey",
    claude: "claudeKey"
  };
  const keyName = keyMap[provider];
  if (keyName) {
    await chrome.storage.local.remove(keyName);
  }
  await sendSettings();
}

async function saveSettings(settings) {
  await chrome.storage.local.set(settings);
  await sendSettings();
}

function clipSnippet(text) {
  const trimmed = text.trim();
  if (trimmed.length <= SNIPPET_MAX_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, SNIPPET_MAX_CHARS - 3)}...`;
}

function splitSegments(text) {
  const paragraphs = text
    .split(/\n+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (paragraphs.length >= 2) {
    return paragraphs;
  }

  const sentenceMatches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return sentenceMatches.map((segment) => segment.trim()).filter(Boolean);
}

function safeErrorSnippet(text) {
  if (!text) {
    return "";
  }
  return text.replace(/\s+/g, " ").trim().slice(0, ERROR_SNIPPET_MAX);
}

function generateSnippets(page) {
  const snippets = [];
  const seen = new Set();

  const push = (value) => {
    const snippet = clipSnippet(value || "");
    if (!snippet) {
      return;
    }
    const key = snippet.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    snippets.push(snippet);
    seen.add(key);
  };

  if (page.excerpt) {
    push(page.excerpt);
  }

  const segments = splitSegments(page.textContent || "");
  for (const segment of segments) {
    if (snippets.length >= SNIPPET_MAX) {
      break;
    }
    push(segment);
  }

  if (snippets.length < SNIPPET_MIN) {
    for (const segment of segments) {
      if (snippets.length >= SNIPPET_MIN) {
        break;
      }
      push(segment);
    }
  }

  return snippets.slice(0, Math.min(SNIPPET_MAX, Math.max(SNIPPET_MIN, snippets.length)));
}

async function extractPage({ notifyPanel }) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.id) {
    const message = "No active tab found.";
    if (notifyPanel) {
      await chrome.runtime.sendMessage({ type: "EXTRACT_ERROR", message });
    }
    return { error: message };
  }

  const url = tab.url;
  if (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:")
  ) {
    const message = "This page cannot be processed. Open a normal website (http/https) tab.";
    if (notifyPanel) {
      await chrome.runtime.sendMessage({ type: "EXTRACT_ERROR", message });
    }
    return { error: message };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/Readability.js", "content.js"]
    });

    const response = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_CONTENT" });
    if (response && response.type === "EXTRACT_RESULT" && response.page) {
      if (notifyPanel) {
        await chrome.runtime.sendMessage(response);
      }
      return { page: response.page };
    }

    const message = response && response.message
      ? response.message
      : "No response from the content script.";
    if (notifyPanel) {
      await chrome.runtime.sendMessage({ type: "EXTRACT_ERROR", message });
    }
    return { error: message };
  } catch (error) {
    const message = "Failed to extract content from the active tab.";
    if (notifyPanel) {
      await chrome.runtime.sendMessage({ type: "EXTRACT_ERROR", message });
    }
    return { error: message };
  }
}

function buildSummaryPrompt(textContent, summaryLength) {
  const prompt = SUMMARY_PROMPTS[summaryLength] || SUMMARY_PROMPTS.short;
  return `${prompt}\n\nPage content:\n${textContent}`;
}

function buildQaPrompt(textContent, userQuery) {
  return `${QA_PROMPT}\n\nUser question:\n${userQuery}\n\nPage content:\n${textContent}`;
}

function parseGeminiText(data) {
  const candidates = data && data.candidates ? data.candidates : [];
  for (const candidate of candidates) {
    const content = candidate.content || candidate;
    const parts = content.parts || candidate.parts || [];
    if (Array.isArray(parts)) {
      const text = parts.map((part) => part.text).filter(Boolean).join("");
      if (text) {
        return text;
      }
    }
    if (content.text) {
      return content.text;
    }
    if (candidate.text) {
      return candidate.text;
    }
    if (candidate.output) {
      return candidate.output;
    }
  }
  return data && data.text ? data.text : "";
}

function parseClaudeText(data) {
  const content = data && data.content ? data.content : [];
  if (typeof content === "string") {
    return content;
  }
  const text = Array.isArray(content)
    ? content.map((part) => part.text).filter(Boolean).join("")
    : "";
  if (text) {
    return text;
  }
  return data && data.completion ? data.completion : "";
}

async function callLLM({ provider, prompt, settings }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    if (provider === "gemini") {
      const model = settings.modelGemini || DEFAULT_SETTINGS.modelGemini;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": settings.geminiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        }),
        signal: controller.signal
      });
      const responseText = await response.text();
      const debug = safeErrorSnippet(responseText);

      if (!response.ok) {
        throw new LLMError("Provider error", response.status, debug);
      }

      let data;
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch (error) {
        throw new LLMError("Provider error", response.status, debug);
      }

      const text = parseGeminiText(data);
      if (!text) {
        throw new LLMError("Empty response from provider", response.status, debug);
      }
      return { text };
    }

    if (provider === "claude") {
      const model = settings.modelClaude || DEFAULT_SETTINGS.modelClaude;
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": settings.claudeKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }]
        }),
        signal: controller.signal
      });
      const responseText = await response.text();
      const debug = safeErrorSnippet(responseText);

      if (!response.ok) {
        throw new LLMError("Provider error", response.status, debug);
      }

      let data;
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch (error) {
        throw new LLMError("Provider error", response.status, debug);
      }

      const text = parseClaudeText(data);
      if (!text) {
        throw new LLMError("Empty response from provider", response.status, debug);
      }
      return { text };
    }

    throw new LLMError("Provider error");
  } catch (error) {
    if (error.name === "AbortError") {
      throw new LLMError("Request timed out");
    }
    if (error instanceof LLMError) {
      throw error;
    }
    throw new LLMError("Provider error");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleLLMRequest(message) {
  const settings = await getSettings();
  const provider = message.provider || settings.activeProvider;
  const { page, error } = await extractPage({ notifyPanel: true });
  if (!page) {
    await chrome.runtime.sendMessage({
      type: "LLM_ERROR",
      message: error || "Unable to extract content from this page."
    });
    return;
  }

  const key =
    provider === "gemini" ? settings.geminiKey : provider === "claude" ? settings.claudeKey : null;
  if (!key) {
    await chrome.runtime.sendMessage({ type: "LLM_ERROR", message: "Missing API key" });
    return;
  }

  const mode = message.mode === "qa" ? "qa" : "summary";
  if (mode === "qa" && (!message.userQuery || !message.userQuery.trim())) {
    await chrome.runtime.sendMessage({
      type: "LLM_ERROR",
      message: "Missing question."
    });
    return;
  }

  const summaryLength =
    mode === "summary"
      ? message.summaryLength || settings.summaryDefault || DEFAULT_SETTINGS.summaryDefault
      : null;
  const prompt =
    mode === "summary"
      ? buildSummaryPrompt(page.textContent || "", summaryLength)
      : buildQaPrompt(page.textContent || "", message.userQuery.trim());

  try {
    const result = await callLLM({ provider, prompt, settings: { ...settings, [provider + "Key"]: key } });
    const snippets = generateSnippets(page);
    await chrome.runtime.sendMessage({
      type: "LLM_RESULT",
      resultText: result.text,
      snippets,
      meta: {
        provider,
        mode,
        truncated: !!page.truncated
      }
    });
  } catch (error) {
    let messageText = error.message || "Provider error";
    let status = error.status;
    const debug = error.debug;
    if (status === 401 || status === 403) {
      messageText = "Invalid API key";
    } else if (status === 429) {
      messageText = "Rate limit exceeded";
    } else if (messageText === "Request timed out") {
      messageText = "Request timed out";
    } else if (messageText === "Provider error" && typeof status === "number") {
      messageText = "Provider error";
    }

    const statusLabel = typeof status === "number" ? status : "no-status";
    console.warn(`LLM failed: ${provider} (${statusLabel})`);

    await chrome.runtime.sendMessage({
      type: "LLM_ERROR",
      message: messageText,
      status,
      debug: debug || undefined
    });
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "LOAD_SETTINGS") {
    void sendSettings();
    return;
  }

  if (message.type === "SAVE_SETTINGS") {
    void saveSettings(message.settings || {});
    return;
  }

  if (message.type === "DELETE_KEY") {
    void deleteKey(message.provider);
    return;
  }

  if (message.type === "EXTRACT_CONTENT") {
    void extractPage({ notifyPanel: true });
    return;
  }

  if (message.type === "LLM_REQUEST") {
    void handleLLMRequest(message);
  }
});
