const CSSScanner = (() => {
  const { isColorProperty, isCustomColorProperty, looksLikeColorValue } =
    OKLCHColorUtils;

  function createBucket() {
    return {
      stylesheetRules: [],
      keyframeRules: [],
      inlineRules: [],
      warnings: [],
    };
  }

  async function fetchStylesheetText(href) {
    try {
      const response = await fetch(href, { credentials: "include" });
      if (!response.ok) return null;
      return await response.text();
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
          if (!looksLikeColorValue(value)) continue;
          declarations.push({
            property,
            value: value.trim(),
            important: rule.style.getPropertyPriority(property) === "important",
          });
        }

        if (declarations.length > 0) {
          bucket.stylesheetRules.push({
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
            if (!looksLikeColorValue(value)) continue;
            declarations.push({
              property,
              value: value.trim(),
              important: keyframe.style.getPropertyPriority(property) === "important",
            });
          }
          if (declarations.length > 0) {
            bucket.keyframeRules.push({
              name: rule.name,
              keyText: keyframe.keyText,
              declarations,
            });
          }
        }
      }
    }
  }

  async function collectFromStylesheet(sheet, bucket) {
    if (!sheet) return;

    try {
      if (sheet.cssRules) {
        walkRules(sheet.cssRules, bucket);
        return;
      }
    } catch {
      // Cross-origin sheet; fall through to fetch/inline parsing.
    }

    const ownerNode = sheet.ownerNode;
    if (ownerNode?.tagName === "STYLE" && ownerNode.textContent) {
      parseCssText(ownerNode.textContent, bucket, "[inline-style-tag]");
      return;
    }

    if (sheet.href) {
      const cssText = await fetchStylesheetText(sheet.href);
      if (cssText) parseCssText(cssText, bucket, sheet.href);
    }
  }

  function parseCssText(cssText, bucket, sourceLabel) {
    const styleEl = document.createElement("style");
    styleEl.textContent = cssText;
    document.documentElement.appendChild(styleEl);
    try {
      walkRules(styleEl.sheet?.cssRules, bucket);
    } catch {
      bucket.warnings.push(`Neuspelo parsiranje: ${sourceLabel}`);
    } finally {
      styleEl.remove();
    }
  }

  function collectInlineStyles(root, bucket) {
    root.querySelectorAll("[style]").forEach((element, index) => {
      const declarations = [];
      for (let i = 0; i < element.style.length; i += 1) {
        const property = element.style[i];
        const isColorProp =
          isColorProperty(property) || isCustomColorProperty(property);
        if (!isColorProp) continue;
        const value = element.style.getPropertyValue(property);
        if (!looksLikeColorValue(value)) continue;
        declarations.push({
          property,
          value: value.trim(),
          important: element.style.getPropertyPriority(property) === "important",
        });
      }

      if (declarations.length === 0) return;

      const marker = element.dataset.oklchInline;
      const inlineIndex = marker ?? `${root === document ? "d" : "s"}-${index}`;

      if (!marker) {
        element.dataset.oklchInline = inlineIndex;
      }

      const selector = element.id
        ? `#${CSS.escape(element.id)}`
        : `[data-oklch-inline="${CSS.escape(inlineIndex)}"]`;

      bucket.inlineRules.push({ selector, element, declarations });
    });
  }

  async function scanRoot(root) {
    const bucket = createBucket();
    const sheets = new Set();

    for (const sheet of root.styleSheets || []) {
      sheets.add(sheet);
    }

    if (root.adoptedStyleSheets) {
      for (const sheet of root.adoptedStyleSheets) {
        sheets.add(sheet);
      }
    }

    root.querySelectorAll("style").forEach((node) => {
      if (node.sheet) sheets.add(node.sheet);
    });

    await Promise.all([...sheets].map((sheet) => collectFromStylesheet(sheet, bucket)));
    collectInlineStyles(root, bucket);

    return bucket;
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

  async function scanDocument() {
    const targets = [{ root: document, bucket: createBucket() }];

    for (const shadowRoot of discoverShadowRoots()) {
      targets.push({ root: shadowRoot, bucket: createBucket() });
    }

    await Promise.all(
      targets.map(async (target) => {
        const scanned = await scanRoot(target.root);
        target.bucket = scanned;
      })
    );

    const merged = createBucket();
    for (const target of targets) {
      merged.stylesheetRules.push(...target.bucket.stylesheetRules);
      merged.keyframeRules.push(...target.bucket.keyframeRules);
      merged.inlineRules.push(...target.bucket.inlineRules);
      merged.warnings.push(...target.bucket.warnings);
    }

    return { targets, merged };
  }

  return { scanDocument };
})();
