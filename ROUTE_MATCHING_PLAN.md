# Route-based matching: map, pins, and "the rider's leg is on the driver's route"

Status: **planning**. Phase A (route geometry) started; later phases gated on the decisions in §6.

This supersedes the *area-name* matching model. Read alongside `RIDE_HAILING_ROADMAP.md`:
that file covers the hailing phases generally; this file is the concrete design for the
matching problem you described, which is the part that makes the app actually work for
intercity commute sharing.

## 1. The product as described

> Driver sets source and destination (Muridke → Model Town Lahore) and this is their commute.
> Rider sets source and destination (Rana Town → MAO College). Both are on the same road, so
> the rider sees that driver in a list and can select them. Same map + pin selection for both
> roles. Paths follow real navigation, not a straight line. Live tracking is on the map too.

That is a **route-corridor / along-route** matching problem, not a proximity one. It is
strictly better than what exists: the current 2 km radius would match a driver 1.5 km away
going the *opposite* way, and would miss a driver 30 km away who is on the rider's exact road.

## 2. Why the current model cannot express this

| Today | Needed |
|---|---|
| `commute_templates.origin_area`, `destination_area` — free text | A point (lat/lng), or a place id, for each end |
| `area_coordinates` — one point per area name | The **full route polyline** from a navigation provider |
| `area_within_radius()` — haversine, one point vs one point | "Is the rider's A→B contained in the driver's P→Q, within a lateral tolerance?" |
| `searchRideCandidates` compares two text areas | Compares geometry along a path |
| No ETA, no distance | Distance along the route, and an ETA for the rider's leg |

Nothing here is throwaway — the existing `trip_occurrences`/`ride_requests`/capacity/locking/
idempotency machinery is all still correct and is reused. What changes is *how a match is
decided*, plus what a commute stores.

## 3. The matching rule, stated precisely

Given driver route **P→Q** and rider leg **A→B**, the rider matches when all of these hold:

1. **Both endpoints lie close to the driver's route.** The perpendicular distance from A (and
   from B) to the polyline P→Q is ≤ `lateral_tolerance` (a real-world width — see §6.1).
2. **The rider boards before they alight.** `position(A) < position(B)` measured *along* the
   driver's path. Without this, a rider going *against* the driver gets matched: someone
   travelling Rana Town → Muridke would otherwise appear "on the route" and be dropped at the
   wrong end.
3. **The direction agrees.** The rider's own A→B heading matches the driver's P→Q heading
   (the same check, expressed as: A projects to a smaller along-distance than B).
4. **The driver's route actually covers the leg.** `position(A)` and `position(B)` both fall
   between the start and end of P→Q — not merely near an extension of it.

Rule 2+4 together are what distinguishes this from proximity: they are why Muridke → Model Town
matches Rana Town → MAO College (both mid-route, in order), and rejects Rana Town → Muridke.

**Implementation:** each endpoint is snapped to the nearest vertex of the route polyline, giving
an *along-distance* (cumulative metres from the start). A match requires lateral distance ≤
tolerance **and** `along(A) < along(B)`. This is the standard "project onto a linestring"
operation; see §5 for how to do it without PostGIS.

## 4. Data model

```
place / point:  { lat double precision, lng double precision, label text }
```

- `commute_templates`: add `origin_lat`, `origin_lng`, `destination_lat`, `destination_lng`
  (nullable, so existing rows survive), and keep `origin_area`/`destination_area` as the
  human-readable **label** shown in lists — the map gives the point, the label gives the words.
- New `commute_routes` (or a `route_geometry` column): the decoded polyline as an ordered array
  of points, plus `provider`, `distance_meters`, `duration_seconds`, `computed_at`.
  One row per commute, refreshed when the endpoints change.
- `trip_occurrences`: snapshot the same geometry at publish time, because a commute can be
  edited later and an already-published trip must not silently change its route (the existing
  code already applies this copy-on-publish principle to `contribution_note`).
- `ride_requests`: store the rider's requested `origin_lat/lng` and `destination_lat/lng`, so the
  request records the leg that was actually matched, not just the driver's corridor.

Storing the polyline as `double precision[][]` or a `jsonb` array is sufficient and avoids a
PostGIS dependency. A GiST index and `earthdistance` remain useful later for "which drivers are
near this start point" pre-filtering at scale (Phase 3 of the other roadmap).

## 5. Algorithms, in order of dependency

1. **Point → polyline projection.** For each segment, project the point onto it; keep the
   closest. Returns lateral distance and along-distance. Pure SQL is painful; a small
   TypeScript module with a well-tested function is clearer and testable, and the candidate set
   is bounded (a rider searches a date and a corridor, not the world).
2. **Corridor match.** Snap A and B; apply the four rules in §3.
3. **Route geometry fetch.** Call the navigation provider once per commute publish (cacheable,
   not per search) and store it.
4. **Ranking.** Order matches by the rider's ride distance / detour the driver incurs, not by
   text similarity. A driver whose route barely detours for the rider should rank first.

## 6. Decisions I need from you before certain phases

### 6.1 Lateral tolerance — how far off the route counts as "on the route"? (blocks Phase B)
This is the single most important number in the product. On a motorway corridor, 300–500 m
catches a rider at a service area; a neighbourhood pickup needs more like 1–2 km; and if the
driver is willing to detour, the tolerance is really "how much detour will you accept" (measured
in *minutes*, not metres). **My recommendation:** express it as a driver-set maximum detour in
minutes (e.g. 10), defaulting to a fixed distance, and let the driver tune it. Tell me which you
want and I'll implement that.

### 6.2 Navigation provider (blocks Phase A/C/D) — real costs involved
"Paths based on navigation" needs a routing API. Options, with their honest trade-offs:
- **Google Maps** (Directions API + JS SDK + Places + Geocoding): best data in Pakistan,
  bills per request, requires an API key and a billing account, and has strict terms about
  storing/caching geometry (worth checking before we persist polylines).
- **Mapbox**: similar capability, slightly different pricing, generous free tier.
- **OpenRouteService / OSRM**: cheaper or self-hostable, weaker traffic data.
- **Leaflet + OSM tiles** for *display* is free; the *routing* still needs one of the above.

**I cannot choose this for you** — it needs an account, a card, and a spend decision. Tell me
which, and I'll build the adapter behind an interface so the choice is swappable. **Until then I
can build and test the entire matching algorithm against fixed geometry, which is genuine
progress and needs no key.**

### 6.3 Live tracking (Phase E, blocks on two things)
- **Real-time transport**: the inbox polls every 30 s; a moving marker needs sub-second updates
  (SSE or WebSockets), which needs a host that permits long-lived connections — not plain
  serverless.
- **Retention**: how long is a driver's location history kept? Live-only is the most private and
  can still show a moving marker; stored history enables dispute reconstruction but is sensitive
  personal data. You must choose.

### 6.4 Does the driver accept detours? (shapes the algorithm)
Three possible products: (a) strict corridor — driver never deviates, rider walks to the route;
(b) bounded detour — driver may leave the route by up to N minutes; (c) full hailing — arbitrary
pickup, which is the Careem model and needs Phase 3–5 of the other roadmap. Your Muridke/MAO
example reads as (a) or (b). Tell me which.

## 7. What I will build now, with no decisions needed

**Phase A — route geometry storage.** Columns for origin/destination coordinates and a
`route_geometry` store with provider/distance/duration metadata, on commutes and snapshot onto
trips. Includes the point-and-polyline types and validation.

**Phase B — the matching algorithm itself, with its own tests.** `projectPointOntoRoute` and
`matchLegOnRoute`, covering the four rules in §3, tested against your real example and against
the failure cases (reverse direction, endpoints off the corridor, rider longer than driver).
This is the heart of the feature and needs no map key, only geometry — I can use a hand-written
polyline approximating the Muridke → Model Town corridor for the tests, then swap in real
provider geometry when you choose one.

Phases C–E wait on §6.

## 8. Honest limits of what I'm building first
- The geometry I test against will be **synthetic** until a provider is chosen — the algorithm
  is real, the test corridor is hand-made. That is a genuine test of the logic, not of real roads.
- The existing area-name matching stays working throughout, so the app does not break mid-migration.
  Area matching becomes a fallback for commutes with no geometry.
- A straight-line corridor is *already* a big improvement on a 2 km circle, but "follows real
  navigation" is only true once a routing provider is wired in.
