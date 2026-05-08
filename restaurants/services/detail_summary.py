from __future__ import annotations


def _price_label(price_level) -> str:
    if isinstance(price_level, int):
        return f"Level {price_level}/4"
    mapping = {
        "PRICE_LEVEL_INEXPENSIVE": "Budget-friendly",
        "PRICE_LEVEL_MODERATE": "Mid-range",
        "PRICE_LEVEL_EXPENSIVE": "Premium",
        "PRICE_LEVEL_VERY_EXPENSIVE": "High-end",
    }
    return mapping.get(str(price_level or "").strip(), "")


def _open_now_label(data: dict, is_external: bool) -> str:
    value = data.get("open_now") if is_external else data.get("is_open_now")
    if value is True:
        return "Open now"
    if value is False:
        return "Currently closed"
    return ""


def _short_text(value: str, limit: int = 180) -> str:
    cleaned = " ".join(str(value or "").split())
    if len(cleaned) <= limit:
        return cleaned
    return f"{cleaned[:limit].rstrip()}..."


def _directions_url(data: dict, is_external: bool) -> str:
    maps_url = str(data.get("maps_url", "")).strip()
    if maps_url:
        return maps_url
    latitude = data.get("latitude")
    longitude = data.get("longitude")
    if not is_external and latitude is not None and longitude is not None:
        return f"https://www.google.com/maps/search/?api=1&query={latitude},{longitude}"
    return ""


def build_smart_detail_payload(data: dict, is_external: bool) -> dict:
    cuisine = str(data.get("cuisine", "")).strip()
    address = str(data.get("address", "")).strip()
    rating = data.get("rating")
    budget_for_two = data.get("average_cost_for_two")
    price_level = _price_label(data.get("price_level"))
    open_now = _open_now_label(data, is_external)
    overview = _short_text(str(data.get("summary") or data.get("description") or "").strip())
    phone = str(data.get("phone", "")).strip()
    website = str(data.get("website", "")).strip()
    directions_url = _directions_url(data, is_external)

    facts: list[str] = []
    if rating not in [None, "", "N/A"]:
        facts.append(f"Rated {rating}/5")
    if open_now:
        facts.append(open_now)
    if cuisine:
        facts.append(cuisine.title())
    if budget_for_two:
        facts.append(f"PHP {budget_for_two} for 2")
    elif price_level:
        facts.append(price_level)

    practical_info = [
        item
        for item in [
            {"label": "Address", "value": address} if address else None,
            {"label": "Phone", "value": phone} if phone else None,
            {"label": "Website", "value": website} if website else None,
            {"label": "Maps", "value": "Google Maps available"} if directions_url else None,
        ]
        if item
    ]

    return {
        "overview": overview,
        "facts": facts[:5],
        "practical_info": practical_info,
        "directions_url": directions_url,
        "website": website,
        "phone": phone,
    }
