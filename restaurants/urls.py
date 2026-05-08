from django.urls import path

from . import views

urlpatterns = [
    path("", views.home_page, name="home"),
    path("search/", views.search_page, name="search"),
    path("ai-search/", views.ai_search_page, name="ai_search_page"),
    path("favorites/", views.favorites_page, name="favorites_page"),
    path("recent/", views.recent_page, name="recent_page"),
    path("nearby/", views.nearby_page, name="nearby_page"),
    path("restaurant/<int:restaurant_id>/", views.restaurant_detail_page, name="restaurant_detail"),
    path("place/<str:place_id>/", views.place_detail_page, name="place_detail"),
    path("api/search/", views.smart_search_api, name="api_search"),
    path("api/resolve-location/", views.resolve_location_api, name="api_resolve_location"),
    path("api/nearby/", views.nearby_restaurants_api, name="api_nearby"),
    path("api/recommendations/", views.recommendation_api, name="api_recommendations"),
    path("api/history/", views.history_api, name="api_history"),
    path("api/history/<int:history_id>/", views.delete_history_item_api, name="api_delete_history"),
    path("api/favorites/", views.favorites_api, name="api_favorites"),
    path("api/favorites/add/", views.add_favorite_api, name="api_add_favorite"),
    path("api/favorites/<str:favorite_type>/<int:favorite_id>/", views.delete_favorite_api, name="api_delete_favorite"),
    path("api/place-photo/", views.place_photo_api, name="api_place_photo"),
    path("api/chat-assistant/", views.chat_assistant_api, name="api_chat_assistant"),
    path("api/ai-search/", views.ai_grounded_search_api, name="api_ai_search"),
    path("api/seed/", views.seed_demo_data_api, name="api_seed"),
    path("favicon.ico", views.favicon_ico, name="favicon_ico"),
    path("manifest.webmanifest", views.manifest_json, name="manifest_json"),
    path("service-worker.js", views.service_worker_js, name="service_worker_js"),
]
