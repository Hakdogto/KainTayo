# Rubric-Ready Session Discovery Design

## Goal

Make Kain Tayo a stronger no-login, no-admin restaurant discovery system that clearly satisfies the project criteria for web functionality, voice control, emerging technology integration, and PostgreSQL data management. The app will avoid unreliable menu-price claims because Google Places does not provide dependable menu pricing.

## Scope

The app remains public and session-based. Users do not need accounts. CRUD is provided through user-facing saved places, not admin-only restaurant management.

## Functional Changes

### Saved Places CRUD

Saved Places becomes the main user-owned data surface. Users can:

- Save a local restaurant or Google Place.
- View all saved places.
- Edit personal notes, simple tags, and status.
- Delete saved places.

Supported statuses:

- Want to Try
- Tried
- Favorite

Supported tags focus on reliable intent signals:

- date
- family
- study
- barkada
- quick bite
- nearby
- craving

No custom budget or menu-price fields will be added. If the user says "cheap" or "mura", the app may treat it as a soft intent for casual or budget-friendly vibes, but it must not claim actual menu prices unless the data exists.

### Voice Control

Voice control should support both search input and app commands. Target commands include:

- "Search ramen near me"
- "Show nearby"
- "Open saved places"
- "Go to AI chat"
- "Clear search"
- "Save this place"
- "Show open now"
- "Hanap samgyup malapit"
- "Bukas ngayon"
- "Punta sa saved places"

Voice should keep the current browser compatibility fallback. Unsupported browsers should show a clear message and keep normal manual controls available.

### AI Smart Chat

AI chat should become more demonstrable and useful by returning:

- Intent summary: what the app understood from the user.
- Result reasons: why each place matches.
- Refinement chips: closer, open now, more local, good for groups, date place, cafe, try another area.
- Source labels: local database, Google Places, AI grounded, fallback.
- Follow-up refinement: "make it closer", "show cafes instead", "more casual", "good for family".

When Gemini is unavailable or returns weak data, the app should gracefully fall back to Google Places and show that fallback without crashing.

### UI Direction

The UI should feel like a complete discovery tool rather than a demo shell. Recommended updates:

- Result cards show name, cuisine/type, distance, rating, open status, source, saved state, and a short reason.
- Saved Places has segmented controls for Want to Try, Tried, and Favorite.
- Filter and refinement actions use chips instead of price inputs.
- Empty, loading, and error states are consistent across Search, Nearby, AI Chat, and Saved Places.
- The AI chat uses compact assistant responses with actionable refinement chips.

## Data Model

Extend saved external places and saved local restaurants with session-owned metadata. The simplest implementation can add nullable fields to both saved models:

- note
- tags
- status

An alternative is a new normalized SavedPlace model that handles local and external places together. That is cleaner long term, but it requires a migration path from existing FavoriteRestaurant and FavoriteExternalPlace data. For this project, extending the existing models is lower risk and aligns with current code.

## Database And Indexes

PostgreSQL remains configured through DATABASE_URL. pgvector remains the emerging technology database feature for semantic ranking.

Recommended indexes:

- SearchHistory session_key and searched_at for recent searches.
- FavoriteRestaurant session_key and created_at for saved local places.
- FavoriteExternalPlace session_key and created_at for saved external places.
- Optional PostgreSQL vector index for Restaurant.embedding if production data volume grows.

## Error Handling

The app should handle:

- Missing location permission.
- Invalid query or coordinates.
- Empty result sets.
- Google Places failure.
- Gemini failure or malformed AI response.
- AI quota exceeded.
- Voice unsupported or permission denied.
- Duplicate save attempts.

Errors should appear as helpful UI states, not browser crashes or raw stack traces.

## Testing

Add focused tests for:

- Saved Places create/read/update/delete for local and external places.
- Duplicate save behavior.
- Invalid update payloads.
- AI chat payload shape for intent summaries and result reasons.
- Existing search, nearby, and page routes continuing to work.

Frontend JavaScript should continue passing syntax checks for changed files.

## Success Criteria

The project can confidently answer "yes" to the rubric when:

- A user can complete a restaurant discovery flow from search or AI chat to saved-place management.
- Saved Places demonstrates full session-based CRUD without login.
- Voice commands perform search and navigation actions.
- AI/pgvector features visibly improve recommendations and explain results.
- PostgreSQL schema, relationships, indexes, and pgvector support are documented and migrated.
- Automated tests pass and major UI states handle failures gracefully.
