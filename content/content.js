(() => {
  const STYLE_ID = "oklch-color-changer-overrides";
  const { replaceColorsInValue } = OKLCHColorUtils;

  let scanResult = null;
  let adjustments = { hue: 0, lightness: 0, chroma: 0 };
  let rescanTimer = null;

  function isNeutral(currentAdjustments) {
    return (
      currentAdjustments.hue === 0 &&
      currentAdjustments.lightness === 0 &&
      currentAdjustments.chroma === 0
    );
  }

  function ensureOverrideElement(root) {
    const isDocument = root === document;
    const parent = isDocument
      ? document.body || document.documentElement
      : root;

    let styleEl = isDocument
      ? document.getElementById(STYLE_ID)
      : root.querySelector(`#${STYLE_ID}`);

    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      styleEl.dataset.oklchExtension = "true";
      parent.appendChild(styleEl);
    } else if (styleEl.parentNode !== parent) {
      parent.appendChild(styleEl);
    }

    return styleEl;
  }

  function buildStylesheetCss(bucket, currentAdjustments) {
    const cache = new Map();
    const chunks = [];

    for (const rule of bucket.stylesheetRules) {
      const body = rule.declarations
        .map(({ property, value }) => {
          const nextValue = replaceColorsInValue(value, currentAdjustments, cache);
          return `  ${property}: ${nextValue} !important;`;
        })
        .join("\n");

      if (rule.mediaStack.length > 0) {
        let wrapped = `${rule.selector} {\n${body}\n}`;
        for (let i = rule.mediaStack.length - 1; i >= 0; i -= 1) {
          wrapped = `@media ${rule.mediaStack[i]} {\n${wrapped}\n}`;
        }
        chunks.push(wrapped);
      } else {
        chunks.push(`${rule.selector} {\n${body}\n}`);
      }
    }

    for (const rule of bucket.keyframeRules) {
      const body = rule.declarations
        .map(({ property, value }) => {
          const nextValue = replaceColorsInValue(value, currentAdjustments, cache);
          return `  ${property}: ${nextValue} !important;`;
        })
        .join("\n");
      chunks.push(
        `@keyframes ${rule.name} { ${rule.keyText} { ${body.replace(/\n/g, " ")} } }`
      );
    }

    return chunks.join("\n\n");
  }

  function applyInlineOverrides(bucket, currentAdjustments) {
    const cache = new Map();
    const neutral = isNeutral(currentAdjustments);

    for (const rule of bucket.inlineRules) {
      if (!rule.element?.isConnected) continue;
      for (const { property, value, important } of rule.declarations) {
        if (neutral) {
          rule.element.style.setProperty(
            property,
            value,
            important ? "important" : ""
          );
        } else {
          const nextValue = replaceColorsInValue(value, currentAdjustments, cache);
          rule.element.style.setProperty(property, nextValue, "important");
        }
      }
    }
  }

  function applyAdjustments() {
    if (!scanResult) return;

    const neutral = isNeutral(adjustments);

    for (const target of scanResult.targets) {
      const styleEl = ensureOverrideElement(target.root);
      styleEl.textContent = neutral
        ? ""
        : buildStylesheetCss(target.bucket, adjustments);
      applyInlineOverrides(target.bucket, adjustments);
    }
  }

  async function rescanAndApply() {
    scanResult = await CSSScanner.scanDocument();
    applyAdjustments();
    const { merged } = scanResult;
    return {
      rules: merged.stylesheetRules.length,
      keyframes: merged.keyframeRules.length,
      inline: merged.inlineRules.length,
      warnings: merged.warnings.length,
    };
  }

  function scheduleRescan() {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
      rescanAndApply();
    }, 400);
  }

  function observeDomChanges() {
    const observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => {
        if (mutation.type === "attributes" && mutation.attributeName === "style") {
          return true;
        }
        return mutation.type === "childList";
      });
      if (relevant) scheduleRescan();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "href"],
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "GET_STATE") {
      sendResponse({
        adjustments,
        stats: scanResult
          ? {
              rules: scanResult.merged.stylesheetRules.length,
              keyframes: scanResult.merged.keyframeRules.length,
              inline: scanResult.merged.inlineRules.length,
            }
          : null,
      });
      return;
    }

    if (message.type === "SET_ADJUSTMENTS") {
      adjustments = {
        hue: Number(message.adjustments?.hue) || 0,
        lightness: Number(message.adjustments?.lightness) || 0,
        chroma: Number(message.adjustments?.chroma) || 0,
      };
      applyAdjustments();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "RESCAN") {
      rescanAndApply().then(sendResponse);
      return true;
    }
  });

  async function init() {
    const stored = await chrome.storage.local.get(["oklchAdjustments"]);
    if (stored.oklchAdjustments) {
      adjustments = stored.oklchAdjustments;
    }

    await rescanAndApply();
    observeDomChanges();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
