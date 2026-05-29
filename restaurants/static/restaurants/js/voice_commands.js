window.KainTayoVoice = (() => {
  function chooseSpeechLocale() {
    const lang = String(navigator.language || "").toLowerCase();
    if (lang.startsWith("fil") || lang.startsWith("tl")) return "fil-PH";
    return "en-US";
  }

  function normalize(value = "") {
    const lowered = String(value || "").trim().toLowerCase();
    const replacements = [
      [/\bhanap\b/gi, "search"],
      [/\bmalapit\s+sa\s+akin\b/gi, "near me"],
      [/\bmalapit\b/gi, "near"],
      [/\bbukas\s+ngayon\b/gi, "open now"],
      [/\bpunta\s+sa\b/gi, "go to"],
      [/\bpaborito\b/gi, "saved places"],
      [/\bsaved\s+places\b/gi, "saved places"],
      [/\bfavorites\b/gi, "favorites"],
      [/\bmas\s+mura\b/gi, "cheaper casual"],
      [/\bsamgyup\b/gi, "samgyupsal"],
    ];
    return replacements
      .reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), lowered)
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function commandFor(transcript = "") {
    const text = normalize(transcript);
    if (!text) return { action: "empty", text };
    if (/^(clear|clear search|reset search)$/.test(text)) return { action: "clear", text };
    if (/\b(show|open|go to)?\s*(saved places|favorites)\b/.test(text)) {
      return { action: "navigate", url: "/favorites/", text };
    }
    if (/^(nearby|near me|near)$/.test(text) || /\b(show|open|go to)\s+(nearby|near me|near)\b/.test(text)) {
      return { action: "navigate", url: "/nearby/", text };
    }
    if (/\b(go to|open)?\s*(ai chat|ai search)\b/.test(text)) {
      return { action: "navigate", url: "/ai-search/", text };
    }
    if (/^(go home|open home|home)$/.test(text)) {
      return { action: "navigate", url: "/", text };
    }
    const searchText = text.replace(/^\b(search|find)\b\s*/, "").trim();
    return { action: "search", text: searchText || text };
  }

  return { chooseSpeechLocale, normalize, commandFor };
})();
