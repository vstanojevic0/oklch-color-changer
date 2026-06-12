const hueInput = document.getElementById("hue");
const lightnessInput = document.getElementById("lightness");
const chromaInput = document.getElementById("chroma");
const hueValue = document.getElementById("hue-value");
const lightnessValue = document.getElementById("lightness-value");
const chromaValue = document.getElementById("chroma-value");
const statsEl = document.getElementById("stats");
const resetBtn = document.getElementById("reset");
const rescanBtn = document.getElementById("rescan");

const CONTENT_SCRIPTS = [
  "content/color-utils.js",
  "content/css-scanner.js",
  "content/content.js",
];

function getAdjustments() {
  return {
    hue: Number(hueInput.value),
    lightness: Number(lightnessInput.value),
    chroma: Number(chromaInput.value),
  };
}

function updateOutputs() {
  hueValue.textContent = `${hueInput.value}°`;
  lightnessValue.textContent = lightnessInput.value;
  chromaValue.textContent = chromaInput.value;
}

function renderStats(stats) {
  if (!stats) {
    statsEl.textContent = "Osveži stranicu (F5) pa otvori popup.";
    return;
  }
  if (stats.rules === 0 && stats.inline === 0) {
    statsEl.textContent = "0 CSS boja — sajt koristi samo var() ili blokirane stylesheet-ove.";
    return;
  }
  statsEl.textContent = `${stats.rules} CSS pravila, ${stats.inline} inline. Pomeri Hue.`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function injectContentScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPTS,
  });

  for (let i = 0; i < 30; i += 1) {
    try {
      const ping = await chrome.tabs.sendMessage(tabId, { type: "PING" });
      if (ping?.ok) return true;
    } catch {
      // waiting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function sendToContent(message) {
  const tab = await getActiveTab();
  if (!tab?.id) return null;

  const url = tab.url || "";
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
    statsEl.textContent = "Ne radi na internim stranicama.";
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    const ready = await injectContentScripts(tab.id);
    if (!ready) {
      statsEl.textContent = "Osveži stranicu (F5).";
      return null;
    }
    return await chrome.tabs.sendMessage(tab.id, message);
  }
}

async function pushAdjustments() {
  updateOutputs();
  const adjustments = getAdjustments();
  await chrome.storage.local.set({ oklchAdjustments: adjustments });
  const response = await sendToContent({ type: "SET_ADJUSTMENTS", adjustments });
  if (response?.stats) renderStats(response.stats);
  if (response?.applied?.reason === "empty css") {
    statsEl.textContent = "CSS skeniran ali nema transformabilnih boja. Klikni Ponovo skeniraj.";
  } else if (response?.applied && response.applied.ok === false) {
    statsEl.textContent = `Greška: ${response.applied.reason || "primena nije uspela"}`;
  }
}

async function loadState() {
  const stored = await chrome.storage.local.get(["oklchAdjustments"]);
  const adjustments = stored.oklchAdjustments || { hue: 0, lightness: 0, chroma: 0 };

  hueInput.value = adjustments.hue;
  lightnessInput.value = adjustments.lightness;
  chromaInput.value = adjustments.chroma;
  updateOutputs();

  const response = await sendToContent({ type: "GET_STATE" });
  if (response?.stats) renderStats(response.stats);

  if (adjustments.hue !== 0 || adjustments.lightness !== 0 || adjustments.chroma !== 0) {
    await pushAdjustments();
  }
}

[hueInput, lightnessInput, chromaInput].forEach((input) => {
  input.addEventListener("input", pushAdjustments);
});

resetBtn.addEventListener("click", async () => {
  hueInput.value = "0";
  lightnessInput.value = "0";
  chromaInput.value = "0";
  await pushAdjustments();
});

rescanBtn.addEventListener("click", async () => {
  statsEl.textContent = "Skeniram CSS…";
  const response = await sendToContent({ type: "RESCAN" });
  if (response) renderStats(response);
});

loadState();
