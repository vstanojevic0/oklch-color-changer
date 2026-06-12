const hueInput = document.getElementById("hue");
const lightnessInput = document.getElementById("lightness");
const chromaInput = document.getElementById("chroma");
const hueValue = document.getElementById("hue-value");
const lightnessValue = document.getElementById("lightness-value");
const chromaValue = document.getElementById("chroma-value");
const statsEl = document.getElementById("stats");
const resetBtn = document.getElementById("reset");
const rescanBtn = document.getElementById("rescan");

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
    statsEl.textContent = "Nema podataka sa stranice.";
    return;
  }
  statsEl.textContent = `Pronađeno: ${stats.rules} CSS pravila, ${stats.keyframes} keyframe-a, ${stats.inline} inline stilova.`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContent(message) {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    statsEl.textContent =
      "Content script nije aktivan na ovoj stranici. Osveži stranicu pa pokušaj ponovo.";
    return null;
  }
}

async function pushAdjustments() {
  updateOutputs();
  const adjustments = getAdjustments();
  await chrome.storage.local.set({ oklchAdjustments: adjustments });
  await sendToContent({ type: "SET_ADJUSTMENTS", adjustments });
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
  if (response) {
    renderStats(response);
  }
});

loadState();
