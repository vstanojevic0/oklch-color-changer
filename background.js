const tabCssStore = new Map();

chrome.tabs.onRemoved.addListener((tabId) => {
  tabCssStore.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FETCH_CSS") {
    fetch(message.url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => sendResponse({ text }))
      .catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type !== "APPLY_CSS") return;

  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ ok: false, error: "No tab id" });
    return;
  }

  const previousCss = tabCssStore.get(tabId);

  const removePrevious = previousCss
    ? chrome.scripting.removeCSS({ target: { tabId }, css: previousCss }).catch(() => {})
    : Promise.resolve();

  removePrevious.then(() => {
    if (!message.css) {
      tabCssStore.delete(tabId);
      sendResponse({ ok: true });
      return;
    }

    chrome.scripting
      .insertCSS({ target: { tabId }, css: message.css })
      .then(() => {
        tabCssStore.set(tabId, message.css);
        sendResponse({ ok: true, method: "insertCSS" });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });
  });

  return true;
});
