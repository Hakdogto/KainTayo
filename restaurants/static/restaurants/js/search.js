const queryInput = document.getElementById("queryInput");
const searchBtn = document.getElementById("searchBtn");
const voiceBtn = document.getElementById("voiceBtn");
const refreshLocationBtn = document.getElementById("refreshLocationBtn");
const setManualLocationBtn = document.getElementById("setManualLocationBtn");
const countryInput = document.getElementById("countryInput");
const regionInput = document.getElementById("regionInput");
const cityInput = document.getElementById("cityInput");
const locationStatus = document.getElementById("locationStatus");
const voiceStatus = document.getElementById("voiceStatus");
const searchLiveRegion = document.getElementById("searchLiveRegion");
const resultsList = document.getElementById("resultsList");
const parsedFilters = document.getElementById("parsedFilters");
const searchSuggestionChips = document.querySelectorAll(".search-suggestion-chip");
const mobileSearchActionBtn = document.getElementById("mobileSearchActionBtn");
const mobileLocationActionBtn = document.getElementById("mobileLocationActionBtn");
const manualLocationDetails = document.getElementById("manualLocationDetails");
const searchOnboardingMount = document.getElementById("searchOnboardingMount");
const searchLayoutButtons = document.querySelectorAll(".layout-toggle-btn[data-layout]");
const SEARCH_STATE_KEY = "smartSearchStateV1";
const APP_TIPS_DISMISSED_KEY = "kainTayoTipsDismissedV1";
const SEARCH_LAYOUT_KEY = "smartSearchResultsLayoutV1";

let userLat = 14.5995;
let userLon = 120.9842;
let map;
let mapMarkers = [];
let userMarker = null;
let voiceTriggeredSearch = false;
let lastVoiceTranscript = "";
let leafletReady = typeof window.L !== "undefined";
let lastPayload = null;
let resultsLayout = localStorage.getItem(SEARCH_LAYOUT_KEY) === "swipe" ? "swipe" : "vertical";

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

function initMap() {
  if (!leafletReady) {
    if (locationStatus) {
      locationStatus.textContent = "Map failed to load. Search still works without map.";
    }
    return;
  }
  map = L.map("map").setView([userLat, userLon], 13);

  const addOsmLayer = () => L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  if (!window.MAPBOX_ACCESS_TOKEN) {
    addOsmLayer();
    return;
  }

  const mapboxLayer = L.tileLayer(
    `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${window.MAPBOX_ACCESS_TOKEN}`,
    {
      tileSize: 512,
      zoomOffset: -1,
      maxZoom: 19,
      attribution: "&copy; Mapbox &copy; OpenStreetMap contributors"
    }
  );

  let fellBack = false;
  mapboxLayer.on("tileerror", () => {
    if (fellBack) return;
    fellBack = true;
    map.removeLayer(mapboxLayer);
    addOsmLayer();
  });

  mapboxLayer.addTo(map);
}

function ensureMapReady() {
  if (!leafletReady || map) return;
  initMap();
}

function clearMarkers() {
  if (!leafletReady || !map) return;
  mapMarkers.forEach((marker) => map.removeLayer(marker));
  mapMarkers = [];
}

function renderParsedFilters(filters) {
  parsedFilters.innerHTML = "";
  Object.entries(filters).forEach(([key, value]) => {
    if (value === null || value === false || value === "") return;
    const chip = document.createElement("span");
    chip.textContent = `${key}: ${value}`;
    parsedFilters.appendChild(chip);
  });
}

function detailUrlFor(item) {
  if (item.detail_url) return item.detail_url;
  if (typeof item.id === "number") return `/restaurant/${item.id}/`;
  if (item.place_id) return `/place/${item.place_id}/`;
  return "";
}

function saveSearchState(payload = null) {
  try {
    const state = {
      query: (queryInput?.value || "").trim(),
      userLat,
      userLon,
      locationText: locationStatus?.textContent || "",
      country: (countryInput?.value || "").trim(),
      region: (regionInput?.value || "").trim(),
      city: (cityInput?.value || "").trim(),
      scrollY: window.scrollY || 0,
      lastOpenedUrl: sessionStorage.getItem("smartSearchLastOpenedUrl") || "",
      payload: payload || lastPayload || null,
      savedAt: Date.now()
    };
    sessionStorage.setItem(SEARCH_STATE_KEY, JSON.stringify(state));
  } catch (_) {
    // no-op for storage limitations
  }
}

function restoreSearchState() {
  try {
    const raw = sessionStorage.getItem(SEARCH_STATE_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    if (!state || (Date.now() - Number(state.savedAt || 0)) > (1000 * 60 * 90)) {
      return false;
    }

    if (typeof state.userLat === "number" && typeof state.userLon === "number") {
      userLat = state.userLat;
      userLon = state.userLon;
    }
    if (state.locationText && locationStatus) {
      locationStatus.textContent = state.locationText;
    }
    if (countryInput && typeof state.country === "string") {
      countryInput.value = state.country;
    }
    if (regionInput && typeof state.region === "string") {
      regionInput.value = state.region;
    }
    if (cityInput && typeof state.city === "string") {
      cityInput.value = state.city;
    }
    if (state.query && queryInput) {
      queryInput.value = state.query;
    }
    if (state.payload) {
      lastPayload = state.payload;
      renderParsedFilters(state.payload.parsed_filters || {});
      renderResults(state.payload.results || []);
      if (typeof state.scrollY === "number") {
        setTimeout(() => window.scrollTo(0, state.scrollY), 0);
      }
      const lastOpenedUrl = String(state.lastOpenedUrl || "");
      if (lastOpenedUrl) {
        const target = resultsList.querySelector(`[data-detail-url="${CSS.escape(lastOpenedUrl)}"]`);
        if (target) {
          target.classList.add("result-item-returned");
          setTimeout(() => target.classList.remove("result-item-returned"), 1700);
        }
      }
      announceLive(`Restored ${Array.isArray(state.payload.results) ? state.payload.results.length : 0} previous results.`);
    }
    return true;
  } catch (_) {
    return false;
  }
}

function animateActionButton(button, state = "success") {
  if (!button) return;
  button.classList.remove("action-feedback-success", "action-feedback-error");
  void button.offsetWidth;
  button.classList.add(state === "error" ? "action-feedback-error" : "action-feedback-success");
}

function announceLive(message) {
  if (!searchLiveRegion) return;
  searchLiveRegion.textContent = message;
}

function applyResultsLayout(layout = resultsLayout) {
  resultsLayout = layout === "swipe" ? "swipe" : "vertical";
  resultsList?.classList.toggle("results-list-swipe", resultsLayout === "swipe");
  resultsList?.classList.toggle("results-list-vertical", resultsLayout === "vertical");
  searchLayoutButtons.forEach((button) => {
    const isActive = button.dataset.layout === resultsLayout;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  try {
    localStorage.setItem(SEARCH_LAYOUT_KEY, resultsLayout);
  } catch (_) {
    // no-op for storage limitations
  }
}

function dismissSearchTips() {
  localStorage.setItem(APP_TIPS_DISMISSED_KEY, "1");
  if (searchOnboardingMount) {
    searchOnboardingMount.innerHTML = "";
  }
}

function mountOnboardingTips() {
  if (!searchOnboardingMount) return;
  const dismissed = localStorage.getItem(APP_TIPS_DISMISSED_KEY) === "1";
  if (dismissed) {
    searchOnboardingMount.innerHTML = "";
    return;
  }

  searchOnboardingMount.innerHTML = `
    <aside class="onboarding-card" role="note" aria-label="Search tips">
      <button id="onboardingCloseBtn" class="onboarding-close" type="button" aria-label="Close tips">X</button>
      <h3>Quick tips</h3>
      <ul>
        <li>Use a dish, cuisine, budget, or mood.</li>
        <li>Tap Swipe to browse cards sideways.</li>
      </ul>
      <div class="onboarding-actions">
        <button id="onboardingDismissBtn" class="btn primary" type="button">Got it</button>
        <button id="onboardingLaterBtn" class="btn ghost" type="button">Maybe later</button>
      </div>
    </aside>
  `;

  searchOnboardingMount.querySelector("#onboardingCloseBtn")?.addEventListener("click", dismissSearchTips);
  searchOnboardingMount.querySelector("#onboardingDismissBtn")?.addEventListener("click", dismissSearchTips);
  searchOnboardingMount.querySelector("#onboardingLaterBtn")?.addEventListener("click", dismissSearchTips);
}

function renderLoadingSkeleton() {
  resultsList.innerHTML = "";
  applyResultsLayout();
  for (let index = 0; index < 4; index += 1) {
    const card = document.createElement("article");
    card.className = "result-item skeleton-card";
    card.innerHTML = `
      <div class="skeleton skeleton-line skeleton-title"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-actions"></div>
    `;
    resultsList.appendChild(card);
  }
}

function renderEmptySuggestions(query = "") {
  const nextQuery = String(query || "").trim();
  const candidates = [
    { label: "Try nearby", query: `${nextQuery} near me`.trim() },
    { label: "Open now", query: `${nextQuery} open now`.trim() },
    { label: "Under 500", query: `${nextQuery} under 500`.trim() },
    { label: "4.5 stars", query: `${nextQuery} 4.5 stars`.trim() }
  ];
  const chips = candidates
    .filter((item, idx, arr) => item.query && arr.findIndex((x) => x.query === item.query) === idx)
    .slice(0, 4)
    .map((item) => `<button class="chip empty-suggestion-chip" type="button" data-query="${item.query}">${item.label}</button>`)
    .join("");
  resultsList.innerHTML = `
    <div class="empty-state-card">
      <p class="empty-state">No matching restaurants yet. Try one of these quick fixes:</p>
      <div class="recommendation-chips">${chips}</div>
    </div>
  `;
  applyResultsLayout();
  resultsList.querySelectorAll(".empty-suggestion-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      queryInput.value = chip.dataset.query || "";
      smartSearch();
    });
  });
}

async function addFavorite(payload) {
  const response = await fetch("/api/favorites/add/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCookie("csrftoken")
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    alert("Unable to save favorite right now. Please try again.");
    return false;
  }
  return true;
}

function renderResults(results) {
  ensureMapReady();
  resultsList.innerHTML = "";
  applyResultsLayout();

  if (!results.length) {
    resultsList.innerHTML = '<p class="empty-state">No matching restaurants yet. Try a broader query.</p>';
    return;
  }

  results.forEach((item) => {
    const wrapper = document.createElement("article");
    wrapper.className = "result-item clickable";

    const hasPhoto = Boolean(item.photo_name);
    const photoMarkup = hasPhoto
      ? `<img class="result-photo" src="/api/place-photo/?name=${encodeURIComponent(item.photo_name)}&max_width=520" alt="${item.name}" loading="lazy" />`
      : "";
    const attributionMarkup = item.photo_author ? `<p class="photo-credit">Photo: ${item.photo_author}</p>` : "";
    const detailUrl = detailUrlFor(item);
    const normalizedId = Number.parseInt(item.id, 10);
    const hasPlaceId = Boolean(item.place_id);
    const canSave = Number.isFinite(normalizedId) || hasPlaceId;
    if (detailUrl) {
      wrapper.dataset.detailUrl = detailUrl;
    }

    wrapper.innerHTML = `
      ${photoMarkup}
      <h3>${item.name}</h3>
      <p>${String(item.cuisine || "restaurant").toUpperCase()} | Rating ${item.rating} | ${item.distance_km} km</p>
      <p>${item.address || ""}</p>
      ${attributionMarkup}
      <div class="actions">
        <span></span>
        <div class="action-group">
          ${canSave ? `<button class="save-btn" data-id="${Number.isFinite(normalizedId) ? normalizedId : ""}" data-place-id="${item.place_id || ""}">Save</button>` : ""}
          ${detailUrl ? `<a class="link-btn" href="${detailUrl}">Details</a>` : ""}
        </div>
      </div>
    `;

    if (detailUrl) {
      const prefetchDetail = () => {
        fetch(detailUrl, { method: "GET", credentials: "same-origin" }).catch(() => {});
      };
      wrapper.addEventListener("mouseenter", prefetchDetail, { once: true });
      wrapper.addEventListener("touchstart", prefetchDetail, { once: true, passive: true });
      wrapper.addEventListener("click", () => {
        sessionStorage.setItem("smartSearchLastOpenedUrl", detailUrl);
        saveSearchState();
        window.location.href = detailUrl;
      });
    }

    const saveButton = wrapper.querySelector(".save-btn");
    if (saveButton) {
      saveButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const localId = Number(item.id);
        if (Number.isFinite(localId)) {
          const ok = await addFavorite({ restaurant_id: localId });
          animateActionButton(saveButton, ok ? "success" : "error");
          return;
        }
        if (item.place_id) {
          const ok = await addFavorite({
            place_id: item.place_id,
            name: item.name,
            cuisine: item.cuisine || "",
            address: item.address || "",
            detail_url: detailUrl,
            rating: item.rating ?? null
          });
          animateActionButton(saveButton, ok ? "success" : "error");
        }
      });
    }

    const linkButton = wrapper.querySelector(".link-btn");
    if (linkButton) {
      linkButton.addEventListener("click", (event) => {
        event.stopPropagation();
      });
    }

    if (leafletReady && map) {
      const marker = L.marker([item.latitude, item.longitude]).addTo(map);
      marker.bindPopup(`<b>${item.name}</b><br/>${item.address || ""}`);
      mapMarkers.push(marker);
    }

    resultsList.appendChild(wrapper);
  });

  if (leafletReady && map && results[0]) {
    map.setView([results[0].latitude, results[0].longitude], 13);
  }
}

async function deleteFavoriteItem(favoriteId, favoriteType) {
  const response = await fetch(`/api/favorites/${encodeURIComponent(favoriteType)}/${favoriteId}/`, {
    method: "DELETE",
    headers: {
      "X-CSRFToken": getCookie("csrftoken")
    }
  });
  if (!response.ok) {
    alert("Unable to delete this favorite right now.");
    return false;
  }
  return true;
}

async function smartSearch(queryOverride = null) {
  const safeOverride = typeof queryOverride === "string" ? queryOverride : null;
  const query = (safeOverride ?? queryInput.value ?? "").trim();
  if (!query) {
    resultsList.innerHTML = '<p class="empty-state">Type a food request to start searching.</p>';
    announceLive("Type a search request to begin.");
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = "Finding...";
  clearMarkers();
  renderLoadingSkeleton();
  announceLive("Searching restaurants now.");

  try {
    const response = await fetch("/api/search/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("csrftoken")
      },
      body: JSON.stringify({ query, latitude: userLat, longitude: userLon, semantic: true })
    });

    if (!response.ok) {
      throw new Error("Search failed");
    }

    const payload = await response.json();
    lastPayload = payload;
    queryInput.value = query;
    renderParsedFilters(payload.parsed_filters || {});
    if (typeof window.pushAssistantInsights === "function") {
      window.pushAssistantInsights(payload.assistant || {});
    }
    const nextResults = payload.results || [];
    if (!nextResults.length) {
      renderEmptySuggestions(query);
      announceLive("No results found. Suggestions are available.");
    } else {
      renderResults(nextResults);
      announceLive(`Found ${nextResults.length} matching restaurants.`);
    }
    saveSearchState(payload);
  } catch (error) {
    resultsList.innerHTML = '<p class="empty-state">We could not complete your search. Please try again.</p>';
    announceLive("Search failed. Please try again.");
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "Find Food";
  }
}

function updateLocation(lat, lon, label = "") {
  ensureMapReady();
  userLat = lat;
  userLon = lon;
  if (leafletReady && map) {
    map.setView([userLat, userLon], 13);
    if (userMarker) {
      map.removeLayer(userMarker);
    }
    userMarker = L.circleMarker([userLat, userLon], { radius: 8 }).addTo(map).bindPopup("You are here");
  }
  if (label) {
    locationStatus.textContent = `Using location: ${label}`;
  }
}

function detectLocation() {
  if (!navigator.geolocation) {
    locationStatus.textContent = "Browser location is unavailable. Using Metro Manila default.";
    return;
  }

  locationStatus.textContent = "Detecting your location...";
  ensureMapReady();
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      updateLocation(latitude, longitude, "Current GPS location");
    },
    (error) => {
      locationStatus.textContent = `Location error: ${error.message}. Using Metro Manila default.`;
    },
    {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
    }
  );
}

async function setManualLocation() {
  const country = countryInput.value.trim();
  const region = regionInput.value.trim();
  const city = cityInput.value.trim();

  if (!country && !region && !city) {
    locationStatus.textContent = "Enter at least one field (city/region/country).";
    return;
  }

  setManualLocationBtn.disabled = true;
  setManualLocationBtn.textContent = "Setting...";
  locationStatus.textContent = "Resolving your typed location...";
  ensureMapReady();

  try {
    const response = await fetch("/api/resolve-location/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("csrftoken")
      },
      body: JSON.stringify({ country, region, city })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Location lookup failed");
    }

    updateLocation(payload.latitude, payload.longitude, payload.label || "Manual location");
  } catch (error) {
    locationStatus.textContent = error.message || "Could not set manual location.";
  } finally {
    setManualLocationBtn.disabled = false;
    setManualLocationBtn.textContent = "Set Location";
  }
}

searchBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  smartSearch();
});
queryInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") smartSearch();
});
refreshLocationBtn?.addEventListener("click", detectLocation);
setManualLocationBtn?.addEventListener("click", setManualLocation);
searchSuggestionChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    queryInput.value = chip.dataset.query || "";
    smartSearch();
  });
});
searchLayoutButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyResultsLayout(button.dataset.layout);
  });
});
mobileSearchActionBtn?.addEventListener("click", () => smartSearch());
mobileLocationActionBtn?.addEventListener("click", () => {
  detectLocation();
  if (manualLocationDetails) {
    manualLocationDetails.open = true;
  }
  countryInput?.focus();
});

locationStatus.textContent = "Using default location. Tap Use My Current Location or Set Location before searching.";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  voiceBtn.addEventListener("click", () => {
    voiceTriggeredSearch = false;
    lastVoiceTranscript = "";
    voiceStatus.textContent = "Listening... speak your food request now.";
    recognition.start();
  });

  recognition.onstart = () => {
    voiceBtn.classList.add("listening");
  };

  recognition.onresult = (event) => {
    const transcript = (event.results[0][0].transcript || "").trim();
    if (!transcript) {
      return;
    }
    lastVoiceTranscript = transcript;
    queryInput.value = transcript;
    voiceStatus.textContent = `Heard: "${transcript}"`;

    if (!voiceTriggeredSearch) {
      voiceTriggeredSearch = true;
      smartSearch();
    }
  };

  recognition.onerror = (event) => {
    voiceStatus.textContent = `Voice search error: ${event.error}. Try tapping the mic again.`;
  };

  recognition.onend = () => {
    voiceBtn.classList.remove("listening");
    if (!voiceTriggeredSearch) {
      if (lastVoiceTranscript) {
        voiceTriggeredSearch = true;
        smartSearch();
      } else {
        voiceStatus.textContent = "No speech detected. Tap the mic, speak clearly, and pause briefly.";
      }
    }
  };
} else {
  voiceBtn.disabled = true;
  voiceStatus.textContent = "Voice search is not supported in this browser. Try Chrome on HTTPS.";
}

const queryFromUrl = new URLSearchParams(window.location.search).get("q");
if (queryFromUrl) {
  queryInput.value = queryFromUrl;
} else {
  restoreSearchState();
}
applyResultsLayout();
mountOnboardingTips();

window.getAssistantContext = () => ({
  query: queryInput.value.trim(),
  latitude: userLat,
  longitude: userLon
});

window.applyAssistantResults = (payload) => {
  queryInput.value = payload.suggested_query || queryInput.value.trim();
  renderParsedFilters(payload.parsed_filters || {});
  renderResults(payload.results || []);
};

window.applyAssistantSuggestion = (query) => {
  const nextQuery = String(query || "").trim();
  if (!nextQuery) return;
  queryInput.value = nextQuery;
  smartSearch(nextQuery);
};
