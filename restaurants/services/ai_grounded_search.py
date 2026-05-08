import hashlib
import json
import re
import urllib.error
import urllib.request

from django.conf import settings
from django.core.cache import cache

AI_GROUNDED_CACHE_VERSION = "v2"


def _build_prompt(query: str, location_hint: str = "") -> str:
    location_text = f" Prioritize places near: {location_hint}." if location_hint else ""
    return (
        "You are a local food discovery assistant that answers like a concise Google AI food result."
        " Return JSON only with schema:"
        ' {"summary": string, "results": [{"name": string, "group": string, "category": string, '
        '"why": string, "vibe": string, "highlights": string, "area": string, "address": string, '
        '"rating_hint": string, "review_hint": string, "hours_hint": string, "price_hint": string, '
        '"source_url": string, "confidence": number}]}.' 
        " Include 5-7 results max. Only include food-related businesses like restaurants, cafes,"
        " bakeries, milk tea, groceries, and food stalls. Exclude unrelated businesses."
        " For best/top queries, rank by dish or cuisine fit, rating strength, review volume,"
        " local popularity, specialty match, and distance to the requested place."
        " Prefer standout local or specialty spots over generic chains; include chains only when"
        " they are genuinely among the strongest matches."
        " Every result name must be a real business/place name, not a description, category,"
        " heading, or repeated summary sentence. Never use the summary as a result card."
        " Use short useful groups such as Fried & Boneless Chicken, Grilled & Local Favorites,"
        " Unlimited Wings, Cafes, or Budget Picks when they fit."
        " Summary must be 1-2 short sentences. Each result should have practical highlights,"
        " vibe, rating/review hints when available, and concise address or hours hints when known."
        " Avoid repeating the same generic description across cards."
        f"{location_text}"
        f" User request: {query}"
    )


def _build_repair_prompt(query: str, location_hint: str = "") -> str:
    location_text = f" near {location_hint}" if location_hint else ""
    return (
        "Return valid JSON only. No markdown. No prose outside JSON. "
        "Use this exact schema: "
        '{"summary": string, "results": [{"name": string, "group": string, "category": string, '
        '"why": string, "vibe": string, "highlights": string, "area": string, "address": string, '
        '"rating_hint": string, "review_hint": string, "hours_hint": string, "price_hint": string, '
        '"source_url": string, "confidence": number}]}. '
        "The results array must contain 5-6 real food business names only. "
        "Do not put a summary, heading, dish category, or descriptive sentence in name. "
        "Prefer local/specialty favorites over generic chains when possible. "
        f"User request: {query}{location_text}"
    )


def _build_plaintext_fallback_prompt(query: str, location_hint: str = "") -> str:
    location_text = f" near {location_hint}" if location_hint else ""
    return (
        "List 6 strong local food-related places only (restaurants/cafes/bakeries/milk tea). "
        "Prioritize dish fit, ratings, review volume, local popularity, and specialty match. "
        "Prefer standout local or specialty spots over generic chains unless the chain is truly relevant. "
        "Return plain text lines only in this exact format: "
        "Name - group; rating/reviews if known; short reason. "
        "No JSON. No markdown. No code fences. "
        f"Query: {query}{location_text}"
    )


def _fallback_payload(query: str) -> dict:
    return {
        "summary": "AI grounding is unavailable right now. Please refine your food query and try again.",
        "results": [],
        "query": query,
        "grounded_ok": False,
        "error_code": "grounding_unavailable",
    }


def _extract_json_candidate(text: str):
    cleaned = str(text or "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    object_match = re.search(r"\{[\s\S]*\}", cleaned)
    if object_match:
        try:
            return json.loads(object_match.group(0))
        except json.JSONDecodeError:
            pass

    array_match = re.search(r"\[[\s\S]*\]", cleaned)
    if array_match:
        try:
            parsed = json.loads(array_match.group(0))
            return {"summary": "Here are grounded food suggestions.", "results": parsed}
        except json.JSONDecodeError:
            pass
    return None


def _extract_json_like_results(text: str) -> dict | None:
    cleaned = str(text or "")
    summary_match = re.search(r'"summary"\s*:\s*"([^"]+)"', cleaned)
    summary = summary_match.group(1).strip() if summary_match else "Here are grounded food suggestions."

    names = re.findall(r'"name"\s*:\s*"([^"]+)"', cleaned)
    if not names:
        return None
    categories = re.findall(r'"category"\s*:\s*"([^"]+)"', cleaned)
    groups = re.findall(r'"group"\s*:\s*"([^"]+)"', cleaned)
    whys = re.findall(r'"why"\s*:\s*"([^"]+)"', cleaned)
    vibes = re.findall(r'"vibe"\s*:\s*"([^"]+)"', cleaned)
    highlights = re.findall(r'"highlights"\s*:\s*"([^"]+)"', cleaned)
    areas = re.findall(r'"area"\s*:\s*"([^"]+)"', cleaned)
    addresses = re.findall(r'"address"\s*:\s*"([^"]+)"', cleaned)
    ratings = re.findall(r'"rating_hint"\s*:\s*"([^"]+)"', cleaned)
    reviews = re.findall(r'"review_hint"\s*:\s*"([^"]+)"', cleaned)
    hours = re.findall(r'"hours_hint"\s*:\s*"([^"]+)"', cleaned)
    prices = re.findall(r'"price_hint"\s*:\s*"([^"]+)"', cleaned)

    results = []
    for index, name in enumerate(names[:8]):
        clean_name = str(name).strip()
        if not clean_name:
            continue
        results.append(
            {
                "name": clean_name[:120],
                "category": (categories[index] if index < len(categories) else "restaurant")[:80],
                "group": (groups[index] if index < len(groups) else "")[:80],
                "why": (whys[index] if index < len(whys) else "Recommended based on grounded search.")[:220],
                "vibe": (vibes[index] if index < len(vibes) else "")[:160],
                "highlights": (highlights[index] if index < len(highlights) else "")[:220],
                "area": (areas[index] if index < len(areas) else "")[:140],
                "address": (addresses[index] if index < len(addresses) else "")[:220],
                "rating_hint": (ratings[index] if index < len(ratings) else "")[:60],
                "review_hint": (reviews[index] if index < len(reviews) else "")[:80],
                "hours_hint": (hours[index] if index < len(hours) else "")[:120],
                "price_hint": (prices[index] if index < len(prices) else "")[:80],
                "source_url": "",
                "confidence": 0.55,
            }
        )

    if not results:
        return None
    return {"summary": summary[:180], "results": results}


def _bounded_text(row: dict, key: str, limit: int) -> str:
    return str(row.get(key, "")).strip()[:limit]


def _looks_like_summary_text(value: str, summary: str = "") -> bool:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        return True
    lowered = text.lower()
    summary_lowered = re.sub(r"\s+", " ", str(summary or "")).strip().lower()
    if summary_lowered and (
        lowered == summary_lowered
        or lowered in summary_lowered
        or summary_lowered in lowered
    ):
        return True
    summary_starters = (
        "discover ",
        "here are ",
        "these ",
        "this ",
        "the best ",
        "top spots ",
        "top picks ",
        "best places ",
        "for your ",
    )
    if lowered.startswith(summary_starters):
        return True
    if len(text.split()) > 10:
        return True
    if len(text) > 90:
        return True
    if text.endswith(".") and len(text.split()) > 4:
        return True
    return False


def _detail_looks_like_summary(value: str, summary: str = "") -> bool:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        return True
    lowered = text.lower()
    summary_lowered = re.sub(r"\s+", " ", str(summary or "")).strip().lower()
    if summary_lowered and (
        lowered == summary_lowered
        or (len(lowered) > 40 and lowered in summary_lowered)
        or (len(summary_lowered) > 40 and summary_lowered in lowered)
    ):
        return True
    return lowered.startswith(("discover ", "here are ", "these establishments ", "top spots "))


def _valid_business_row(row: dict, summary: str = "") -> bool:
    if not isinstance(row, dict):
        return False
    name = str(row.get("name", "")).strip()
    if _looks_like_summary_text(name, summary=summary):
        return False
    category = str(row.get("category", "")).strip().lower()
    if name.lower() in {"restaurant", "food", "chicken", "top picks", "best chicken"}:
        return False
    if category in {"summary", "heading", "recommendation"}:
        return False
    detail_text = " ".join(
        str(row.get(key, "")).strip()
        for key in ("why", "highlights", "vibe", "address", "area", "rating_hint", "review_hint")
    )
    if not detail_text.strip():
        return False
    if _detail_looks_like_summary(str(row.get("why", "")), summary=summary) and _detail_looks_like_summary(
        str(row.get("highlights", "")), summary=summary
    ):
        return False
    return True


def _extract_plaintext_results(text: str) -> dict | None:
    cleaned = str(text or "").strip()
    if not cleaned:
        return None

    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    if not lines:
        return None

    summary = lines[0][:180]
    candidates = []
    for line in lines:
        if any(token in line.lower() for token in ["```", '"summary"', '"results"', "{", "}", "[", "]"]):
            continue
        if line.strip().upper() in {"RESTAURANT", "JSON"}:
            continue
        line = re.sub(r"^\d+[\).\-\s]+", "", line).strip()
        line = re.sub(r"^[\-\*\u2022]\s*", "", line).strip()
        if len(line) < 4:
            continue

        parts = re.split(r"\s+[-:]\s+", line, maxsplit=1)
        name = parts[0].strip(" -*•")
        why = parts[1].strip() if len(parts) > 1 else line
        if not name:
            continue
        candidates.append(
            {
                "name": name[:120],
                "category": "restaurant",
                "why": why[:220],
                "area": "",
                "price_hint": "",
                "source_url": "",
                "confidence": 0.45,
            }
        )
        if len(candidates) >= 8:
            break

    if not candidates:
        return None
    return {"summary": summary, "results": candidates}


def _build_request_payload(query: str, location_hint: str, tool_variant: str, strict_json: bool) -> dict:
    payload = {
        "system_instruction": {
            "parts": [
                {
                    "text": (
                        "Only return food and restaurant related businesses. Output valid JSON only."
                        " Prioritize specific local favorites and specialty places over generic chains."
                    )
                }
            ]
        },
        "contents": [{"parts": [{"text": _build_prompt(query, location_hint=location_hint)}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 1800,
        },
    }
    if strict_json:
        payload["generationConfig"]["responseMimeType"] = "application/json"
    if tool_variant == "google_search":
        payload["tools"] = [{"google_search": {}}]
    elif tool_variant == "google_search_retrieval":
        payload["tools"] = [{"google_search_retrieval": {}}]
    return payload


def _build_plaintext_request_payload(query: str, location_hint: str) -> dict:
    return {
        "contents": [
            {
                "parts": [
                    {"text": _build_plaintext_fallback_prompt(query=query, location_hint=location_hint)}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 1000,
        },
    }


def _build_repair_request_payload(query: str, location_hint: str) -> dict:
    return {
        "system_instruction": {
            "parts": [
                {
                    "text": (
                        "Output valid JSON only. Include real food business names only."
                    )
                }
            ]
        },
        "contents": [
            {
                "parts": [
                    {"text": _build_repair_prompt(query=query, location_hint=location_hint)}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 1600,
            "responseMimeType": "application/json",
        },
        "tools": [{"google_search": {}}],
    }


def _call_gemini(payload: dict, timeout: int = 12):
    request = urllib.request.Request(
        (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{settings.GEMINI_MODEL}:generateContent?key={settings.GEMINI_API_KEY}"
        ),
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _extract_text_from_body(body: dict) -> str:
    text_parts = []
    for candidate in body.get("candidates", []):
        content = candidate.get("content", {})
        for part in content.get("parts", []):
            if part.get("text"):
                text_parts.append(str(part.get("text")))
    return "\n".join(text_parts).strip()


def _parse_ai_text(text: str) -> dict | None:
    parsed = _extract_json_candidate(text)
    if not isinstance(parsed, dict):
        parsed = _extract_json_like_results(text)
    if not isinstance(parsed, dict):
        parsed = _extract_plaintext_results(text)
    return parsed if isinstance(parsed, dict) else None


def _normalize_results(parsed: dict) -> list[dict]:
    summary = str(parsed.get("summary", "")).strip()
    results = parsed.get("results", [])
    if not isinstance(results, list):
        return []

    normalized = []
    for row in results[:8]:
        if not _valid_business_row(row, summary=summary):
            continue
        category = str(row.get("category", "")).strip().lower()
        name = str(row.get("name", "")).strip()[:120]
        try:
            confidence = float(row.get("confidence", 0) or 0)
        except (TypeError, ValueError):
            confidence = 0
        normalized.append(
            {
                "name": name,
                "category": category or "restaurant",
                "group": _bounded_text(row, "group", 80),
                "why": _bounded_text(row, "why", 240),
                "vibe": _bounded_text(row, "vibe", 160),
                "highlights": _bounded_text(row, "highlights", 220),
                "area": _bounded_text(row, "area", 140),
                "address": _bounded_text(row, "address", 220),
                "rating_hint": _bounded_text(row, "rating_hint", 60),
                "review_hint": _bounded_text(row, "review_hint", 80),
                "hours_hint": _bounded_text(row, "hours_hint", 120),
                "price_hint": _bounded_text(row, "price_hint", 80),
                "source_url": _bounded_text(row, "source_url", 350),
                "confidence": max(0.0, min(confidence, 1.0)),
            }
        )
    return normalized


def run_grounded_food_search(query: str, location_hint: str = "") -> dict:
    if not settings.GEMINI_API_KEY:
        return _fallback_payload(query)

    cache_fingerprint = hashlib.sha256(
        f"{query.strip().lower()}|{location_hint.strip().lower()}".encode("utf-8")
    ).hexdigest()
    cache_key = f"ai_grounded:{AI_GROUNDED_CACHE_VERSION}:{cache_fingerprint}"
    cached = cache.get(cache_key)
    if isinstance(cached, dict):
        return cached

    attempts = [
        ("google_search", True),
        ("google_search_retrieval", False),
        ("none", False),
    ]
    body = None
    last_error_code = "network_error"

    for tool_variant, strict_json in attempts:
        request_payload = _build_request_payload(
            query=query,
            location_hint=location_hint,
            tool_variant=tool_variant,
            strict_json=strict_json,
        )
        try:
            body = _call_gemini(request_payload, timeout=12)
            break
        except urllib.error.HTTPError as exc:
            if exc.code in {400, 404}:
                last_error_code = "invalid_request"
                continue
            last_error_code = "network_error"
            continue
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
            last_error_code = "network_error"
            continue

    if not isinstance(body, dict):
        payload = _fallback_payload(query)
        payload["error_code"] = last_error_code
        return payload

    text = _extract_text_from_body(body)
    if not text:
        return _fallback_payload(query)

    parsed = _parse_ai_text(text)
    if not isinstance(parsed, dict):
        try:
            retry_body = _call_gemini(
                _build_repair_request_payload(query, location_hint),
                timeout=8,
            )
            retry_text = _extract_text_from_body(retry_body)
            parsed = _parse_ai_text(retry_text)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
            parsed = None
    if not isinstance(parsed, dict):
        payload = _fallback_payload(query)
        payload["error_code"] = "parse_error"
        return payload

    normalized = _normalize_results(parsed)
    if not normalized:
        try:
            retry_body = _call_gemini(
                _build_repair_request_payload(query, location_hint),
                timeout=8,
            )
            retry_text = _extract_text_from_body(retry_body)
            retry_parsed = _parse_ai_text(retry_text)
            if isinstance(retry_parsed, dict):
                retry_normalized = _normalize_results(retry_parsed)
                if retry_normalized:
                    parsed = retry_parsed
                    normalized = retry_normalized
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
            pass
    if not normalized:
        payload = _fallback_payload(query)
        payload["error_code"] = "parse_error"
        return payload

    final_payload = {
        "summary": str(parsed.get("summary", "")).strip()
        or "Here are food-related places based on grounded web results.",
        "results": normalized,
        "query": query,
        "grounded_ok": True,
        "error_code": "",
    }
    cache.set(cache_key, final_payload, timeout=60 * 10)
    return final_payload
