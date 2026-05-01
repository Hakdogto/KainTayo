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


def build_smart_detail_payload(data: dict, is_external: bool) -> dict:
    name = str(data.get("name", "This restaurant")).strip()
    cuisine = str(data.get("cuisine", "")).strip()
    address = str(data.get("address", "")).strip()
    rating = data.get("rating")
    budget_for_two = data.get("average_cost_for_two")
    price_level = _price_label(data.get("price_level"))
    open_now = _open_now_label(data, is_external)
    summary_text = str(data.get("summary") or data.get("description") or "").strip()
    phone = str(data.get("phone", "")).strip()
    website = str(data.get("website", "")).strip()
    maps_url = str(data.get("maps_url", "")).strip()

    bullets: list[str] = []

    if cuisine:
        bullets.append(f"Cuisine: {cuisine.title()}")
    if rating not in [None, "", "N/A"]:
        bullets.append(f"Rated {rating}/5")
    if budget_for_two:
        bullets.append(f"Estimated budget for 2: PHP {budget_for_two}")
    elif price_level:
        bullets.append(f"Price range: {price_level}")
    if open_now:
        bullets.append(open_now)
    if address:
        bullets.append(f"Location: {address}")

    if summary_text:
        short_summary = summary_text[:220].rstrip()
        if len(summary_text) > 220:
            short_summary += "..."
    else:
        base = f"{name} is"
        if cuisine:
            base += f" a {cuisine} restaurant"
        else:
            base += " a restaurant"
        if address:
            base += f" in {address}"
        short_summary = f"{base}. Check current hours, pricing, and branch details before visiting."

    return {
        "summary": short_summary,
        "bullets": bullets[:5],
        "quick_answer": short_summary,
        "branch_contact": [
            item
            for item in [
                f"Address: {address}" if address else "",
                f"Phone: {phone}" if phone else "",
                "Website available" if website else "",
                "Google Maps link available" if maps_url else "",
            ]
            if item
        ][:4],
        "menu_price_snapshot": [
            item
            for item in [
                f"Budget for 2: PHP {budget_for_two}" if budget_for_two else "",
                f"Price range: {price_level}" if price_level else "",
                f"Status: {open_now}" if open_now else "",
                f"Rating: {rating}/5" if rating not in [None, '', 'N/A'] else "",
            ]
            if item
        ][:4],
    }
