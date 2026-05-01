const nav = document.getElementById("mainNav");
const hamburgerBtn = document.getElementById("hamburgerBtn");
const assistantFab = document.getElementById("assistantFab");
const assistantPanel = document.getElementById("assistantPanel");
const assistantCloseBtn = document.getElementById("assistantCloseBtn");
const assistantMessages = document.getElementById("assistantMessages");
const assistantForm = document.getElementById("assistantForm");
const assistantInput = document.getElementById("assistantInput");
const assistantChips = document.querySelectorAll(".assistant-chip");

if (hamburgerBtn && nav) {
  hamburgerBtn.addEventListener("click", () => {
    nav.classList.toggle("open");
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("open");
    });
  });
}

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

function appendAssistantMessage(text, role = "bot") {
  if (!assistantMessages) return;
  const message = document.createElement("article");
  message.className = `assistant-msg ${role === "user" ? "assistant-msg-user" : "assistant-msg-bot"}`;
  message.textContent = text;
  assistantMessages.appendChild(message);
  assistantMessages.scrollTop = assistantMessages.scrollHeight;
}

function appendAssistantSuggestionChips(chips = []) {
  if (!assistantMessages || !Array.isArray(chips) || !chips.length) return;
  const row = document.createElement("div");
  row.className = "assistant-quick-actions";
  chips.slice(0, 4).forEach((chip) => {
    if (!chip?.query) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip assistant-chip";
    button.textContent = chip.label || chip.query;
    button.addEventListener("click", () => {
      if (typeof window.applyAssistantSuggestion === "function") {
        window.applyAssistantSuggestion(chip.query);
      } else {
        window.location.href = `/search/?q=${encodeURIComponent(chip.query)}`;
      }
    });
    row.appendChild(button);
  });
  if (row.childElementCount) {
    assistantMessages.appendChild(row);
    assistantMessages.scrollTop = assistantMessages.scrollHeight;
  }
}

function toggleAssistant(open) {
  if (!assistantPanel) return;
  assistantPanel.classList.toggle("open", open);
  assistantPanel.setAttribute("aria-hidden", open ? "false" : "true");
}

window.pushAssistantInsights = (assistant) => {
  const reason = String(assistant?.reason || "").trim();
  const chips = Array.isArray(assistant?.chips) ? assistant.chips : [];
  if (!reason && !chips.length) return;
  toggleAssistant(true);
  if (reason) {
    appendAssistantMessage(reason, "bot");
  }
  appendAssistantSuggestionChips(chips);
};

async function runAssistant(message) {
  const hasSearchContext = typeof window.getAssistantContext === "function";
  const context = hasSearchContext ? window.getAssistantContext() : null;
  const baseQuery = context?.query || "";

  appendAssistantMessage(message, "user");

  if (!baseQuery) {
    appendAssistantMessage("Opening search with your request.", "bot");
    window.location.href = `/search/?q=${encodeURIComponent(message)}`;
    return;
  }

  try {
    const response = await fetch("/api/chat-assistant/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("csrftoken")
      },
      body: JSON.stringify({
        query: baseQuery,
        message,
        latitude: context?.latitude,
        longitude: context?.longitude
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Assistant failed to process request.");
    }
    appendAssistantMessage(payload.assistant_message || "Updated your search.", "bot");
    if (typeof window.applyAssistantResults === "function") {
      window.applyAssistantResults(payload);
    } else {
      const q = payload.suggested_query || baseQuery;
      window.location.href = `/search/?q=${encodeURIComponent(q)}`;
    }
  } catch (error) {
    appendAssistantMessage(error.message || "Assistant is unavailable right now.", "bot");
  }
}

assistantFab?.addEventListener("click", () => toggleAssistant(true));
assistantCloseBtn?.addEventListener("click", () => toggleAssistant(false));

assistantForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const msg = (assistantInput?.value || "").trim();
  if (!msg) return;
  assistantInput.value = "";
  runAssistant(msg);
});

assistantChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    const msg = chip.dataset.msg || "";
    if (!msg) return;
    runAssistant(msg);
  });
});
