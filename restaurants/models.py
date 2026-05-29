from django.conf import settings
from django.db import models
from django.utils import timezone
from pgvector.django import VectorField


class Restaurant(models.Model):
    name = models.CharField(max_length=255)
    cuisine = models.CharField(max_length=120)
    mood_tags = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    price_level = models.PositiveSmallIntegerField(default=2)  # 1=budget, 4=premium
    average_cost_for_two = models.PositiveIntegerField(default=500)
    rating = models.DecimalField(max_digits=2, decimal_places=1, default=4.0)
    is_open_now = models.BooleanField(default=True)
    latitude = models.FloatField()
    longitude = models.FloatField()
    address = models.CharField(max_length=255)
    embedding = VectorField(dimensions=768, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-rating", "average_cost_for_two"]
        indexes = [
            models.Index(fields=["cuisine"], name="restaurant_cuisine_idx"),
            models.Index(fields=["is_open_now"], name="restaurant_open_now_idx"),
            models.Index(fields=["-rating"], name="restaurant_rating_desc_idx"),
            models.Index(fields=["average_cost_for_two"], name="restaurant_budget_idx"),
        ]

    def __str__(self):
        return self.name


class SearchHistory(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="search_history",
        null=True,
        blank=True,
    )
    raw_query = models.CharField(max_length=255)
    interpreted_filters = models.JSONField(default=dict, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    session_key = models.CharField(max_length=64, blank=True, default="")
    searched_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-searched_at"]

    def __str__(self):
        return f"{self.raw_query} ({self.searched_at:%Y-%m-%d %H:%M})"


class FavoriteRestaurant(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="favorite_restaurants",
        null=True,
        blank=True,
    )
    restaurant = models.ForeignKey(
        Restaurant, on_delete=models.CASCADE, related_name="favorited_by"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    session_key = models.CharField(max_length=64, blank=True, default="")
    note = models.TextField(blank=True, default="")
    tags = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=24, default="want_to_try")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["session_key", "-created_at"],
                name="fav_local_session_created_idx",
            ),
            models.Index(fields=["user", "-created_at"], name="fav_local_user_created_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "restaurant"], name="unique_favorite_per_user"
            ),
            models.UniqueConstraint(
                fields=["session_key", "restaurant"],
                name="unique_favorite_per_session",
                condition=~models.Q(session_key=""),
            ),
        ]

    def __str__(self):
        return f"{self.user_id}:{self.restaurant.name}"


class FavoriteExternalPlace(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="favorite_external_places",
        null=True,
        blank=True,
    )
    session_key = models.CharField(max_length=64, blank=True, default="")
    place_id = models.CharField(max_length=128)
    name = models.CharField(max_length=255)
    cuisine = models.CharField(max_length=120, blank=True)
    address = models.CharField(max_length=255, blank=True)
    detail_url = models.CharField(max_length=255, blank=True)
    rating = models.DecimalField(max_digits=2, decimal_places=1, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    note = models.TextField(blank=True, default="")
    tags = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=24, default="want_to_try")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["session_key", "-created_at"],
                name="fav_ext_session_created_idx",
            ),
            models.Index(fields=["user", "-created_at"], name="fav_ext_user_created_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "place_id"], name="unique_external_favorite_per_user"
            ),
            models.UniqueConstraint(
                fields=["session_key", "place_id"],
                name="unique_external_favorite_per_session",
                condition=~models.Q(session_key=""),
            ),
        ]

    def __str__(self):
        return f"{self.user_id}:{self.place_id}"


class UserPreference(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="preference_profile",
        null=True,
        blank=True,
    )
    preferred_cuisines = models.JSONField(default=list, blank=True)
    max_budget = models.PositiveIntegerField(default=1200)
    vibe = models.CharField(max_length=120, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Preference<{self.user_id}>"
