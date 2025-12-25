const tabButtons = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");
const extractBtn = document.getElementById("extractBtn");
const statusLine = document.getElementById("statusLine");
const resultTitle = document.getElementById("resultTitle");
const resultPreview = document.getElementById("resultPreview");
const llmResultText = document.getElementById("llmResultText");
const snippetList = document.getElementById("snippetList");
const providerWarning = document.getElementById("providerWarning");
const llmDebug = document.getElementById("llmDebug");
const llmDebugText = document.getElementById("llmDebugText");

const summaryShortBtn = document.getElementById("summaryShort");
const summaryMediumBtn = document.getElementById("summaryMedium");
const summaryDetailedBtn = document.getElementById("summaryDetailed");
const qaInput = document.getElementById("qaInput");
const qaSendBtn = document.getElementById("qaSend");

const providerSelect = document.getElementById("providerSelect");
const geminiKeyInput = document.getElementById("geminiKey");
const claudeKeyInput = document.getElementById("claudeKey");
const geminiKeyStatus = document.getElementById("geminiKeyStatus");
const claudeKeyStatus = document.getElementById("claudeKeyStatus");
const summarySelect = document.getElementById("summaryDefault");
const saveSettingsBtn = document.getElementById("saveSettings");
const deleteGeminiBtn = document.getElementById("deleteGeminiKey");
const deleteClaudeBtn = document.getElementById("deleteClaudeKey");
const settingsStatus = document.getElementById("settingsStatus");

const STATE = {
  ready: "ready",
  extracting: "extracting",
  calling: "calling",
  error: "error"
};

let llmPending = false;
let currentState = STATE.ready;
let errorTimeoutId = null;

const STATUS_TEXT = {
  ready: "Ready.",
  extracting: "Extracting...",
  calling: "Calling LLM..."
};

function setActiveTab(tabName) {
  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  panels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${tabName}`);
  });
}

function setState(nextState) {
  if (errorTimeoutId) {
    clearTimeout(errorTimeoutId);
    errorTimeoutId = null;
  }
  currentState = nextState;
  if (nextState === STATE.error) {
    statusLine.textContent = "Error.";
    return;
  }
  statusLine.textContent = STATUS_TEXT[nextState] || STATUS_TEXT.ready;
}

function showError(message) {
  if (errorTimeoutId) {
    clearTimeout(errorTimeoutId);
  }
  currentState = STATE.error;
  statusLine.textContent = message ? `Error: ${message}` : "Error.";
  errorTimeoutId = setTimeout(() => {
    setState(STATE.ready);
  }, 2500);
}

function setActionsDisabled(disabled) {
  extractBtn.disabled = disabled;
  summaryShortBtn.disabled = disabled;
  summaryMediumBtn.disabled = disabled;
  summaryDetailedBtn.disabled = disabled;
  qaSendBtn.disabled = disabled;
  qaInput.disabled = disabled;
}

function setSettingsStatus(text) {
  settingsStatus.textContent = text;
}

function updateExtractResult(page) {
  resultTitle.textContent = page.title || "Untitled page";
  const preview = page.textContent ? page.textContent.slice(0, 500) : "";
  resultPreview.textContent = preview || "No preview available.";
}

function clearLlmOutput() {
  llmResultText.textContent = "No response.";
  renderSnippets([]);
}

function clearDebug() {
  if (!llmDebug || !llmDebugText) {
    return;
  }
  llmDebugText.textContent = "";
  llmDebug.hidden = true;
}

function setDebug(text) {
  if (!llmDebug || !llmDebugText) {
    return;
  }
  if (!text) {
    clearDebug();
    return;
  }
  llmDebugText.textContent = text;
  llmDebug.hidden = false;
}

function renderSnippets(snippets) {
  snippetList.innerHTML = "";
  const list = Array.isArray(snippets) ? snippets : [];
  if (!list.length) {
    const item = document.createElement("li");
    item.textContent = "No snippets available.";
    snippetList.appendChild(item);
    return;
  }
  list.forEach((snippet) => {
    const item = document.createElement("li");
    item.textContent = snippet;
    snippetList.appendChild(item);
  });
}

function updateLlmResult(resultText, snippets) {
  llmResultText.textContent = resultText || "No response.";
  renderSnippets(snippets);
  clearDebug();
}

function updateProviderWarning() {
  const label = providerSelect.value === "claude" ? "Claude" : "Gemini";
  providerWarning.textContent = `Page content will be sent to ${label}.`;
}

function updateSettingsUI(settings) {
  providerSelect.value = settings.activeProvider || "gemini";
  summarySelect.value = settings.summaryDefault || "short";

  const hasGeminiKey = Boolean(settings.geminiKey);
  const hasClaudeKey = Boolean(settings.claudeKey);
  geminiKeyStatus.textContent = hasGeminiKey ? "Stored." : "Not set.";
  claudeKeyStatus.textContent = hasClaudeKey ? "Stored." : "Not set.";
  updateProviderWarning();
}

function startLlmRequest(payload) {
  if (currentState === STATE.extracting || currentState === STATE.calling) {
    return;
  }
  llmPending = true;
  setState(STATE.extracting);
  setActionsDisabled(true);
  llmResultText.textContent = "Waiting for response...";
  renderSnippets([]);
  clearDebug();
  chrome.runtime.sendMessage({
    type: "LLM_REQUEST",
    provider: providerSelect.value,
    ...payload
  });
}

function handleRuntimeMessage(message) {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "SETTINGS") {
    updateSettingsUI(message.settings || {});
    setSettingsStatus("Settings loaded.");
    return;
  }

  if (message.type === "EXTRACT_RESULT") {
    if (message.page) {
      updateExtractResult(message.page);
    }
    if (llmPending) {
      setState(STATE.calling);
    } else {
      setState(STATE.ready);
      setActionsDisabled(false);
    }
    return;
  }

  if (message.type === "EXTRACT_ERROR") {
    const wasPending = llmPending;
    showError(message.message || "Extraction failed.");
    llmPending = false;
    if (wasPending) {
      clearDebug();
      clearLlmOutput();
    }
    setActionsDisabled(false);
    return;
  }

  if (message.type === "LLM_RESULT") {
    updateLlmResult(message.resultText, message.snippets);
    llmPending = false;
    setState(STATE.ready);
    setActionsDisabled(false);
    return;
  }

  if (message.type === "LLM_ERROR") {
    const wasPending = llmPending;
    llmPending = false;
    showError(message.message || "LLM failed.");
    setDebug(message.debug);
    if (wasPending) {
      clearLlmOutput();
    }
    setActionsDisabled(false);
  }
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab(button.dataset.tab);
  });
});

providerSelect.addEventListener("change", () => {
  updateProviderWarning();
});

extractBtn.addEventListener("click", () => {
  if (currentState === STATE.extracting || currentState === STATE.calling) {
    return;
  }
  llmPending = false;
  setState(STATE.extracting);
  setActionsDisabled(true);
  clearDebug();
  chrome.runtime.sendMessage({ type: "EXTRACT_CONTENT" });
});

summaryShortBtn.addEventListener("click", () => {
  startLlmRequest({ mode: "summary", summaryLength: "short" });
});

summaryMediumBtn.addEventListener("click", () => {
  startLlmRequest({ mode: "summary", summaryLength: "medium" });
});

summaryDetailedBtn.addEventListener("click", () => {
  startLlmRequest({ mode: "summary", summaryLength: "detailed" });
});

qaSendBtn.addEventListener("click", () => {
  const query = qaInput.value.trim();
  if (!query) {
    showError("Enter a question.");
    return;
  }
  qaInput.value = "";
  startLlmRequest({ mode: "qa", userQuery: query });
});

saveSettingsBtn.addEventListener("click", () => {
  const settings = {
    activeProvider: providerSelect.value,
    summaryDefault: summarySelect.value
  };

  if (geminiKeyInput.value.trim()) {
    settings.geminiKey = geminiKeyInput.value.trim();
  }
  if (claudeKeyInput.value.trim()) {
    settings.claudeKey = claudeKeyInput.value.trim();
  }

  setSettingsStatus("Saving...");
  chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
  geminiKeyInput.value = "";
  claudeKeyInput.value = "";
});

deleteGeminiBtn.addEventListener("click", () => {
  setSettingsStatus("Deleting Gemini key...");
  chrome.runtime.sendMessage({ type: "DELETE_KEY", provider: "gemini" });
  geminiKeyInput.value = "";
});

deleteClaudeBtn.addEventListener("click", () => {
  setSettingsStatus("Deleting Claude key...");
  chrome.runtime.sendMessage({ type: "DELETE_KEY", provider: "claude" });
  claudeKeyInput.value = "";
});

chrome.runtime.onMessage.addListener(handleRuntimeMessage);

setState(STATE.ready);
setActionsDisabled(false);
updateProviderWarning();
clearDebug();
chrome.runtime.sendMessage({ type: "LOAD_SETTINGS" });
