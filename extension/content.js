(function () {
  if (window.__WETHINK_CS_INSTALLED) {
    return;
  }
  window.__WETHINK_CS_INSTALLED = true;

  const MAX_CHARS = 20000;
  const MIN_TEXT_LENGTH = 200;

  function removeNoiseNodes(root) {
    const selectors = "nav,header,footer,aside,script,style,noscript";
    root.querySelectorAll(selectors).forEach((node) => node.remove());
  }

  function getFallbackText(doc) {
    const selectors = ["#content", "main", "article", "#mw-content-text"];
    let best = "";
    selectors.forEach((selector) => {
      const node = doc.querySelector(selector);
      if (node && node.innerText) {
        const text = node.innerText.trim();
        if (text.length > best.length) {
          best = text;
        }
      }
    });
    return best;
  }

  function hashString(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "EXTRACT_CONTENT") {
      return;
    }

    try {
      if (typeof Readability === "undefined") {
        sendResponse({ type: "EXTRACT_ERROR", message: "Readability is not available." });
        return;
      }

      const documentClone = document.cloneNode(true);
      removeNoiseNodes(documentClone);
      const reader = new Readability(documentClone);
      const parsed = reader.parse();

      let rawText = parsed && parsed.textContent ? parsed.textContent : "";
      if (!parsed || rawText.trim().length < MIN_TEXT_LENGTH) {
        const fallbackText = getFallbackText(document);
        if (fallbackText) {
          rawText = fallbackText;
        }
      }

      if (!rawText.trim()) {
        sendResponse({
          type: "EXTRACT_ERROR",
          message: "Unable to extract content from this page."
        });
        return;
      }

      const title = (parsed && parsed.title) || document.title || "";
      const rawLength = rawText.length;
      const truncated = rawLength > MAX_CHARS;
      const textContent = rawText.slice(0, MAX_CHARS);
      const page = {
        url: location.href,
        title,
        textContent,
        excerpt: (parsed && parsed.excerpt) || rawText.trim().slice(0, 200) || undefined,
        lang: (parsed && parsed.lang) || (document.documentElement && document.documentElement.lang) || undefined,
        timestamp: Date.now(),
        hash: hashString(title + textContent),
        truncated,
        rawLength
      };

      sendResponse({ type: "EXTRACT_RESULT", page });
    } catch (error) {
      sendResponse({ type: "EXTRACT_ERROR", message: "Extraction failed." });
    }
  });
})();
