const favoritesList = document.getElementById("favoritesList");
const savedStatusTabs = document.getElementById("savedStatusTabs");

const STATUS_OPTIONS = [
  { value: "want_to_try", label: "Want to Try" },
  { value: "tried", label: "Tried" },
  { value: "favorite", label: "Favorite" }
];

const TAG_OPTIONS = [
  { value: "date", label: "Date" },
  { value: "family", label: "Family" },
  { value: "study", label: "Study" },
  { value: "barkada", label: "Barkada" },
  { value: "quick_bite", label: "Quick bite" },
  { value: "nearby", label: "Nearby" },
  { value: "craving", label: "Craving" }
];

let favorites = [];
let activeStatus = "all";

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

function animateActionButton(button, state = "success") {
  if (!button) return;
  button.classList.remove("action-feedback-success", "action-feedback-error");
  void button.offsetWidth;
  button.classList.add(state === "error" ? "action-feedback-error" : "action-feedback-success");
}

function statusLabel(status) {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label || "Want to Try";
}

function sourceLabel(type) {
  return type === "external" ? "External" : "Local";
}

function placeType(entry) {
  return entry.cuisine || (entry.type === "external" ? "place" : "restaurant");
}

function setListMessage(message, isError = false) {
  favoritesList.innerHTML = "";
  const state = document.createElement("div");
  state.className = isError ? "empty-state-card saved-error-state" : "empty-state-card";
  const text = document.createElement("p");
  text.className = "empty-state";
  text.textContent = message;
  state.appendChild(text);
  favoritesList.appendChild(state);
}

function detailUrlFor(entry) {
  const rawUrl = String(entry.detail_url || "").trim();
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return {
      href: parsed.origin === window.location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href,
      external: parsed.origin !== window.location.origin
    };
  } catch (error) {
    return null;
  }
}

function buildCardHeader(entry) {
  const header = document.createElement("div");
  header.className = "saved-place-header";

  const copy = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = entry.name || "Saved place";
  const summary = document.createElement("p");
  const parts = [placeType(entry)];
  if (entry.rating !== null && entry.rating !== undefined && entry.rating !== "") {
    parts.push(`Rating ${entry.rating}`);
  }
  summary.textContent = parts.join(" | ");
  copy.append(title, summary);

  const badges = document.createElement("div");
  badges.className = "saved-place-badges";
  const sourceBadge = document.createElement("span");
  sourceBadge.className = "saved-source-badge";
  sourceBadge.textContent = sourceLabel(entry.type);
  const statusBadge = document.createElement("span");
  statusBadge.className = "saved-status-badge";
  statusBadge.textContent = statusLabel(entry.status);
  badges.append(sourceBadge, statusBadge);

  header.append(copy, badges);
  return header;
}

function buildStatusSelect(entry) {
  const select = document.createElement("select");
  select.className = "saved-status-select";
  select.setAttribute("aria-label", "Saved place status");
  STATUS_OPTIONS.forEach((option) => {
    const item = document.createElement("option");
    item.value = option.value;
    item.textContent = option.label;
    item.selected = (entry.status || "want_to_try") === option.value;
    select.appendChild(item);
  });
  return select;
}

function buildTagList(entry) {
  const selectedTags = Array.isArray(entry.tags) ? entry.tags : [];
  const wrap = document.createElement("div");
  wrap.className = "saved-tag-list";
  TAG_OPTIONS.forEach((tag) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = tag.value;
    input.checked = selectedTags.includes(tag.value);
    label.append(input, document.createTextNode(` ${tag.label}`));
    wrap.appendChild(label);
  });
  return wrap;
}

function collectMetadata(card) {
  return {
    status: card.querySelector(".saved-status-select")?.value || "want_to_try",
    note: card.querySelector(".saved-note-input")?.value || "",
    tags: Array.from(card.querySelectorAll(".saved-tag-list input:checked")).map((input) => input.value)
  };
}

async function patchFavoriteItem(entry, payload) {
  const response = await fetch(`/api/favorites/${encodeURIComponent(entry.type)}/${entry.id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCookie("csrftoken")
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Unable to save this place right now.");
  }
  return response.json();
}

async function deleteFavoriteItem(favoriteId, favoriteType) {
  const response = await fetch(`/api/favorites/${encodeURIComponent(favoriteType)}/${favoriteId}/`, {
    method: "DELETE",
    headers: {
      "X-CSRFToken": getCookie("csrftoken")
    }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Unable to delete this place right now.");
  }
  return true;
}

function renderFavorites() {
  favoritesList.innerHTML = "";
  const visibleFavorites = favorites.filter((entry) => activeStatus === "all" || entry.status === activeStatus);

  if (!favorites.length) {
    setListMessage("No saved places yet. Save restaurants from search to build your list.");
    return;
  }

  if (!visibleFavorites.length) {
    setListMessage(`No saved places marked ${statusLabel(activeStatus)} yet.`);
    return;
  }

  visibleFavorites.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "result-item saved-place-card";
    card.dataset.favoriteId = entry.id;
    card.dataset.favoriteType = entry.type;

    const meta = document.createElement("div");
    meta.className = "saved-place-meta";

    const row = document.createElement("div");
    row.className = "saved-place-control-row";
    const statusSelect = buildStatusSelect(entry);
    row.appendChild(statusSelect);
    const detailUrl = detailUrlFor(entry);
    if (detailUrl?.href) {
      const link = document.createElement("a");
      link.className = "link-btn saved-detail-link";
      link.href = detailUrl.href;
      if (detailUrl.external) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      link.textContent = "Details";
      row.appendChild(link);
    }

    const note = document.createElement("textarea");
    note.className = "saved-note-input";
    note.maxLength = 500;
    note.placeholder = "Add a note for future you...";
    note.value = entry.note || "";
    note.setAttribute("aria-label", `Note for ${entry.name || "saved place"}`);

    meta.append(row, note, buildTagList(entry));

    const feedback = document.createElement("p");
    feedback.className = "saved-action-feedback";
    feedback.setAttribute("aria-live", "polite");

    const actions = document.createElement("div");
    actions.className = "actions";
    const spacer = document.createElement("span");
    const group = document.createElement("div");
    group.className = "action-group";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "save-metadata-btn";
    saveButton.textContent = "Save";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-favorite-btn";
    deleteButton.textContent = "Delete";
    group.append(saveButton, deleteButton);
    actions.append(spacer, group);

    card.append(buildCardHeader(entry), meta, feedback, actions);

    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      feedback.textContent = "";
      try {
        const updated = await patchFavoriteItem(entry, collectMetadata(card));
        const index = favorites.findIndex((item) => item.id === entry.id && item.type === entry.type);
        if (index >= 0) {
          favorites[index] = { ...favorites[index], ...updated };
        }
        Object.assign(entry, updated);
        card.querySelector(".saved-status-badge").textContent = statusLabel(entry.status);
        feedback.textContent = "Saved.";
        animateActionButton(saveButton, "success");
        if (activeStatus !== "all" && entry.status !== activeStatus) {
          renderFavorites();
        }
      } catch (error) {
        feedback.textContent = error.message;
        animateActionButton(saveButton, "error");
      } finally {
        saveButton.disabled = false;
      }
    });

    const deleteFavoriteBtn = card.querySelector(".delete-favorite-btn");
    if (deleteFavoriteBtn) {
      deleteFavoriteBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        deleteFavoriteBtn.disabled = true;
        feedback.textContent = "";
        try {
          await deleteFavoriteItem(entry.id, entry.type);
          animateActionButton(deleteFavoriteBtn, "success");
          await fetchFavorites();
        } catch (error) {
          feedback.textContent = error.message;
          animateActionButton(deleteFavoriteBtn, "error");
          deleteFavoriteBtn.disabled = false;
        }
      });
    }

    favoritesList.appendChild(card);
  });
}

async function fetchFavorites() {
  setListMessage("Loading saved places...");
  try {
    const response = await fetch("/api/favorites/");
    if (!response.ok) {
      throw new Error("Unable to load saved places right now.");
    }
    favorites = await response.json();
    renderFavorites();
  } catch (error) {
    setListMessage(error.message, true);
  }
}

if (savedStatusTabs) {
  savedStatusTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-status]");
    if (!button) return;
    activeStatus = button.dataset.status || "all";
    savedStatusTabs.querySelectorAll("button").forEach((tab) => {
      const isActive = tab === button;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    renderFavorites();
  });
}

fetchFavorites();
