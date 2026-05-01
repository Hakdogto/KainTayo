from django.contrib import admin

from .models import FavoriteRestaurant, Restaurant, SearchHistory, UserPreference


@admin.register(Restaurant)
class RestaurantAdmin(admin.ModelAdmin):
    list_display = ("name", "cuisine", "average_cost_for_two", "rating", "is_open_now")
    list_filter = ("cuisine", "price_level", "is_open_now")
    search_fields = ("name", "cuisine", "address")


@admin.register(SearchHistory)
class SearchHistoryAdmin(admin.ModelAdmin):
    list_display = ("raw_query", "user", "searched_at")
    search_fields = ("raw_query",)
    readonly_fields = ("searched_at",)


@admin.register(FavoriteRestaurant)
class FavoriteRestaurantAdmin(admin.ModelAdmin):
    list_display = ("user", "restaurant", "created_at")
    search_fields = ("restaurant__name",)


@admin.register(UserPreference)
class UserPreferenceAdmin(admin.ModelAdmin):
    list_display = ("user", "max_budget", "vibe", "updated_at")
