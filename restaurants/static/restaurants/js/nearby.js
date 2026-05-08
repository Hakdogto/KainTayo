const nearbyList = document.getElementById("nearbyList");
const locationStatus = document.getElementById("nearbyLocationStatus");
const useCurrentBtn = document.getElementById("nearbyUseCurrentBtn");
const setLocationBtn = document.getElementById("nearbySetLocationBtn");
const countryInput = document.getElementById("nearbyCountryInput");
const regionInput = document.getElementById("nearbyRegionInput");
const cityInput = document.getElementById("nearbyCityInput");
const loadMoreBtn = document.getElementById("nearbyLoadMoreBtn");
const nearbyLayoutButtons = document.querySelectorAll(".layout-toggle-btn[data-layout]");
const NEARBY_LAYOUT_KEY = "nearbyResultsLayoutV1";

let map;
let markers = [];
let userMarker = null;
let userLat = 14.5995;
let userLon = 120.9842;
let nextOffset = 0;
let hasMore = false;
let leafletReady = typeof window.L !== "undefined";
let nearbyLayout = localStorage.getItem(NEARBY_LAYOUT_KEY) === "swipe" ? "swipe" : "vertical";

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
      locationStatus.textContent = "Map failed to load. Nearby list still works.";
    }
    return;
  }
  map = L.map("map").setView([userLat, userLon], 13);

  const addOsm = () => L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  if (!window.MAPBOX_ACCESS_TOKEN) {
    addOsm();
    return;
  }

  const mapboxLayer = L.tileLayer(
    `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${window.MAPBOX_ACCESS_TOKEN}`,
    { tileSize: 512, zoomOffset: -1, maxZoom: 19, attribution: "&copy; Mapbox &copy; OpenStreetMap contributors" }
  );

  let fellBack = false;
  mapboxLayer.on("tileerror", () => {
    if (fellBack) return;
    fellBack = true;
    map.removeLayer(mapboxLayer);
    addOsm();
  });

  mapboxLayer.addTo(map);
}

function ensureMapReady() {
  if (!leafletReady || map) return;
  initMap();
}

function clearMarkers() {
  if (!leafletReady || !map) return;
  markers.forEach((marker) => map.removeLayer(marker));
  markers = [];
}

function setUserLocation(lat, lon, label) {
  ensureMapReady();
  userLat = lat;
  userLon = lon;
  if (leafletReady && map) {
    map.setView([lat, lon], 13);
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.circleMarker([lat, lon], { radius: 8 }).addTo(map).bindPopup("You are here");
  }
  locationStatus.textContent = label;
}

function applyNearbyLayout(layout = nearbyLayout) {
  nearbyLayout = layout === "swipe" ? "swipe" : "vertical";
  nearbyList?.classList.toggle("results-list-swipe", nearbyLayout === "swipe");
  nearbyList?.classList.toggle("results-list-vertical", nearbyLayout === "vertical");
  nearbyLayoutButtons.forEach((button) => {
    const isActive = button.dataset.layout === nearbyLayout;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  try {
    localStorage.setItem(NEARBY_LAYOUT_KEY, nearbyLayout);
  } catch (_) {
    // no-op for storage limitations
  }
}

function renderList(items, { append = false } = {}) {
  ensureMapReady();
  if (!append) {
    nearbyList.innerHTML = "";
    clearMarkers();
  }
  applyNearbyLayout();
  if (!items.length) {
    nearbyList.innerHTML = '<p class="empty-state">No nearby restaurants found.</p>';
    if (loadMoreBtn) loadMoreBtn.style.display = "none";
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "result-item clickable";
    const hasPhoto = Boolean(item.photo_name);
    const photoMarkup = hasPhoto
      ? `<img class="result-photo" src="/api/place-photo/?name=${encodeURIComponent(item.photo_name)}&max_width=360" alt="${item.name}" loading="lazy" decoding="async" />`
      : `<div class="card-thumb card-thumb-default">${String(item.cuisine || "R").slice(0, 1).toUpperCase()}</div>`;
    const attributionMarkup = item.photo_author ? `<p class="photo-credit">Photo: ${item.photo_author}</p>` : "";
    card.innerHTML = `
      ${photoMarkup}
      <h3>${item.name}</h3>
      <p>${String(item.cuisine || "restaurant").toUpperCase()} | ${item.distance_km} km | Rating ${item.rating}</p>
      <p>${item.address || ""}</p>
      ${attributionMarkup}
      <div class="actions">
        <span>PHP ${item.average_cost_for_two || "--"} / 2 pax</span>
        ${item.detail_url ? `<a class="link-btn" href="${item.detail_url}">Details</a>` : ""}
      </div>
    `;

    if (item.detail_url) {
      card.addEventListener("click", () => {
        window.location.href = item.detail_url;
      });
      const link = card.querySelector(".link-btn");
      if (link) link.addEventListener("click", (event) => event.stopPropagation());
    }

    nearbyList.appendChild(card);

    if (leafletReady && map) {
      const marker = L.marker([item.latitude, item.longitude]).addTo(map);
      marker.bindPopup(`<b>${item.name}</b><br/>${item.address || ""}`);
      markers.push(marker);
    }
  });

  if (loadMoreBtn) {
    loadMoreBtn.style.display = hasMore ? "inline-flex" : "none";
  }
}

async function loadNearby({ append = false } = {}) {
  const offset = append ? nextOffset : 0;
  const response = await fetch(`/api/nearby/?latitude=${userLat}&longitude=${userLon}&limit=12&offset=${offset}`);
  if (!response.ok) {
    throw new Error("Failed to fetch nearby restaurants");
  }
  const payload = await response.json();
  const page = payload.results || [];
  const pagination = payload.pagination || {};
  nextOffset = Number.isInteger(pagination.next_offset) ? pagination.next_offset : 0;
  hasMore = Boolean(pagination.has_more);
  renderList(page, { append });
}

function detectLocation() {
  if (!navigator.geolocation) {
    locationStatus.textContent = "Location unavailable. Using Metro Manila.";
    loadNearby().catch(() => {});
    return;
  }

  locationStatus.textContent = "Detecting your location...";
  ensureMapReady();
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      setUserLocation(latitude, longitude, `Using GPS location (${Math.round(accuracy || 0)}m accuracy).`);
      loadNearby({ append: false }).catch(() => {
        locationStatus.textContent = "Could not load nearby restaurants.";
      });
    },
    () => {
      locationStatus.textContent = "Location denied. Using Metro Manila.";
      loadNearby({ append: false }).catch(() => {});
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
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

  setLocationBtn.disabled = true;
  setLocationBtn.textContent = "Setting...";
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
      throw new Error(payload.error || "Could not resolve location.");
    }

    setUserLocation(payload.latitude, payload.longitude, `Using manual location: ${payload.label || "selected area"}`);
    await loadNearby({ append: false });
  } catch (error) {
    locationStatus.textContent = error.message || "Could not set location.";
  } finally {
    setLocationBtn.disabled = false;
    setLocationBtn.textContent = "Set Location";
  }
}

useCurrentBtn?.addEventListener("click", detectLocation);
setLocationBtn?.addEventListener("click", setManualLocation);
nearbyLayoutButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyNearbyLayout(button.dataset.layout);
  });
});
if (loadMoreBtn) {
  loadMoreBtn.addEventListener("click", async () => {
    if (!hasMore) return;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = "Loading...";
    try {
      await loadNearby({ append: true });
    } finally {
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = "Load more";
    }
  });
}

locationStatus.textContent = "Showing default location. Tap Use My Current Location or Set Location to load nearby results.";
applyNearbyLayout();
