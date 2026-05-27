const aiChatForm = document.getElementById("aiChatForm");
const aiQueryInput = document.getElementById("aiQueryInput");
const aiSearchBtn = document.getElementById("aiSearchBtn");
const aiVoiceBtn = document.getElementById("aiVoiceBtn");
const aiStatus = document.getElementById("aiStatus");
const aiQuota = document.getElementById("aiQuota");
const aiChatLog = document.getElementById("aiChatLog");
const aiPromptChips = document.querySelectorAll(".ai-prompt-chip");
const aiOnboardingMount = document.getElementById("aiOnboardingMount");
const APP_TIPS_DISMISSED_KEY = "kainTayoTipsDismissedV1";

let aiBusy = false;
let lastRunAt = 0;
const MIN_GAP_MS = 3500;
const messages = [];

function getCookie(name) {
  const cookies = document.cookie ? document.cookie.split(";") : [];
  for (let index = 0; index < cookies.length; index += 1) {
    const cookie = cookies[index].trim();
    if (cookie.startsWith(`${name}=`)) {
      return decodeURIComponent(cookie.slice(name.length + 1));
    }
  }
  return "";
}

function cleanText(value = "") {
  return String(value)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function setAiStatus(message = "") {
  if (aiStatus) {
    aiStatus.textContent = message;
  }
}

function looksLikeSummaryText(value = "") {
  const text = cleanText(value);
  if (!text) return true;
  const lower = text.toLowerCase();
  const starters = [
    "discover ",
    "here are ",
    "these ",
    "this ",
    "the best ",
    "top spots ",
    "top picks ",
    "best places ",
    "for your "
  ];
  return (
    starters.some((starter) => lower.startsWith(starter)) ||
    text.split(/\s+/).length > 10 ||
    text.length > 90 ||
    (text.endsWith(".") && text.split(/\s+/).length > 4)
  );
}

function hasUsefulBusinessName(row) {
  const name = cleanText(row.name || "");
  if (!name || row.name.toUpperCase() === "RESTAURANT" || row.name.includes('"summary"')) {
    return false;
  }
  const genericNames = new Set(["restaurant", "food", "chicken", "top picks", "best chicken"]);
  if (genericNames.has(name.toLowerCase())) {
    return false;
  }
  if (looksLikeSummaryText(name)) {
    return false;
  }
  return Boolean(row.why || row.highlights || row.vibe || row.address || row.area || row.ratingHint);
}

function dismissAiOnboarding() {
  localStorage.setItem(APP_TIPS_DISMISSED_KEY, "1");
  if (aiOnboardingMount) {
    aiOnboardingMount.innerHTML = "";
  }
}

function mountAiOnboarding() {
  if (!aiOnboardingMount) return;
  const dismissed = localStorage.getItem(APP_TIPS_DISMISSED_KEY) === "1";
  if (dismissed) {
    aiOnboardingMount.innerHTML = "";
    return;
  }

  aiOnboardingMount.innerHTML = `
    <aside class="onboarding-card" role="note" aria-label="AI search tips">
      <button id="aiOnboardingCloseBtn" class="onboarding-close" type="button" aria-label="Close tips">X</button>
      <h3>AI tips</h3>
      <ul>
        <li>Ask like you are messaging a food-savvy friend.</li>
        <li>Add an area, budget, cuisine, or vibe for sharper picks.</li>
      </ul>
      <div class="onboarding-actions">
        <button id="aiOnboardingDismissBtn" class="btn primary" type="button">Got it</button>
        <button id="aiOnboardingLaterBtn" class="btn ghost" type="button">Maybe later</button>
      </div>
    </aside>
  `;

  aiOnboardingMount.querySelector("#aiOnboardingCloseBtn")?.addEventListener("click", dismissAiOnboarding);
  aiOnboardingMount.querySelector("#aiOnboardingDismissBtn")?.addEventListener("click", dismissAiOnboarding);
  aiOnboardingMount.querySelector("#aiOnboardingLaterBtn")?.addEventListener("click", dismissAiOnboarding);
}

function scrollChatToBottom() {
  if (!aiChatLog) return;
  aiChatLog.scrollTop = aiChatLog.scrollHeight;
}

function createMessageShell(role, { loading = false } = {}) {
  const message = document.createElement("article");
  message.className = `chat-message ${role === "user" ? "chat-message-user" : "chat-message-assistant"}`;

  const avatar = document.createElement("span");
  avatar.className = "chat-avatar";
  avatar.textContent = role === "user" ? "You" : "AI";

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble${loading ? " chat-bubble-loading" : ""}`;

  message.appendChild(avatar);
  message.appendChild(bubble);
  aiChatLog.appendChild(message);
  scrollChatToBottom();
  return { message, bubble };
}

function appendUserMessage(text) {
  messages.push({ role: "user", text });
  const { bubble } = createMessageShell("user");
  bubble.textContent = text;
}

function appendAssistantWelcome() {
  const { bubble } = createMessageShell("assistant");
  const title = document.createElement("strong");
  title.textContent = "What are you craving?";
  const copy = document.createElement("p");
  copy.textContent = "Tell me the dish, budget, location, or mood, and I will look for grounded suggestions.";
  bubble.appendChild(title);
  bubble.appendChild(copy);
}

function appendLoadingBubble() {
  const { message, bubble } = createMessageShell("assistant", { loading: true });
  bubble.innerHTML = `
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
  `;
  return message;
}

function cleanedResultRows(items) {
  return (items || [])
    .map((item) => ({
      name: cleanText(item.name || ""),
      group: cleanText(item.group || ""),
      category: cleanText(item.category || "restaurant"),
      area: cleanText(item.area || ""),
      why: cleanText(item.why || ""),
      vibe: cleanText(item.vibe || ""),
      highlights: cleanText(item.highlights || ""),
      address: cleanText(item.address || ""),
      ratingHint: cleanText(item.rating_hint || ""),
      reviewHint: cleanText(item.review_hint || ""),
      hoursHint: cleanText(item.hours_hint || ""),
      priceHint: cleanText(item.price_hint || ""),
      sourceUrl: cleanText(item.source_url || ""),
    }))
    .filter(hasUsefulBusinessName);
}

function appendInfoLine(card, label, value) {
  if (!value) return;
  const line = document.createElement("p");
  line.className = "chat-result-detail";
  const labelNode = document.createElement("strong");
  labelNode.textContent = `${label}: `;
  line.appendChild(labelNode);
  line.append(document.createTextNode(value));
  card.appendChild(line);
}

function buildResultCard(row) {
  const card = document.createElement("article");
  card.className = "chat-result-card";

  const meta = [
    row.ratingHint,
    row.reviewHint,
    row.priceHint,
    row.category,
    row.area
  ].filter(Boolean).join(" | ");
  const title = document.createElement("h3");
  title.textContent = row.name;
  card.appendChild(title);

  if (meta) {
    const metaText = document.createElement("p");
    metaText.className = "chat-result-meta";
    metaText.textContent = meta;
    card.appendChild(metaText);
  }

  appendInfoLine(card, "Vibe", row.vibe);
  appendInfoLine(card, "Highlights", row.highlights || row.why);
  appendInfoLine(card, "Address", row.address);
  appendInfoLine(card, "Hours", row.hoursHint);

  if (row.sourceUrl) {
    const source = document.createElement("a");
    source.className = "link-btn";
    source.href = row.sourceUrl;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    source.textContent = "Source";
    card.appendChild(source);
  }

  return card;
}

function buildRecommendationCards(rows) {
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "I could not find reliable place cards for that yet. Try adding a city, landmark, cuisine, or budget.";
    return empty;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "chat-result-groups";
  const grouped = rows.slice(0, 7).reduce((accumulator, row) => {
    const group = row.group || "Top Picks";
    if (!accumulator.has(group)) {
      accumulator.set(group, []);
    }
    accumulator.get(group).push(row);
    return accumulator;
  }, new Map());

  grouped.forEach((groupRows, groupName) => {
    const section = document.createElement("section");
    section.className = "chat-result-group";
    const heading = document.createElement("h2");
    heading.textContent = groupName;
    section.appendChild(heading);

    const cards = document.createElement("div");
    cards.className = "chat-result-cards";
    groupRows.forEach((row) => {
      cards.appendChild(buildResultCard(row));
    });
    section.appendChild(cards);
    wrapper.appendChild(section);
  });
  return wrapper;
}

function renderAssistantResponse(payload, loadingMessage) {
  const target = loadingMessage || createMessageShell("assistant").message;
  const bubble = target.querySelector(".chat-bubble");
  if (!bubble) return;

  bubble.classList.remove("chat-bubble-loading");
  bubble.innerHTML = "";

  const summary = document.createElement("p");
  summary.className = "chat-summary";
  summary.textContent = cleanText(payload.summary || "AI suggestions ready.");
  bubble.appendChild(summary);
  bubble.appendChild(buildRecommendationCards(cleanedResultRows(payload.results)));

  messages.push({
    role: "assistant",
    text: summary.textContent,
    results: payload.results || [],
  });
  scrollChatToBottom();
}

function renderAssistantError(message, loadingMessage = null) {
  const target = loadingMessage || createMessageShell("assistant").message;
  const bubble = target.querySelector(".chat-bubble");
  if (!bubble) return;
  bubble.classList.remove("chat-bubble-loading");
  bubble.innerHTML = "";
  const copy = document.createElement("p");
  copy.className = "chat-error-text";
  copy.textContent = message;
  bubble.appendChild(copy);
  messages.push({ role: "assistant", text: message, error: true });
  scrollChatToBottom();
}

function statusForPayload(payload) {
  if (payload.grounded_ok) {
    return payload.empty_results ? "No matching food places found." : "Suggestions ready.";
  }
  if (payload.error_code === "network_error") {
    return "AI provider network issue. Please retry in a few seconds.";
  }
  if (payload.error_code === "invalid_request") {
    return "AI provider rejected this request format. Fallback mode was used.";
  }
  if (payload.error_code === "parse_error") {
    return "AI response format issue detected. Please retry.";
  }
  return "Grounded AI is temporarily unavailable.";
}

async function runAiSearch(queryOverride = "") {
  const query = cleanText(queryOverride || aiQueryInput?.value || "");
  if (query.length < 4) {
    renderAssistantError("Enter at least 4 characters for AI search.");
    setAiStatus("Enter at least 4 characters.");
    return;
  }

  const now = Date.now();
  if (now - lastRunAt < MIN_GAP_MS) {
    renderAssistantError("Please wait a few seconds before another AI request.");
    setAiStatus("Please wait a few seconds.");
    return;
  }
  if (aiBusy) return;

  appendUserMessage(query);
  aiQueryInput.value = "";
  aiBusy = true;
  lastRunAt = now;
  aiSearchBtn.disabled = true;
  aiVoiceBtn.disabled = true;
  aiSearchBtn.textContent = "Sending...";
  setAiStatus("Looking for grounded suggestions...");
  const loadingMessage = appendLoadingBubble();

  try {
    const response = await fetch("/api/ai-search/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("csrftoken")
      },
      body: JSON.stringify({ query })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "AI search failed.");
    }

    renderAssistantResponse(payload, loadingMessage);
    setAiStatus(statusForPayload(payload));
  } catch (error) {
    const message = error.message || "AI search is temporarily unavailable.";
    renderAssistantError(message, loadingMessage);
    setAiStatus(message);
  } finally {
    aiBusy = false;
    aiSearchBtn.disabled = false;
    aiVoiceBtn.disabled = false;
    aiSearchBtn.textContent = "Send";
    aiQueryInput.focus();
  }
}

mountAiOnboarding();
appendAssistantWelcome();

aiChatForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  runAiSearch();
});

aiPromptChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    const query = chip.dataset.query || "";
    aiQueryInput.value = query;
    aiQueryInput.focus();
  });
});

function chooseSpeechLocale() {
  const lang = String(navigator.language || "").toLowerCase();
  if (lang.startsWith("fil") || lang.startsWith("tl")) {
    return "fil-PH";
  }
  return "en-US";
}

function normalizeVoiceQuery(value = "") {
  const raw = cleanText(value || "");
  if (!raw) return "";
  const lowered = raw.toLowerCase();
  const replacements = [
    [/\bmalapit\s+sa\s+akin\b/gi, "near me"],
    [/\bbukas\s+ngayon\b/gi, "open now"],
    [/\bmas\s+mura\b/gi, "cheaper"],
    [/\bsamgyup\b/gi, "samgyupsal"],
  ];
  const normalized = replacements.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), lowered);
  return normalized.replace(/\s{2,}/g, " ").trim();
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition && aiVoiceBtn) {
  const recognition = new SpeechRecognition();
  recognition.lang = chooseSpeechLocale();
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  aiVoiceBtn.addEventListener("click", () => {
    aiVoiceBtn.disabled = true;
    aiVoiceBtn.classList.add("listening");
    setAiStatus("Listening...");
    recognition.start();
  });

  recognition.onresult = (event) => {
    const transcript = normalizeVoiceQuery(event.results?.[0]?.[0]?.transcript || "");
    if (!transcript) return;
    aiQueryInput.value = transcript;
    setAiStatus(`Heard: "${transcript}"`);
  };

  recognition.onerror = (event) => {
    setAiStatus(`Voice error: ${event.error}`);
  };

  recognition.onend = () => {
    aiVoiceBtn.disabled = false;
    aiVoiceBtn.classList.remove("listening");
  };
} else if (aiVoiceBtn) {
  aiVoiceBtn.disabled = true;
  setAiStatus("Voice input is not supported in this browser.");
}
