(() => {
  const STATE = (window.__OKLCH_COLOR_CHANGER__ ||= {
    initialized: false,
    listenerRegistered: false,
  });

  const STYLE_ID = CSSScanner.STYLE_ID;
  const { replaceColorsInValue } = OKLCHColorUtils;

  let baseline = null;
  let adjustments = { hue: 0, lightness: 0, chroma: 0 };

  function isNeutral(adj) {
    return adj.hue === 0 && adj.lightness === 0 && adj.chroma === 0;
  }

  function buildOverrideCss(bucket, adj) {
    const cache = new Map();
    const chunks = [];

    for (const rule of bucket.rules) {
      const body = rule.declarations
        .map(({ property, value }) => {
          const next = replaceColorsInValue(value, adj, cache);
          return `  ${property}: ${next} !important;`;
        })
        .join("\n");

      let block = `${rule.selector} {\n${body}\n}`;

      for (let i = rule.mediaStack.length - 1; i >= 0; i -= 1) {
        block = `@media ${rule.mediaStack[i]} {\n${block}\n}`;
      }

      chunks.push(block);
    }

    for (const kf of bucket.keyframes) {
      const body = kf.declarations
        .map(({ property, value }) => {
          const next = replaceColorsInValue(value, adj, cache);
          return `${property}: ${next} !important;`;
        })
        .join(" ");

      chunks.push(`@keyframes ${kf.name} { ${kf.keyText} { ${body} } }`);
    }

    for (const inline of bucket.inlineRules) {
      const body = inline.declarations
        .map(({ property, value }) => {
          const next = replaceColorsInValue(value, adj, cache);
          return `  ${property}: ${next} !important;`;
        })
        .join("\n");

      chunks.push(`${inline.selector} {\n${body}\n}`);
    }

    return chunks.join("\n\n");
  }

  function removeStyleTag(root) {
    const isDocument = root === document;
    const el = isDocument
      ? document.getElementById(STYLE_ID)
      : root.querySelector(`#${STYLE_ID}`);
    el?.remove();
  }

  function removeAllOverrides() {
    removeStyleTag(document);
    for (const shadowRoot of CSSScanner.discoverShadowRoots()) {
      removeStyleTag(shadowRoot);
    }
    chrome.runtime.sendMessage({ type: "APPLY_CSS", css: "" }).catch(() => {});
  }

  function injectStyleTag(root, css) {
    if (!css) return;

    const isDocument = root === document;
    const parent = isDocument ? document.body || document.documentElement : root;

    removeStyleTag(root);

    const styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.dataset.oklchExtension = "true";
    styleEl.textContent = css;
    parent.appendChild(styleEl);
  }

  async function injectMainCss(css) {
    injectStyleTag(document, css);

    try {
      const result = await chrome.runtime.sendMessage({
        type: "APPLY_CSS",
        css: css || "",
      });
      return result || { ok: true, method: "styleTag" };
    } catch (error) {
      return { ok: Boolean(css), method: "styleTag", error: String(error) };
    }
  }

  async function applyOverrides() {
    if (!baseline) return { ok: false, reason: "no baseline" };

    if (isNeutral(adjustments)) {
      removeAllOverrides();
      return { ok: true, cssLength: 0 };
    }

    const docTarget = baseline.targets.find((t) => t.root === document);
    const mainCss = docTarget ? buildOverrideCss(docTarget.bucket, adjustments) : "";

    if (!mainCss) {
      return { ok: false, reason: "empty css" };
    }

    const result = await injectMainCss(mainCss);

    for (const target of baseline.targets) {
      if (target.root === document) continue;
      const css = buildOverrideCss(target.bucket, adjustments);
      injectStyleTag(target.root, css);
    }

    return {
      ok: true,
      cssLength: mainCss.length,
      method: result?.method,
      rules: baseline.merged.rules.length,
    };
  }

  async function rescanCss() {
    removeAllOverrides();
    baseline = await CSSScanner.scanAllCss();
    await applyOverrides();

    return {
      rules: baseline.merged.rules.length,
      keyframes: baseline.merged.keyframes.length,
      inline: baseline.merged.inlineRules.length,
    };
  }

  function getStats() {
    if (!baseline) return null;
    return {
      rules: baseline.merged.rules.length,
      keyframes: baseline.merged.keyframes.length,
      inline: baseline.merged.inlineRules.length,
    };
  }

  function registerMessageListener() {
    if (STATE.listenerRegistered) return;
    STATE.listenerRegistered = true;

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "PING") {
        sendResponse({ ok: true, stats: getStats() });
        return;
      }

      if (message.type === "GET_STATE") {
        sendResponse({ adjustments, stats: getStats() });
        return;
      }

      if (message.type === "SET_ADJUSTMENTS") {
        adjustments = {
          hue: Number(message.adjustments?.hue) || 0,
          lightness: Number(message.adjustments?.lightness) || 0,
          chroma: Number(message.adjustments?.chroma) || 0,
        };

        (async () => {
          if (!baseline) await rescanCss();
          const applied = await applyOverrides();
          sendResponse({ ok: applied.ok, stats: getStats(), applied });
        })();

        return true;
      }

      if (message.type === "RESCAN") {
        rescanCss().then(sendResponse);
        return true;
      }
    });
  }

  async function init() {
    const stored = await chrome.storage.local.get(["oklchAdjustments"]);
    if (stored.oklchAdjustments) {
      adjustments = stored.oklchAdjustments;
    }

    if (document.readyState !== "complete") {
      await new Promise((resolve) => {
        window.addEventListener("load", resolve, { once: true });
      });
    }

    await rescanCss();
  }

  registerMessageListener();

  if (!STATE.initialized) {
    STATE.initialized = true;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => init(), { once: true });
    } else {
      init();
    }
  }
})();
