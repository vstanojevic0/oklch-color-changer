const OKLCHColorUtils = (() => {
  const COLOR_PROPERTIES = new Set([
    "color",
    "background",
    "background-color",
    "border",
    "border-color",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "outline-color",
    "text-decoration-color",
    "column-rule-color",
    "caret-color",
    "accent-color",
    "fill",
    "stroke",
    "stop-color",
    "flood-color",
    "lighting-color",
    "box-shadow",
    "text-shadow",
    "border-block-color",
    "border-inline-color",
    "border-block-start-color",
    "border-block-end-color",
    "border-inline-start-color",
    "border-inline-end-color",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
    "outline",
    "text-decoration",
    "background-image",
    "list-style",
    "column-rule",
  ]);

  const NON_COLOR_KEYWORDS = new Set([
    "none",
    "inherit",
    "initial",
    "unset",
    "revert",
    "revert-layer",
    "transparent",
    "currentcolor",
    "auto",
    "normal",
  ]);

  let colorCanvasContext = null;

  function getColorContext() {
    if (!colorCanvasContext) {
      const canvas = document.createElement("canvas");
      colorCanvasContext = canvas.getContext("2d");
    }
    return colorCanvasContext;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function srgbToLinear(channel) {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }

  function linearToSrgb(channel) {
    const c = clamp(channel, 0, 1);
    const encoded =
      c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(clamp(encoded, 0, 1) * 255);
  }

  function rgbToOklab(r, g, b) {
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);

    const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

    const lRoot = Math.cbrt(l);
    const mRoot = Math.cbrt(m);
    const sRoot = Math.cbrt(s);

    return {
      L: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
      a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
      b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
    };
  }

  function oklabToRgb(L, a, b) {
    const lRoot = L + 0.3963377774 * a + 0.2158037573 * b;
    const mRoot = L - 0.1055613458 * a - 0.0638541728 * b;
    const sRoot = L - 0.0894841775 * a - 1.291485548 * b;

    const l = lRoot ** 3;
    const m = mRoot ** 3;
    const s = sRoot ** 3;

    return {
      r: linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    };
  }

  function oklabToOklch(L, a, b) {
    const C = Math.sqrt(a * a + b * b);
    let H = (Math.atan2(b, a) * 180) / Math.PI;
    if (H < 0) H += 360;
    return { L, C, H };
  }

  function oklchToOklab(L, C, H) {
    const radians = (H * Math.PI) / 180;
    return {
      L,
      a: C * Math.cos(radians),
      b: C * Math.sin(radians),
    };
  }

  function parseRgbString(value) {
    const match = value.match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;

    const parts = match[1].split(",").map((part) => part.trim());
    const r = Number.parseFloat(parts[0]);
    const g = Number.parseFloat(parts[1]);
    const b = Number.parseFloat(parts[2]);
    const alpha = parts[3] !== undefined ? Number.parseFloat(parts[3]) : 1;

    if ([r, g, b, alpha].some((n) => Number.isNaN(n))) return null;
    return { r, g, b, alpha, original: value };
  }

  function parseHexString(value) {
    const match = value.match(/^#([0-9a-fA-F]{3,8})$/);
    if (!match) return null;

    let hex = match[1];
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((ch) => ch + ch)
        .join("");
    }

    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const alpha = hex.length >= 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;

    if ([r, g, b, alpha].some((n) => Number.isNaN(n))) return null;
    return { r, g, b, alpha, original: value };
  }

  function parseCssColor(value) {
    if (!value || typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || NON_COLOR_KEYWORDS.has(trimmed.toLowerCase())) return null;

    const rgbParsed = parseRgbString(trimmed);
    if (rgbParsed) return rgbParsed;

    const hexParsed = parseHexString(trimmed);
    if (hexParsed) return hexParsed;

    const ctx = getColorContext();
    if (!ctx) return null;

    try {
      ctx.fillStyle = "#010101";
      ctx.fillStyle = trimmed;
    } catch {
      return null;
    }

    const normalized = ctx.fillStyle;
    if (normalized.startsWith("#")) {
      return parseHexString(normalized);
    }
    return parseRgbString(normalized);
  }

  function isTransparent(parsed) {
    return parsed.alpha === 0;
  }

  function transformParsedColor(parsed, adjustments) {
    const lab = rgbToOklab(parsed.r, parsed.g, parsed.b);
    const oklch = oklabToOklch(lab.L, lab.a, lab.b);

    // Uniform shift keeps palette relationships — page reads as one intentional theme.
    const nextL = clamp(oklch.L + adjustments.lightness / 100, 0, 1);
    const nextC = clamp(
      oklch.C * (1 + adjustments.chroma / 100),
      0,
      0.4
    );
    let nextH = oklch.H + adjustments.hue;
    nextH = ((nextH % 360) + 360) % 360;

    const nextLab = oklchToOklab(nextL, nextC, nextH);
    const rgb = oklabToRgb(nextLab.L, nextLab.a, nextLab.b);

    if (parsed.alpha < 1) {
      return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${parsed.alpha})`;
    }
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }

  function transformColor(originalValue, adjustments) {
    const parsed = parseCssColor(originalValue);
    if (!parsed || isTransparent(parsed)) return originalValue;
    return transformParsedColor(parsed, adjustments);
  }

  const COLOR_PATTERN =
    /(?:oklch|oklab|lab|lch|hsl|hwb|rgb|rgba|color)\([^)]+\)|#(?:[0-9a-fA-F]{3,8})\b|\b[a-zA-Z]+\b/;

  function replaceColorsInValue(value, adjustments, cache) {
    if (!value || typeof value !== "string") return value;
    const lower = value.toLowerCase();
    if (NON_COLOR_KEYWORDS.has(lower)) return value;

    return value.replace(new RegExp(COLOR_PATTERN.source, "g"), (token) => {
      const parsed = parseCssColor(token);
      if (!parsed || isTransparent(parsed)) return token;

      const key = `${token}::${adjustments.hue}:${adjustments.lightness}:${adjustments.chroma}`;
      if (cache.has(key)) return cache.get(key);

      const transformed = transformParsedColor(parsed, adjustments);
      cache.set(key, transformed);
      return transformed;
    });
  }

  function isColorProperty(property) {
    return COLOR_PROPERTIES.has(property.toLowerCase());
  }

  function looksLikeColorValue(value) {
    if (!value || typeof value !== "string") return false;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || NON_COLOR_KEYWORDS.has(trimmed)) return false;
    if (parseCssColor(trimmed)) return true;
    return COLOR_PATTERN.test(trimmed);
  }

  function isCustomColorProperty(property) {
    return property.startsWith("--");
  }

  function isTransformableValue(value, property) {
    if (!value || typeof value !== "string") return false;
    const trimmed = value.trim();
    if (!trimmed || NON_COLOR_KEYWORDS.has(trimmed.toLowerCase())) return false;

    if (property.startsWith("--")) {
      return looksLikeColorValue(trimmed);
    }

    if (/^var\s*\(/i.test(trimmed)) return false;

    return looksLikeColorValue(trimmed);
  }

  return {
    COLOR_PROPERTIES,
    isColorProperty,
    isCustomColorProperty,
    isTransformableValue,
    looksLikeColorValue,
    transformColor,
    replaceColorsInValue,
    parseCssColor,
  };
})();
