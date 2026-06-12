const CSSScanner = (() => {
  const { isColorProperty, isCustomColorProperty, isTransformableValue } =
    OKLCHColorUtils;

  const STYLE_ID = "oklch-color-changer-overrides";

  function isExtensionNode(node) {
    if (!(node instanceof Element)) return false;
    return node.id === STYLE_ID || node.dataset?.oklchExtension === "true";
  }

  function createBucket() {
    return { rules: [], keyframes: [], inlineRules: [] };
  }

  async function fetchStylesheetText(href) {
    try {
      const response = await fetch(href, { credentials: "include" });
      if (response.ok) return await response.text();
    } catch {
      // Try extension background fetch (no page CORS).
    }

    try {
      const result = await chrome.runtime.sendMessage({
        type: "FETCH_CSS",
        url: href,
      });
      return result?.text || null;
    } catch {
      return null;
    }
  }

  function walkRules(rules, bucket, mediaStack = []) {
    if (!rules) return;

    for (const rule of rules) {
      if (rule.type === CSSRule.STYLE_RULE) {
        const declarations = [];

        for (let i = 0; i < rule.style.length; i += 1) {
          const property = rule.style[i];
          const isColorProp =
            isColorProperty(property) || isCustomColorProperty(property);
          if (!isColorProp) continue;

          const value = rule.style.getPropertyValue(property);
          if (!isTransformableValue(value, property)) continue;

          declarations.push({ property, value: value.trim() });
        }

        if (declarations.length > 0 && rule.selectorText) {
          bucket.rules.push({
            selector: rule.selectorText,
            declarations,
            mediaStack: [...mediaStack],
          });
        }
      } else if (rule.type === CSSRule.MEDIA_RULE) {
        walkRules(rule.cssRules, bucket, [...mediaStack, rule.conditionText]);
      } else if (
        rule.type === CSSRule.SUPPORTS_RULE ||
        rule.type === CSSRule.LAYER_BLOCK_RULE ||
        rule.type === CSSRule.CONTAINER_RULE
      ) {
        walkRules(rule.cssRules, bucket, mediaStack);
      } else if (rule.type === CSSRule.KEYFRAMES_RULE) {
        for (const keyframe of rule.cssRules) {
          if (keyframe.type !== CSSRule.KEYFRAME_RULE) continue;

          const declarations = [];
          for (let i = 0; i < keyframe.style.length; i += 1) {
            const property = keyframe.style[i];
            const isColorProp =
              isColorProperty(property) || isCustomColorProperty(property);
            if (!isColorProp) continue;

            const value = keyframe.style.getPropertyValue(property);
            if (!isTransformableValue(value, property)) continue;

            declarations.push({ property, value: value.trim() });
          }

          if (declarations.length > 0) {
            bucket.keyframes.push({
              name: rule.name,
              keyText: keyframe.keyText,
              declarations,
            });
          }
        }
      }
    }
  }

  function parseCssText(cssText, bucket) {
    if (!cssText) return;

    const styleEl = document.createElement("style");
    styleEl.textContent = cssText;
    document.documentElement.appendChild(styleEl);
    try {
      walkRules(styleEl.sheet?.cssRules, bucket);
    } finally {
      styleEl.remove();
    }
  }

  async function collectFromStylesheet(sheet, bucket) {
    if (!sheet) return;

    try {
      if (sheet.cssRules) {
        walkRules(sheet.cssRules, bucket);
      }
    } catch {
      // Cross-origin — fetch below.
    }

    const ownerNode = sheet.ownerNode;
    if (ownerNode?.tagName === "STYLE" && ownerNode.textContent) {
      parseCssText(ownerNode.textContent, bucket);
      return;
    }

    if (sheet.href) {
      const cssText = await fetchStylesheetText(sheet.href);
      parseCssText(cssText, bucket);
    }
  }

  function collectInlineStyles(root, bucket, inlineState) {
    root.querySelectorAll("[style]").forEach((element) => {
      if (isExtensionNode(element)) return;

      const declarations = [];
      for (let i = 0; i < element.style.length; i += 1) {
        const property = element.style[i];
        const isColorProp =
          isColorProperty(property) || isCustomColorProperty(property);
        if (!isColorProp) continue;

        const value = element.style.getPropertyValue(property);
        if (!isTransformableValue(value, property)) continue;

        declarations.push({
          property,
          value: value.trim(),
          important: element.style.getPropertyPriority(property) === "important",
        });
      }

      if (declarations.length === 0) return;

      let selector;
      if (element.id) {
        selector = `#${CSS.escape(element.id)}`;
      } else {
        inlineState.counter += 1;
        selector = `[data-oklch-inline="${inlineState.counter}"]`;
        element.setAttribute("data-oklch-inline", String(inlineState.counter));
      }

      bucket.inlineRules.push({ selector, declarations });
    });
  }

  function isSelectorValid(selector) {
    try {
      document.querySelector(selector);
      return true;
    } catch {
      return false;
    }
  }

  function dedupeRules(bucket) {
    const seen = new Set();

    bucket.rules = bucket.rules.filter((rule) => {
      if (!isSelectorValid(rule.selector)) return false;
      const key = `${rule.mediaStack.join("|")}::${rule.selector}::${rule.declarations
        .map((d) => `${d.property}:${d.value}`)
        .join(";")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function scanRoot(root) {
    const bucket = createBucket();
    const sheets = new Set();
    const inlineState = { counter: 0 };

    for (const sheet of root.styleSheets || []) {
      sheets.add(sheet);
    }

    if (root.adoptedStyleSheets) {
      for (const sheet of root.adoptedStyleSheets) {
        sheets.add(sheet);
      }
    }

    root.querySelectorAll("style").forEach((node) => {
      if (!isExtensionNode(node) && node.sheet) sheets.add(node.sheet);
    });

    if (root === document) {
      document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
        if (link.sheet) sheets.add(link.sheet);
      });
    }

    await Promise.all([...sheets].map((sheet) => collectFromStylesheet(sheet, bucket)));
    collectInlineStyles(root, bucket, inlineState);
    dedupeRules(bucket);

    return { root, bucket };
  }

  function discoverShadowRoots() {
    const shadowRoots = [];
    const stack = [document.documentElement];

    while (stack.length > 0) {
      const node = stack.pop();
      node.querySelectorAll("*").forEach((child) => {
        if (child.shadowRoot) {
          shadowRoots.push(child.shadowRoot);
          stack.push(child.shadowRoot);
        }
      });
    }

    return shadowRoots;
  }

  async function scanAllCss() {
    const targets = [document];

    for (const shadowRoot of discoverShadowRoots()) {
      targets.push(shadowRoot);
    }

    const scanned = await Promise.all(targets.map((root) => scanRoot(root)));

    const merged = createBucket();
    for (const { bucket } of scanned) {
      merged.rules.push(...bucket.rules);
      merged.keyframes.push(...bucket.keyframes);
      merged.inlineRules.push(...bucket.inlineRules);
    }

    return { targets: scanned, merged };
  }

  return { scanAllCss, discoverShadowRoots, STYLE_ID };
})();
