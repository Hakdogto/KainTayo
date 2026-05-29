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

function safeAppPath(rawUrl, fallback = "/search/") {
  try {
    const parsed = new URL(String(rawUrl || ""), window.location.origin);
    if (parsed.origin !== window.location.origin || !["http:", "https:"].includes(parsed.protocol)) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (error) {
    return fallback;
  }
}

function titleCase(value) {
  return String(value || "Restaurant").replace(/\b\w/g, (char) => char.toUpperCase());
}

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
    card.href = safeAppPath(item.detail_url);
    const hasPhoto = Boolean(item.photo_name);

    if (hasPhoto) {
      const photo = document.createElement("img");
      photo.className = "card-thumb card-thumb-photo";
      photo.src = `/api/place-photo/?name=${encodeURIComponent(item.photo_name)}&max_width=520`;
      photo.alt = item.name || "Restaurant photo";
      photo.loading = "lazy";
      card.appendChild(photo);
    } else {
      const thumb = document.createElement("div");
      thumb.className = "card-thumb card-thumb-default";
      thumb.textContent = String(item.cuisine || "R").slice(0, 1).toUpperCase();
      card.appendChild(thumb);
    }

    const chipRow = document.createElement("div");
    chipRow.className = "chip-row";
    const cuisineChip = document.createElement("span");
    cuisineChip.className = "chip";
    cuisineChip.textContent = titleCase(item.cuisine);
    const distanceChip = document.createElement("span");
    distanceChip.className = "chip";
    distanceChip.textContent = `${item.distance_km ?? "-"} km`;
    chipRow.append(cuisineChip, distanceChip);

    const title = document.createElement("h3");
    title.textContent = item.name || "Restaurant";
    const address = document.createElement("p");
    address.textContent = item.address || item.description || "";

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const cost = document.createElement("span");
    cost.textContent = `${item.average_cost_for_two || "--"} / 2 pax`;
    const status = document.createElement("span");
    status.textContent = item.is_open_now ? "Open" : "Closed";
    meta.append(cost, status);

    card.append(chipRow, title, address, meta);
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

const HomeSpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (HomeSpeechRecognition && homeVoiceBtn) {
  const recognition = new HomeSpeechRecognition();
  recognition.lang = window.KainTayoVoice?.chooseSpeechLocale?.() || "en-US";
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
    const command = window.KainTayoVoice?.commandFor?.(event.results?.[0]?.[0]?.transcript || "") || { action: "empty", text: "" };
    if (command.action === "empty") return;

    if (command.action === "navigate") {
      if (homeVoiceStatus) {
        homeVoiceStatus.textContent = `Opening ${command.url}`;
      }
      window.location.href = command.url;
      return;
    }

    if (command.action === "clear") {
      if (homeQueryInput) {
        homeQueryInput.value = "";
      }
      if (homeVoiceStatus) {
        homeVoiceStatus.textContent = "Search cleared.";
      }
      return;
    }

    if (command.action !== "search") return;

    if (homeQueryInput) {
      homeQueryInput.value = command.text;
    }
    if (homeVoiceStatus) {
      homeVoiceStatus.textContent = `Heard: "${command.text}"`;
    }
    window.location.href = `/search/?q=${encodeURIComponent(command.text)}`;
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
