from rest_framework import serializers

from .models import FavoriteExternalPlace, FavoriteRestaurant, Restaurant, SearchHistory


class RestaurantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Restaurant
        fields = [
            "id",
            "name",
            "cuisine",
            "mood_tags",
            "description",
            "price_level",
            "average_cost_for_two",
            "rating",
            "is_open_now",
            "latitude",
            "longitude",
            "address",
        ]


class SearchHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = SearchHistory
        fields = [
            "id",
            "raw_query",
            "interpreted_filters",
            "latitude",
            "longitude",
            "searched_at",
        ]


class FavoriteRestaurantSerializer(serializers.ModelSerializer):
    restaurant = RestaurantSerializer(read_only=True)

    class Meta:
        model = FavoriteRestaurant
        fields = ["id", "restaurant", "created_at"]


class FavoriteExternalPlaceSerializer(serializers.ModelSerializer):
    class Meta:
        model = FavoriteExternalPlace
        fields = [
            "id",
            "place_id",
            "name",
            "cuisine",
            "address",
            "detail_url",
            "rating",
            "created_at",
        ]
