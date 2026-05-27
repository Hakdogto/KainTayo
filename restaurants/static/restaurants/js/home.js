const nearbyGrid = document.getElementById("nearbyGrid");
const homeLocationStatus = document.getElementById("homeLocationStatus");
const homeSearchForm = document.querySelector(".hero-search");
const homeQueryInput = document.getElementById("homeQueryInput");
const homeVoiceBtn = document.getElementById("homeVoiceBtn");
const homeVoiceStatus = document.getElementById("homeVoiceStatus");
const homeCountryInput = document.getElementById("homeCountryInput");
const homeRegionInput = document.getElementById("homeRegionInput");
const homeCityInput = document.getElementById("homeCityInput");
const homeSetLocationBtn = document.getElementById("homeSetLocationBtn");
const recommendationChips = document.getElementById("recommendationChips");
const homeOnboardingMount = document.getElementById("homeOnboardingMount");
const APP_TIPS_DISMISSED_KEY = "kainTayoTipsDismissedV1";
const HOME_MANUAL_LOCATION_KEY = "homeManualLocationForSearchV1";

function renderNearbyRestaurants(items) {
  if (!nearbyGrid) return;

  nearbyGrid.innerHTML = "";
  if (!items.length) {
    nearbyGrid.innerHTML = '<p class="empty-state">No nearby restaurants found yet.</p>';
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("a");
    card.className = "restaurant-card card-link";
    card.href = item.detail_url || "/search/";
    const hasPhoto = Boolean(item.photo_name);
    const photoMarkup = hasPhoto
      ? `<img class="card-thumb card-thumb-photo" src="/api/place-photo/?name=${encodeURIComponent(item.photo_name)}&max_width=520" alt="${item.name}" loading="lazy" />`
      : `<div class="card-thumb card-thumb-default">${String(item.cuisine || "R").slice(0, 1).toUpperCase()}</div>`;
    card.innerHTML = `
      ${photoMarkup}
      <div class="chip-row">
        <span class="chip">${String(item.cuisine || "Restaurant").replace(/\b\w/g, (c) => c.toUpperCase())}</span>
        <span class="chip">${item.distance_km ?? "-"} km</span>
      </div>
      <h3>${item.name}</h3>
      <p>${item.address || item.description || ""}</p>
      <div class="card-meta">
        <span>${item.average_cost_for_two || "--"} / 2 pax</span>
        <span>${item.is_open_now ? "Open" : "Closed"}</span>
      </div>
    `;
    nearbyGrid.appendChild(card);
  });
}

async function loadNearbyByLocation(latitude, longitude) {
  const response = await fetch(`/api/nearby/?latitude=${latitude}&longitude=${longitude}&limit=12`);
  if (!response.ok) {
    throw new Error("Nearby fetch failed");
  }
  const payload = await response.json();
  renderNearbyRestaurants(payload.results || []);
}

function detectHomeLocation() {
  if (!navigator.geolocation) {
    if (homeLocationStatus) {
      homeLocationStatus.textContent = "Location unavailable. Showing Metro Manila.";
    }
    loadNearbyByLocation(14.5995, 120.9842).catch(() => {});
    return;
  }

  if (homeLocationStatus) {
    homeLocationStatus.textContent = "Detecting your location...";
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      if (homeLocationStatus) {
        homeLocationStatus.textContent = "Showing places near your current location.";
      }
      loadNearbyByLocation(latitude, longitude).catch(() => {
        if (homeLocationStatus) {
          homeLocationStatus.textContent = "Unable to load nearby restaurants right now.";
        }
      });
    },
    () => {
      if (homeLocationStatus) {
        homeLocationStatus.textContent = "Location unavailable. Showing Metro Manila.";
      }
      loadNearbyByLocation(14.5995, 120.9842).catch(() => {});
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

function getHomeManualLocationFields() {
  return {
    country: (homeCountryInput?.value || "").trim(),
    region: (homeRegionInput?.value || "").trim(),
    city: (homeCityInput?.value || "").trim(),
  };
}

async function setHomeManualLocation() {
  const { country, region, city } = getHomeManualLocationFields();

  if (!country && !region && !city) {
    homeLocationStatus.textContent = "Enter at least one field (city/region/country).";
    return false;
  }
  homeSetLocationBtn.disabled = true;
  homeSetLocationBtn.textContent = "Setting...";
  homeLocationStatus.textContent = "Resolving location...";

  try {
    const response = await fetch("/api/resolve-location/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("csrftoken"),
      },
      body: JSON.stringify({ city, region, country }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Could not resolve location.");
    }
    homeLocationStatus.textContent = `Showing places near ${payload.label || "your manual location"}.`;
    try {
      sessionStorage.setItem(HOME_MANUAL_LOCATION_KEY, JSON.stringify({
        latitude: payload.latitude,
        longitude: payload.longitude,
        label: payload.label || "your manual location",
        country,
        region,
        city,
        savedAt: Date.now()
      }));
    } catch (_) {
      // no-op for storage limitations
    }
    loadNearbyByLocation(payload.latitude, payload.longitude);
    return true;
  } catch (error) {
    homeLocationStatus.textContent = error.message || "Unable to resolve that location.";
    return false;
  } finally {
    homeSetLocationBtn.disabled = false;
    homeSetLocationBtn.textContent = "Set Location";
  }
}

function wireRecommendationChips() {
  if (!recommendationChips) return;
  recommendationChips.querySelectorAll(".clickable-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const query = chip.dataset.query || "";
      const encoded = encodeURIComponent(query);
      window.location.href = `/search/?q=${encoded}`;
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

function dismissHomeOnboarding() {
  localStorage.setItem(APP_TIPS_DISMISSED_KEY, "1");
  if (homeOnboardingMount) {
    homeOnboardingMount.innerHTML = "";
  }
}

function mountHomeOnboarding() {
  if (!homeOnboardingMount) return;
  const dismissed = localStorage.getItem(APP_TIPS_DISMISSED_KEY) === "1";
  if (dismissed) {
    homeOnboardingMount.innerHTML = "";
    return;
  }

  homeOnboardingMount.innerHTML = `
    <aside class="onboarding-card" role="note" aria-label="Home tips">
      <button id="homeOnboardingCloseBtn" class="onboarding-close" type="button" aria-label="Close tips">X</button>
      <h3>Quick start</h3>
      <ul>
        <li>Tap a craving chip or speak into the mic.</li>
        <li>Add a location for nearby matches.</li>
      </ul>
      <div class="onboarding-actions">
        <button id="homeOnboardingDismissBtn" class="btn primary" type="button">Got it</button>
        <button id="homeOnboardingLaterBtn" class="btn ghost" type="button">Maybe later</button>
      </div>
    </aside>
  `;

  homeOnboardingMount.querySelector("#homeOnboardingCloseBtn")?.addEventListener("click", dismissHomeOnboarding);
  homeOnboardingMount.querySelector("#homeOnboardingDismissBtn")?.addEventListener("click", dismissHomeOnboarding);
  homeOnboardingMount.querySelector("#homeOnboardingLaterBtn")?.addEventListener("click", dismissHomeOnboarding);
}

homeSetLocationBtn?.addEventListener("click", setHomeManualLocation);
homeSearchForm?.addEventListener("submit", async (event) => {
  const { country, region, city } = getHomeManualLocationFields();
  if (!country && !region && !city) return;

  event.preventDefault();
  const locationReady = await setHomeManualLocation();
  if (!locationReady) return;

  const query = (homeQueryInput?.value || "").trim();
  window.location.href = `/search/${query ? `?q=${encodeURIComponent(query)}` : ""}`;
});
[homeCountryInput, homeRegionInput, homeCityInput].forEach((input) => {
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      setHomeManualLocation();
    }
  });
});
wireRecommendationChips();
mountHomeOnboarding();
detectHomeLocation();

function chooseSpeechLocale() {
  const lang = String(navigator.language || "").toLowerCase();
  if (lang.startsWith("fil") || lang.startsWith("tl")) {
    return "fil-PH";
  }
  return "en-US";
}

function normalizeVoiceQuery(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lowered = raw.toLowerCase();
  const replacements = [
    [/\bmalapit\s+sa\s+akin\b/gi, "near me"],
    [/\bmalapit\b/gi, "near"],
    [/\bbukas\s+ngayon\b/gi, "open now"],
    [/\bbukas\b/gi, "open"],
    [/\bmas\s+mura\b/gi, "cheaper"],
    [/\bsamgyup\b/gi, "samgyupsal"],
  ];
  const normalized = replacements.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), lowered);
  return normalized.replace(/\s{2,}/g, " ").trim();
}

const HomeSpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (HomeSpeechRecognition && homeVoiceBtn) {
  const recognition = new HomeSpeechRecognition();
  recognition.lang = chooseSpeechLocale();
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  homeVoiceBtn.addEventListener("click", () => {
    homeVoiceBtn.disabled = true;
    homeVoiceBtn.classList.add("listening");
    if (homeVoiceStatus) {
      homeVoiceStatus.textContent = "Listening... tell me what you want to eat.";
    }
    recognition.start();
  });

  recognition.onresult = (event) => {
    const transcript = normalizeVoiceQuery(event.results?.[0]?.[0]?.transcript || "");
    if (!transcript) return;

    if (homeQueryInput) {
      homeQueryInput.value = transcript;
    }
    if (homeVoiceStatus) {
      homeVoiceStatus.textContent = `Heard: "${transcript}"`;
    }
    window.location.href = `/search/?q=${encodeURIComponent(transcript)}`;
  };

  recognition.onerror = (event) => {
    if (homeVoiceStatus) {
      homeVoiceStatus.textContent = `Voice error: ${event.error}. Try again.`;
    }
  };

  recognition.onend = () => {
    homeVoiceBtn.disabled = false;
    homeVoiceBtn.classList.remove("listening");
  };
} else if (homeVoiceBtn) {
  homeVoiceBtn.disabled = true;
  if (homeVoiceStatus) {
    homeVoiceStatus.textContent = "Voice input is not supported in this browser.";
  }
}
