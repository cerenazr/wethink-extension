const tabButtons = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");
const extractBtn = document.getElementById("extractBtn");
const statusLine = document.getElementById("statusLine");
const resultTitle = document.getElementById("resultTitle");
const resultPreview = document.getElementById("resultPreview");
const llmResultText = document.getElementById("llmResultText");
const snippetList = document.getElementById("snippetList");
const providerWarning = document.getElementById("providerWarning");
const apiKeyWarning = document.getElementById("apiKeyWarning");
const truncationWarning = document.getElementById("truncationWarning");
const copySummaryBtn = document.getElementById("copySummary");
const copySnippetsBtn = document.getElementById("copySnippets");
const copySummaryStatus = document.getElementById("copySummaryStatus");
const copySnippetsStatus = document.getElementById("copySnippetsStatus");
const llmDebug = document.getElementById("llmDebug");
const llmDebugText = document.getElementById("llmDebugText");

const summaryShortBtn = document.getElementById("summaryShort");
const summaryMediumBtn = document.getElementById("summaryMedium");
const summaryDetailedBtn = document.getElementById("summaryDetailed");
const qaInput = document.getElementById("qaInput");
const qaSendBtn = document.getElementById("qaSend");
const contentSourceSelect = document.getElementById("contentSource");
const useSelectionBtn = document.getElementById("useSelection");
const selectionTextArea = document.getElementById("selectionText");
const selectionWarning = document.getElementById("selectionWarning");
const autoSelectionSelect = document.getElementById("autoSelectionEnabled");

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
let apiKeyWarningActive = false;
let currentSettings = {};
let copyStatusTimeoutId = null;
let lastExtractedPage = null;

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

function setProgress(message) {
  if (errorTimeoutId) {
    clearTimeout(errorTimeoutId);
    errorTimeoutId = null;
  }
  currentState = STATE.calling;
  statusLine.textContent = message || STATUS_TEXT.calling;
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

function showSelectionWarning(message) {
  if (!selectionWarning) {
    return;
  }
  selectionWarning.textContent = message;
  selectionWarning.hidden = false;
}

function hideSelectionWarning() {
  if (!selectionWarning) {
    return;
  }
  selectionWarning.hidden = true;
}

function showCopyStatus(target) {
  if (!target) {
    return;
  }
  if (copyStatusTimeoutId) {
    clearTimeout(copyStatusTimeoutId);
  }
  target.hidden = false;
  copyStatusTimeoutId = setTimeout(() => {
    target.hidden = true;
  }, 1500);
}

async function copyTextToClipboard(text) {
  if (!text) {
    return false;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // Fall through to legacy copy method.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  let success = false;
  try {
    success = document.execCommand("copy");
  } catch (_) {
    success = false;
  }
  document.body.removeChild(textarea);
  return success;
}

function hasKeyForProvider(provider) {
  if (provider === "claude") {
    return Boolean(currentSettings.claudeKey);
  }
  return Boolean(currentSettings.geminiKey);
}

function showApiKeyWarning() {
  apiKeyWarningActive = true;
  if (!apiKeyWarning) {
    return;
  }
  apiKeyWarning.textContent = "Please set your API key in Settings";
  apiKeyWarning.hidden = false;
}

function hideApiKeyWarning() {
  apiKeyWarningActive = false;
  if (!apiKeyWarning) {
    return;
  }
  apiKeyWarning.hidden = true;
}

function refreshApiKeyWarning() {
  if (!apiKeyWarning || !apiKeyWarningActive) {
    return;
  }
  if (hasKeyForProvider(providerSelect.value)) {
    hideApiKeyWarning();
    return;
  }
  apiKeyWarning.textContent = "Please set your API key in Settings";
  apiKeyWarning.hidden = false;
}

function updateExtractResult(page) {
  lastExtractedPage = page;
  resultTitle.textContent = page.title || "Untitled page";
  const preview = page.textContent ? page.textContent.slice(0, 500) : "";
  resultPreview.textContent = preview || "No preview available.";
  setTruncationWarning(Boolean(page.truncated));
}

function setTruncationWarning(isTruncated) {
  if (!truncationWarning) {
    return;
  }
  truncationWarning.hidden = !isTruncated;
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
  currentSettings = { ...currentSettings, ...settings };
  if (autoSelectionSelect) {
    const enabled =
      typeof settings.autoSelectionEnabled === "boolean"
        ? settings.autoSelectionEnabled
        : true;
    autoSelectionSelect.value = enabled ? "on" : "off";
  }
  providerSelect.value = settings.activeProvider || "gemini";
  summarySelect.value = settings.summaryDefault || "short";

  const hasGeminiKey = Boolean(settings.geminiKey);
  const hasClaudeKey = Boolean(settings.claudeKey);
  geminiKeyStatus.textContent = hasGeminiKey ? "Stored." : "Not set.";
  claudeKeyStatus.textContent = hasClaudeKey ? "Stored." : "Not set.";
  updateProviderWarning();
  refreshApiKeyWarning();
}

function startLlmRequest(payload) {
  if (!hasKeyForProvider(providerSelect.value)) {
    showApiKeyWarning();
    setActiveTab("settings");
    setSettingsStatus("Please set your API key.");
    return false;
  }
  const source = contentSourceSelect ? contentSourceSelect.value : "page";
  const selectionText = selectionTextArea ? selectionTextArea.value.trim() : "";
  if (source === "selection") {
    if (!selectionText) {
      showSelectionWarning("Select text on the page first.");
      return false;
    }
  } else {
    hideSelectionWarning();
  }
  if (currentState === STATE.extracting || currentState === STATE.calling) {
    return false;
  }
  llmPending = source !== "selection";
  setState(source === "selection" ? STATE.calling : STATE.extracting);
  setActionsDisabled(true);
  llmResultText.textContent = "Waiting for response...";
  renderSnippets([]);
  clearDebug();
  chrome.runtime.sendMessage({
    type: "LLM_REQUEST",
    provider: providerSelect.value,
    source,
    selectionText: source === "selection" ? selectionText : undefined,
    title: source === "selection" && lastExtractedPage ? lastExtractedPage.title : undefined,
    url: source === "selection" && lastExtractedPage ? lastExtractedPage.url : undefined,
    ...payload
  });
  return true;
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
    setTruncationWarning(false);
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

  if (message.type === "LLM_PROGRESS") {
    setProgress(message.message || "Summarizing...");
    return;
  }

  if (message.type === "WETHINK_SELECTION_CHANGED") {
    if (autoSelectionSelect && autoSelectionSelect.value !== "on") {
      return;
    }
    const selectionText = (message.selectionText || "").trim();
    if (!selectionText) {
      return;
    }
    if (selectionTextArea) {
      selectionTextArea.value = selectionText;
    }
    hideSelectionWarning();
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
  refreshApiKeyWarning();
});

extractBtn.addEventListener("click", () => {
  if (currentState === STATE.extracting || currentState === STATE.calling) {
    return;
  }
  llmPending = false;
  setState(STATE.extracting);
  setActionsDisabled(true);
  setTruncationWarning(false);
  clearDebug();
  chrome.runtime.sendMessage({ type: "EXTRACT_CONTENT", force: true });
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
  if (startLlmRequest({ mode: "qa", userQuery: query })) {
    qaInput.value = "";
  }
});

copySummaryBtn.addEventListener("click", async () => {
  const text = llmResultText.textContent || "";
  const ok = await copyTextToClipboard(text);
  if (ok) {
    showCopyStatus(copySummaryStatus);
  }
});

copySnippetsBtn.addEventListener("click", async () => {
  const snippets = Array.from(snippetList.querySelectorAll("li"))
    .map((item) => item.textContent || "")
    .filter(Boolean)
    .join("\n");
  const ok = await copyTextToClipboard(snippets);
  if (ok) {
    showCopyStatus(copySnippetsStatus);
  }
});

useSelectionBtn.addEventListener("click", () => {
  hideSelectionWarning();
  chrome.runtime.sendMessage({ type: "WETHINK_FETCH_SELECTION" }, (response) => {
    const runtimeError = chrome.runtime.lastError;
    const selectionText = response && response.selectionText ? response.selectionText : "";
    if (selectionTextArea) {
      selectionTextArea.value = selectionText;
    }
    if (runtimeError) {
      showSelectionWarning("Select text on the page first.");
      return;
    }
    if (!selectionText) {
      showSelectionWarning("Select text on the page first.");
      return;
    }
  });
});

saveSettingsBtn.addEventListener("click", () => {
  const settings = {
    activeProvider: providerSelect.value,
    summaryDefault: summarySelect.value,
    autoSelectionEnabled: autoSelectionSelect ? autoSelectionSelect.value === "on" : true
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
