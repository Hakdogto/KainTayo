# System Overview

## System Identity

- **Name:** Kain Tayo
- **Type:** AI-assisted restaurant discovery web application
- **Primary goal:** Help users quickly find food places by query, location, budget, cuisine, mood, and practical visit details.
- **Main experiences:** Home discovery, Smart Search, Nearby browsing, AI Food Chat, Favorites, Recent Searches, and detail pages.

## High-Level Architecture

Kain Tayo is a Django application with a server-rendered page layer and REST-style JSON endpoints used by page-specific JavaScript.

At a high level:

1. Django templates render the first page shell.
2. JavaScript handles browser location, forms, voice input, layout toggles, maps, and API calls.
3. Django REST endpoints process search, nearby, favorites, history, AI search, and location resolution.
4. Local restaurant data comes from the database.
5. External live restaurant data comes from Google Places.
6. AI interpretation and AI Food Chat use Gemini.
7. Optional semantic ranking uses Gemini embeddings stored through `pgvector`.

## Main Subsystems

### Django Project

- Root project: `ai_restaurant_finder`
- Main app: `restaurants`
- Root routes include all app routes from `restaurants.urls`.
- Settings configure Django REST Framework throttling, database, static files, security headers, Google/Gemini keys, and vector search flags.

### Database

The system stores:

- `Restaurant`
  - Local restaurant inventory with cuisine, mood tags, cost, rating, coordinates, address, and optional embedding.
- `SearchHistory`
  - Recent searches for logged-in users or anonymous sessions.
- `FavoriteRestaurant`
  - Favorites for local database restaurants.
- `FavoriteExternalPlace`
  - Favorites for Google Places results.
- `UserPreference`
  - Future preference profile support.

### External Integrations

- **Google Places**
  - Text search for external restaurants.
  - Place detail lookup.
  - Photo proxy.
  - Manual location resolution.
  - AI fallback when Gemini cannot produce usable cards.

- **Gemini**
  - AI intent parsing fallback.
  - Text embeddings for semantic search.
  - Grounded AI Food Chat.

- **Map UI**
  - Leaflet-based frontend map.
  - Mapbox token support when configured.
  - OpenStreetMap fallback.

## Page Flow Summary

### Home

The Home page automatically requests browser location on load. If allowed, it loads nearby restaurant data. If denied or unavailable, it falls back to Metro Manila/default recommendations. Manual location remains available and, when used, is saved into session storage so Smart Search can inherit it.

### Smart Search

Smart Search accepts a text query, location, voice input, chips, and manual location override. It sends the query to `/api/search/`, where the backend parses intent, filters local restaurants, fetches Google Places results, ranks everything, stores history, and returns results. The frontend supports map markers, favorites, vertical layout, and horizontal swipe layout.

### Nearby

Nearby automatically detects location on page load, fetches `/api/nearby/`, and shows paginated nearby results. Users can switch between vertical and swipe layout. Manual location can override the detected location.

### AI Food Chat

AI Food Chat is separate from Smart Search. It sends each user message to `/api/ai-search/`. The backend attempts Gemini grounded search, validates and repairs malformed model output, rejects fake summary cards, and falls back to Google Places if needed. The frontend renders a chat transcript with compact grouped recommendation cards.

### Favorites

Favorites are session-aware and support both local restaurants and external Google Places. Anonymous users are tracked through a Django session key. Adding the same item is idempotent.

### Recent Searches

Recent Searches come from `SearchHistory`. They store raw query, interpreted filters, coordinates, and timestamp. Users can delete entries.

### Detail Pages

Local restaurants and Google Places share the same detail template. A detail helper builds a facts-first payload with overview, rating, price, open status, address, contact, website, maps, and action links.

## Smart Search Technical Flow

1. Frontend submits query and coordinates.
2. Backend validates query length and coordinate bounds.
3. `parse_query()` extracts intent.
4. Local restaurants are filtered by cuisine, budget, mood, open-now, and rating.
5. If enabled, semantic scores are calculated with stored embeddings.
6. Google Places text search returns external candidates.
7. Distances are calculated with Haversine.
8. Results are deduplicated by name and coordinates.
9. `_search_relevance_score()` ranks results.
10. Search history is saved.
11. JSON response returns filters, assistant chips, and results.

## AI Food Chat Technical Flow

1. User sends message from `/ai-search/`.
2. `/api/ai-search/` validates the query.
3. Daily AI quota and DRF throttle are checked.
4. Gemini is called with strict JSON and grounded search instructions.
5. The parser tries strict JSON, JSON-like extraction, and plaintext extraction.
6. Rows are normalized and validated.
7. If rows are invalid, a repair prompt retries Gemini once.
8. If Gemini still fails, Google Places fallback searches using parsed query and resolved location.
9. Final rows are cached and returned.
10. The frontend renders a summary and grouped cards.

## Browser State and Storage

The frontend uses browser storage for UX continuity:

- `localStorage.kainTayoTipsDismissedV1`
  - Shared tips dismissal across Home, Smart Search, and AI Search.
- `sessionStorage.homeManualLocationForSearchV1`
  - Home-to-Smart-Search manual location handoff.
- `sessionStorage.smartSearchStateV1`
  - Smart Search query, location, results, and filters.
- `localStorage.smartSearchResultsLayoutV1`
  - Smart Search vertical/swipe layout.
- `localStorage.nearbyResultsLayoutV1`
  - Nearby vertical/swipe layout.
- `localStorage.kainTayoPwaInstallDismissedV1`
  - PWA install bar dismissal.

## PWA and Cache Freshness

The service worker is served by Django at `/service-worker.js`.

Current strategy:

- Network-first for HTML pages.
- Cache-first fallback for cacheable same-origin static/runtime assets.
- Ignore non-HTTP schemes, cross-origin requests, API routes, and the service worker script.
- Serve service worker with no-cache headers.
- Bump cache names when cache behavior changes.

This prevents stale deployed templates from requiring Ctrl+F5 in normal use.

## Deployment

Render deployment is configured through:

- `render.yaml`
- `build.sh`

Build installs dependencies and collects static files. Start command runs migrations and Gunicorn.

Production configuration uses:

- `DEBUG=False`
- secure cookies
- HSTS when not in debug mode
- WhiteNoise compressed manifest static storage
- PostgreSQL through `DATABASE_URL`

## Reliability and Guardrails

- Query length validation.
- Coordinate bounds validation.
- DRF throttling for general API usage.
- Scoped AI Search throttle.
- Daily AI search quota per user/session.
- AI fake-card validation.
- Google Places fallback for AI failures.
- Idempotent favorite creation.
- API routes excluded from service worker cache.

## Detailed Reference

For full system logic, file-by-file behavior, presentation notes, and technical details, use `SystemInfo.md`.
