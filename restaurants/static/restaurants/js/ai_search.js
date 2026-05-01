const aiQueryInput = document.getElementById("aiQueryInput");
const aiSearchBtn = document.getElementById("aiSearchBtn");
const aiVoiceBtn = document.getElementById("aiVoiceBtn");
const aiStatus = document.getElementById("aiStatus");
const aiQuota = document.getElementById("aiQuota");
const aiSummary = document.getElementById("aiSummary");
const aiResultsList = document.getElementById("aiResultsList");
const aiOnboardingMount = document.getElementById("aiOnboardingMount");
const AI_ONBOARDING_KEY = "aiSearchOnboardingSeenV1";

let aiBusy = false;
let lastRunAt = 0;
const MIN_GAP_MS = 3500;

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

function mountAiOnboarding(force = false) {
  if (!aiOnboardingMount) return;
  const seen = localStorage.getItem(AI_ONBOARDING_KEY) === "1";
  if (seen && !force) {
    aiOnboardingMount.innerHTML = `
      <div class="onboarding-inline-row">
        <button id="showAiTipsAgainBtn" class="chip" type="button">Show tips again</button>
      </div>
    `;
    aiOnboardingMount.querySelector("#showAiTipsAgainBtn")?.addEventListener("click", () => {
      mountAiOnboarding(true);
    });
    return;
  }

  aiOnboardingMount.innerHTML = `
    <aside class="onboarding-card" role="note" aria-label="AI search tips">
      <h3>Tips for better AI results</h3>
      <ul>
        <li>Include city or area for more grounded suggestions.</li>
        <li>Add intent words like budget, open late, or family-friendly.</li>
        <li>Use voice input for faster natural queries.</li>
      </ul>
      <div class="onboarding-actions">
        <button id="aiOnboardingDismissBtn" class="btn primary" type="button">Got it</button>
        <button id="aiOnboardingLaterBtn" class="btn ghost" type="button">Maybe later</button>
      </div>
    </aside>
  `;

  aiOnboardingMount.querySelector("#aiOnboardingDismissBtn")?.addEventListener("click", () => {
    localStorage.setItem(AI_ONBOARDING_KEY, "1");
    mountAiOnboarding(false);
  });
  aiOnboardingMount.querySelector("#aiOnboardingLaterBtn")?.addEventListener("click", () => {
    aiOnboardingMount.innerHTML = "";
  });
}

function renderAiResults(items) {
  aiResultsList.innerHTML = "";
  if (!items.length) {
    aiResultsList.innerHTML = '<p class="empty-state">No food-related results found yet. Try adding a city or cuisine in your query.</p>';
    return;
  }

  const cleanText = (value = "") => String(value)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const cleanedRows = items
    .map((item) => ({
      name: cleanText(item.name || ""),
      category: cleanText(item.category || "restaurant"),
      area: cleanText(item.area || ""),
      why: cleanText(item.why || ""),
      priceHint: cleanText(item.price_hint || ""),
      sourceUrl: cleanText(item.source_url || ""),
    }))
    .filter((row) => row.name && row.name.toUpperCase() !== "RESTAURANT" && !row.name.includes('"summary"'));

  if (!cleanedRows.length) {
    aiResultsList.innerHTML = '<p class="empty-state">No clean restaurant suggestions were returned.</p>';
    return;
  }

  const card = document.createElement("article");
  card.className = "result-item";
  const listMarkup = cleanedRows.slice(0, 8).map((row) => `
    <li>
      <strong>${row.name}</strong>
      <div>${row.category.toUpperCase()}${row.area ? ` | ${row.area}` : ""}${row.priceHint ? ` | ${row.priceHint}` : ""}</div>
      <div>${row.why}</div>
      ${row.sourceUrl ? `<a class="link-btn" href="${row.sourceUrl}" target="_blank" rel="noopener noreferrer">Source</a>` : ""}
    </li>
  `).join("");
  card.innerHTML = `
    <h3>Recommended Places</h3>
    <ol class="ai-results-list">${listMarkup}</ol>
  `;
  aiResultsList.appendChild(card);
}

async function runAiSearch() {
  const query = (aiQueryInput?.value || "").trim();
  if (query.length < 4) {
    aiStatus.textContent = "Enter at least 4 characters for AI search.";
    return;
  }

  const now = Date.now();
  if (now - lastRunAt < MIN_GAP_MS) {
    aiStatus.textContent = "Please wait a few seconds before another AI request.";
    return;
  }
  if (aiBusy) return;

  aiBusy = true;
  lastRunAt = now;
  aiSearchBtn.disabled = true;
  aiSearchBtn.textContent = "Thinking...";
  aiStatus.textContent = "Running grounded AI search...";
  aiSummary.innerHTML = "";
  aiQuota.textContent = "";

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
    const summaryCard = document.createElement("article");
    summaryCard.className = "result-item";
    summaryCard.innerHTML = `
      <h3>AI Summary</h3>
      <p>${String(payload.summary || "AI suggestions ready.").replace(/```json/gi, "").replace(/```/g, "").trim()}</p>
    `;
    aiSummary.appendChild(summaryCard);
    renderAiResults(payload.results || []);
    aiQuota.textContent = `Remaining AI searches today: ${payload.remaining ?? "-"}`;
    if (!payload.grounded_ok) {
      if (payload.error_code === "network_error") {
        aiStatus.textContent = "AI provider network issue. Please retry in a few seconds.";
      } else if (payload.error_code === "invalid_request") {
        aiStatus.textContent = "AI provider rejected this request format. Fallback mode was used.";
      } else if (payload.error_code === "parse_error") {
        aiStatus.textContent = "AI response format issue detected. Please retry.";
      } else {
        aiStatus.textContent = "Grounded AI is temporarily unavailable.";
      }
    } else if (payload.empty_results) {
      aiStatus.textContent = "No matching food places found from grounded web results.";
    } else {
      aiStatus.textContent = "AI search complete.";
    }
  } catch (error) {
    aiStatus.textContent = error.message || "AI search is temporarily unavailable.";
  } finally {
    aiBusy = false;
    aiSearchBtn.disabled = false;
    aiSearchBtn.textContent = "Run AI Search";
  }
}

aiSearchBtn?.addEventListener("click", runAiSearch);
mountAiOnboarding();
aiQueryInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runAiSearch();
  }
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition && aiVoiceBtn) {
  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  aiVoiceBtn.addEventListener("click", () => {
    aiVoiceBtn.disabled = true;
    aiVoiceBtn.classList.add("listening");
    aiStatus.textContent = "Listening...";
    recognition.start();
  });

  recognition.onresult = (event) => {
    const transcript = (event.results?.[0]?.[0]?.transcript || "").trim();
    if (!transcript) return;
    aiQueryInput.value = transcript;
    aiStatus.textContent = `Heard: "${transcript}"`;
  };

  recognition.onerror = (event) => {
    aiStatus.textContent = `Voice error: ${event.error}`;
  };

  recognition.onend = () => {
    aiVoiceBtn.disabled = false;
    aiVoiceBtn.classList.remove("listening");
  };
} else if (aiVoiceBtn) {
  aiVoiceBtn.disabled = true;
}
