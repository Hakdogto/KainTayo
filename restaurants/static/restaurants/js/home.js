const nearbyGrid = document.getElementById("nearbyGrid");
const homeLocationStatus = document.getElementById("homeLocationStatus");
const homeQueryInput = document.getElementById("homeQueryInput");
const homeVoiceBtn = document.getElementById("homeVoiceBtn");
const homeVoiceStatus = document.getElementById("homeVoiceStatus");
const homeCountryInput = document.getElementById("homeCountryInput");
const homeRegionInput = document.getElementById("homeRegionInput");
const homeCityInput = document.getElementById("homeCityInput");
const homeSetLocationBtn = document.getElementById("homeSetLocationBtn");
const recommendationChips = document.getElementById("recommendationChips");
const homeOnboardingMount = document.getElementById("homeOnboardingMount");
const HOME_ONBOARDING_KEY = "homeOnboardingSeenV1";

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
    homeLocationStatus.textContent = "Location services are unavailable. Showing default recommendations.";
    loadNearbyByLocation(14.5995, 120.9842).catch(() => {});
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      homeLocationStatus.textContent = "Showing places near your current location.";
      loadNearbyByLocation(latitude, longitude).catch(() => {
        homeLocationStatus.textContent = "Unable to load nearby restaurants right now.";
      });
    },
    () => {
      homeLocationStatus.textContent = "Location access denied. Showing recommendations near Metro Manila.";
      loadNearbyByLocation(14.5995, 120.9842).catch(() => {});
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

async function setHomeManualLocation() {
  const country = (homeCountryInput?.value || "").trim();
  const region = (homeRegionInput?.value || "").trim();
  const city = (homeCityInput?.value || "").trim();

  if (!country && !region && !city) {
    homeLocationStatus.textContent = "Enter at least one field (city/region/country).";
    return;
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
    loadNearbyByLocation(payload.latitude, payload.longitude);
  } catch (error) {
    homeLocationStatus.textContent = error.message || "Unable to resolve that location.";
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

function mountHomeOnboarding(force = false) {
  if (!homeOnboardingMount) return;
  const seen = localStorage.getItem(HOME_ONBOARDING_KEY) === "1";
  if (seen && !force) {
    homeOnboardingMount.innerHTML = `
      <div class="onboarding-inline-row">
        <button id="showHomeTipsAgainBtn" class="chip" type="button">Show tips again</button>
      </div>
    `;
    homeOnboardingMount.querySelector("#showHomeTipsAgainBtn")?.addEventListener("click", () => {
      mountHomeOnboarding(true);
    });
    return;
  }

  homeOnboardingMount.innerHTML = `
    <aside class="onboarding-card" role="note" aria-label="Home tips">
      <h3>How to start quickly</h3>
      <ul>
        <li>Use recommendation chips for instant Smart Search presets.</li>
        <li>Tap the mic and describe your craving naturally.</li>
        <li>For broader suggestions, switch to <a href="/ai-search/">AI Search</a>.</li>
      </ul>
      <div class="onboarding-actions">
        <button id="homeOnboardingDismissBtn" class="btn primary" type="button">Got it</button>
        <button id="homeOnboardingLaterBtn" class="btn ghost" type="button">Maybe later</button>
      </div>
    </aside>
  `;

  homeOnboardingMount.querySelector("#homeOnboardingDismissBtn")?.addEventListener("click", () => {
    localStorage.setItem(HOME_ONBOARDING_KEY, "1");
    mountHomeOnboarding(false);
  });
  homeOnboardingMount.querySelector("#homeOnboardingLaterBtn")?.addEventListener("click", () => {
    homeOnboardingMount.innerHTML = "";
  });
}

homeSetLocationBtn?.addEventListener("click", setHomeManualLocation);
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
homeLocationStatus.textContent = "Showing default picks. Tap Set Location to load nearby results.";

const HomeSpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (HomeSpeechRecognition && homeVoiceBtn) {
  const recognition = new HomeSpeechRecognition();
  recognition.lang = "en-US";
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
    const transcript = (event.results?.[0]?.[0]?.transcript || "").trim();
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
