import re
from dataclasses import dataclass


CUISINE_KEYWORDS = [
    "korean",
    "samgyupsal",
    "ramen",
    "japanese",
    "sushi",
    "bbq",
    "chinese",
    "thai",
    "filipino",
    "italian",
    "pizza",
    "burger",
    "vegan",
    "coffee",
    "milk tea",
]

MOOD_KEYWORDS = {
    "romantic": ["romantic", "date", "anniversary"],
    "quiet": ["quiet", "peaceful", "calm"],
    "family": ["family", "kids", "child-friendly"],
    "group": ["friends", "group", "hangout"],
}

MISSPELLING_NORMALIZATION = {
    "nearyb": "nearby",
    "nearbby": "nearby",
    "resto": "restaurant",
    "restauant": "restaurant",
    "naturaly": "naturally",
}


@dataclass
class QueryFilters:
    budget: int | None = None
    cuisine: str | None = None
    mood: str | None = None
    open_now: bool = False
    near_me: bool = False
    max_distance_km: float | None = None
    min_rating: float | None = None

    def to_dict(self) -> dict:
        return {
            "budget": self.budget,
            "cuisine": self.cuisine,
            "mood": self.mood,
            "open_now": self.open_now,
            "near_me": self.near_me,
            "max_distance_km": self.max_distance_km,
            "min_rating": self.min_rating,
        }


def _extract_budget(query: str) -> int | None:
    lowered = _normalize_query(query)

    # Supports: PHP 500, 500 pesos, under 1000, below 1.2k, less than 700
    currency_match = re.search(
        r"(?:php|₱|p\b)?\s*(\d{2,5})(?:\s*(?:pesos?|php))?", lowered
    )
    if currency_match:
        return int(currency_match.group(1))

    threshold_match = re.search(r"(?:under|below|less than|max(?:imum)?|up to)\s*(\d+(?:\.\d+)?)\s*(k)?", lowered)
    if threshold_match:
        value = float(threshold_match.group(1))
        if threshold_match.group(2):
            value *= 1000
        return int(value)

    k_match = re.search(r"\b(\d+(?:\.\d+)?)\s*k\b", lowered)
    if k_match:
        return int(float(k_match.group(1)) * 1000)

    if "cheap" in lowered or "affordable" in lowered or "budget" in lowered:
        return 600

    return None


def _extract_cuisine(query: str) -> str | None:
    lowered = _normalize_query(query)
    for keyword in CUISINE_KEYWORDS:
        if keyword in lowered:
            if keyword == "samgyupsal":
                return "korean"
            return keyword
    return None


def _extract_mood(query: str) -> str | None:
    lowered = _normalize_query(query)
    for mood, keywords in MOOD_KEYWORDS.items():
        if any(keyword in lowered for keyword in keywords):
            return mood
    return None


def _extract_distance(query: str) -> float | None:
    lowered = _normalize_query(query)
    if "near me" in lowered or "nearby" in lowered or "around me" in lowered:
        return 5.0

    km_match = re.search(r"(?:within|under|less than)\s*(\d+(?:\.\d+)?)\s*km", lowered)
    if km_match:
        return float(km_match.group(1))

    return None


def _extract_min_rating(query: str) -> float | None:
    lowered = _normalize_query(query)
    explicit = re.search(r"(\d(?:\.\d)?)\s*(?:stars?|star)", lowered)
    if explicit:
        try:
            return max(1.0, min(5.0, float(explicit.group(1))))
        except ValueError:
            return None

    if any(token in lowered for token in ["best", "top", "highly rated", "good ratings"]):
        return 4.2
    return None


def parse_natural_query(query: str) -> QueryFilters:
    lowered = _normalize_query(query)

    return QueryFilters(
        budget=_extract_budget(query),
        cuisine=_extract_cuisine(query),
        mood=_extract_mood(query),
        open_now=("open now" in lowered or "currently open" in lowered or "open" in lowered),
        near_me=("near me" in lowered or "nearby" in lowered or "around me" in lowered),
        max_distance_km=_extract_distance(query),
        min_rating=_extract_min_rating(query),
    )


def _normalize_query(query: str) -> str:
    lowered = query.lower()
    for wrong, correct in MISSPELLING_NORMALIZATION.items():
        lowered = re.sub(rf"\b{re.escape(wrong)}\b", correct, lowered)
    lowered = re.sub(r"\s+", " ", lowered).strip()
    return lowered
