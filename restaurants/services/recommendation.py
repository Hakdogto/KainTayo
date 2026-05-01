from collections import Counter

from restaurants.models import FavoriteRestaurant, Restaurant, SearchHistory


def recommend_for_user(user, session_key: str = "", limit: int = 6):
    is_authed = bool(user and user.is_authenticated)

    if is_authed:
        favorite_cuisines = FavoriteRestaurant.objects.filter(user=user).values_list(
            "restaurant__cuisine", flat=True
        )
        recent_cuisine = SearchHistory.objects.filter(user=user).values_list(
            "interpreted_filters", flat=True
        )[:10]
    elif session_key:
        favorite_cuisines = FavoriteRestaurant.objects.filter(
            session_key=session_key
        ).values_list("restaurant__cuisine", flat=True)
        recent_cuisine = SearchHistory.objects.filter(session_key=session_key).values_list(
            "interpreted_filters", flat=True
        )[:10]
    else:
        favorite_cuisines = []
        recent_cuisine = []

    signals = list(favorite_cuisines)
    for item in recent_cuisine:
        if isinstance(item, dict) and item.get("cuisine"):
            signals.append(item["cuisine"])

    if not signals:
        return Restaurant.objects.order_by("-rating")[:limit]

    top_cuisines = [name for name, _ in Counter(signals).most_common(3)]

    return (
        Restaurant.objects.filter(cuisine__in=top_cuisines)
        .order_by("-rating", "average_cost_for_two")
        .distinct()[:limit]
    )
