import json
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.cache import cache


def _price_level_to_php(level: str | None) -> int:
    mapping = {
        "PRICE_LEVEL_INEXPENSIVE": 350,
        "PRICE_LEVEL_MODERATE": 800,
        "PRICE_LEVEL_EXPENSIVE": 1500,
        "PRICE_LEVEL_VERY_EXPENSIVE": 2500,
    }
    return mapping.get(level or "PRICE_LEVEL_MODERATE", 800)


def _budget_to_price_levels(budget: int | None) -> list[str]:
    if budget is None:
        return []
    if budget <= 500:
        return ["PRICE_LEVEL_INEXPENSIVE"]
    if budget <= 1200:
        return ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE"]
    if budget <= 2000:
        return [
            "PRICE_LEVEL_INEXPENSIVE",
            "PRICE_LEVEL_MODERATE",
            "PRICE_LEVEL_EXPENSIVE",
        ]
    return [
        "PRICE_LEVEL_INEXPENSIVE",
        "PRICE_LEVEL_MODERATE",
        "PRICE_LEVEL_EXPENSIVE",
        "PRICE_LEVEL_VERY_EXPENSIVE",
    ]


def _build_text_query(query: str, parsed) -> str:
    parts = [query.strip()]
    if parsed.cuisine and parsed.cuisine not in query.lower():
        parts.append(parsed.cuisine)
    if parsed.mood and parsed.mood not in query.lower():
        parts.append(parsed.mood)
    if "restaurant" not in query.lower():
        parts.append("restaurant")
    return " ".join(part for part in parts if part)


def search_google_places(query: str, lat: float, lon: float, parsed, limit: int = 20):
    if not settings.GOOGLE_MAPS_API_KEY:
        return []

    radius_m = int((parsed.max_distance_km or 5) * 1000)

    payload = {
        "textQuery": _build_text_query(query, parsed),
        "pageSize": min(max(limit, 1), 20),
        "locationBias": {
            "circle": {
                "center": {
                    "latitude": lat,
                    "longitude": lon,
                },
                "radius": float(radius_m),
            }
        },
    }

    if parsed.open_now:
        payload["openNow"] = True

    price_levels = _budget_to_price_levels(parsed.budget)
    if price_levels:
        payload["priceLevels"] = price_levels

    cache_key = (
        "places:search:"
        f"{query.strip().lower()}|{round(lat, 3)}|{round(lon, 3)}|"
        f"{parsed.budget}|{parsed.cuisine}|{parsed.mood}|{parsed.open_now}|"
        f"{parsed.max_distance_km}|{parsed.min_rating}|{limit}"
    )
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    request = urllib.request.Request(
        "https://places.googleapis.com/v1/places:searchText",
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": settings.GOOGLE_MAPS_API_KEY,
            "X-Goog-FieldMask": (
                "places.id,places.displayName,places.formattedAddress,"
                "places.location,places.rating,places.priceLevel,"
                "places.currentOpeningHours.openNow,places.photos,"
                "places.primaryTypeDisplayName"
            ),
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception:
        return []

    places = data.get("places", [])

    results = []
    for index, item in enumerate(places[:limit], start=1):
        location = item.get("location", {})
        place_lat = location.get("latitude")
        place_lon = location.get("longitude")
        if place_lat is None or place_lon is None:
            continue

        photos = item.get("photos") or []
        first_photo = photos[0] if photos else {}

        cuisine_name = parsed.cuisine or (
            item.get("primaryTypeDisplayName", {}).get("text", "restaurant").lower()
        )

        results.append(
            {
                "id": f"google-new-{item.get('id', index)}",
                "place_id": item.get("id", ""),
                "name": item.get("displayName", {}).get("text", "Unknown"),
                "cuisine": cuisine_name,
                "mood_tags": parsed.mood or "",
                "description": item.get("formattedAddress", "Google Places listing"),
                "price_level": item.get("priceLevel", "PRICE_LEVEL_MODERATE"),
                "average_cost_for_two": _price_level_to_php(item.get("priceLevel")),
                "rating": item.get("rating", 0),
                "is_open_now": item.get("currentOpeningHours", {}).get("openNow", False),
                "latitude": place_lat,
                "longitude": place_lon,
                "address": item.get("formattedAddress", ""),
                "photo_name": first_photo.get("name", ""),
                "photo_author": (
                    (first_photo.get("authorAttributions") or [{}])[0].get("displayName", "")
                ),
                "source": "google_places_new",
            }
        )

    cache.set(cache_key, results, timeout=60 * 10)
    return results


def get_place_details(place_id: str):
    if not settings.GOOGLE_MAPS_API_KEY or not place_id:
        return None

    cache_key = f"places:detail:{place_id}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    request = urllib.request.Request(
        f"https://places.googleapis.com/v1/places/{urllib.parse.quote(place_id)}",
        method="GET",
        headers={
            "X-Goog-Api-Key": settings.GOOGLE_MAPS_API_KEY,
            "X-Goog-FieldMask": (
                "id,displayName,formattedAddress,location,rating,priceLevel,"
                "internationalPhoneNumber,websiteUri,currentOpeningHours,"
                "editorialSummary,photos,googleMapsUri,primaryTypeDisplayName"
            ),
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            details = json.loads(response.read().decode("utf-8"))
            cache.set(cache_key, details, timeout=60 * 60 * 24)
            return details
    except Exception:
        return None


def fetch_place_photo(photo_name: str, max_width: int = 480):
    if not settings.GOOGLE_MAPS_API_KEY or not photo_name:
        return None, None

    safe_name = urllib.parse.quote(photo_name, safe="/")
    url = (
        f"https://places.googleapis.com/v1/{safe_name}/media"
        f"?maxWidthPx={max_width}&key={settings.GOOGLE_MAPS_API_KEY}"
    )

    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            content_type = response.headers.get("Content-Type", "image/jpeg")
            return response.read(), content_type
    except Exception:
        return None, None


def resolve_location_text(country: str, region: str, city: str):
    query_parts = [part.strip() for part in [city, region, country] if part and part.strip()]
    if not query_parts:
        return None

    query = ", ".join(query_parts)

    if settings.GOOGLE_MAPS_API_KEY:
        cache_key = f"places:resolve:{query.lower()}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        payload = {"textQuery": query, "pageSize": 1}
        request = urllib.request.Request(
            "https://places.googleapis.com/v1/places:searchText",
            method="POST",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": settings.GOOGLE_MAPS_API_KEY,
                "X-Goog-FieldMask": (
                    "places.displayName,places.formattedAddress,places.location"
                ),
            },
        )

        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                data = json.loads(response.read().decode("utf-8"))
            places = data.get("places", [])
            if places:
                first = places[0]
                loc = first.get("location", {})
                resolved = {
                    "latitude": loc.get("latitude"),
                    "longitude": loc.get("longitude"),
                    "label": first.get("formattedAddress")
                    or first.get("displayName", {}).get("text", query),
                }
                cache.set(cache_key, resolved, timeout=60 * 60 * 6)
                return resolved
        except Exception:
            return None

    # Fallback without API key: OpenStreetMap Nominatim
    url = (
        "https://nominatim.openstreetmap.org/search?"
        + urllib.parse.urlencode({"q": query, "format": "json", "limit": 1})
    )
    request = urllib.request.Request(
        url, headers={"User-Agent": "KainTayo/1.0 (location-lookup)"}
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            data = json.loads(response.read().decode("utf-8"))
        if not data:
            return None
        first = data[0]
        return {
            "latitude": float(first.get("lat")),
            "longitude": float(first.get("lon")),
            "label": first.get("display_name", query),
        }
    except Exception:
        return None
