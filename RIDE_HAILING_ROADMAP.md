# Roadmap: from carpooling to on-demand ride-hailing (Uber / Careem / InDrive / Yango class)

Status: **planning document**. Phase 1 work has started; later phases are not started.

## 1. What is actually being asked

The current product is a **scheduled carpooling** marketplace. Careem, Uber, InDrive and
Yango are **on-demand ride-hailing** platforms. They are *not* the same product with more
features bolted on; the core loop is different.

| Dimension | Current app (carpool) | Ride-hailing (Uber/Careem/InDrive/Yango) |
|---|---|---|
| Booking | Driver publishes a dated trip in advance; rider searches it | Rider requests now; system matches a nearby driver in seconds |
| Supply | Driver's saved commute, one trip per date | Continuous: a driver is online/offline, position known |
| Matching | Text area match + optional distance radius | Real-time geospatial nearest-driver dispatch |
| Meeting point | Approximate area, precise detail shared after accept | Map pin, exact GPS |
| Price | Display-only "cost sharing" note, **no money moves** | Metered fare, upfront quote, in-app payment, driver payout |
| Trust | Display name, block/report | Ratings, phone, vehicle plate + model, ID/vehicle documents |
| Live state | No tracking | Live driver location on a map, ETA, trip states (en route / arrived / in trip) |
| Accountability | Mutual completion confirmation, dispute review | Auto-complete, receipt, cancellation fees, reliability score |

`plan.md` line 37 and `MVP_SPEC.md` line 42 currently **explicitly defer** the features that
define that second column: *payments, location tracking, route optimization, ratings,
identity-document uploads, native apps*. This roadmap proposes superseding those deferrals
in phases. That is a scope reversal, and it is recorded as such in `DECISIONS.md`.

## 2. Honest gap analysis

### What already carries over (reusable, not wasted)
- **Identity and mode switching** — one account, rider/driver modes, server-side authorization.
- **Blocking + trip-linked safety reports + append-only reviewer history** — an accountability
  layer more mature than most seed-stage ride-hailing apps have.
- **Notifications inbox** with dedupe keys, read state, retention.
- **Concurrency discipline**: single lock order (advisory → rows), guarded capacity writes,
  idempotency on every mutation, a deadlock already found and fixed.
- **Area aliases + coordinate distance matching** — a foundation the geospatial phase builds on.
- **Meeting details** bounded by an accepted seat — becomes the "driver contact" surface.
- **Retention, health-check, verification harness** — operational spine.

### What is genuinely missing (and why it is hard)
1. **No money at all.** No fare model, no payment provider, no ledger, no payouts. This is the
   single largest piece and it is *not* primarily a coding problem in Pakistan: it needs a PSP
   (JazzCash / Easypaisa / card), merchant onboarding, a settlement account, tax handling, and
   a refunds/chargebacks policy.
2. **No live location.** Nothing stores or streams a moving position. Needs a write path for
   driver pings, a read path on a map, and a decision about how long positions are retained
   (privacy: tracking history is sensitive).
3. **No real-time transport.** The inbox is *polled every 30s*. Hailing needs sub-second
   updates (a driver must see a request before it expires). This requires WebSockets/SSE and a
   different deployment shape than Vercel-style serverless request/response.
4. **No geospatial index.** Coordinates exist as plain lat/long with a bounding box. Nearest-
   driver search at scale wants PostGIS/`earthdistance` with a GiST index.
5. **No ratings, no vehicle profile, no phone.** A rider cannot identify their driver.
6. **No on-demand trip model.** `trip_occurrences` is keyed to a `commute_template` and a
   `trip_date`. A hail is "a trip now from A to B", with no template.
7. **No ETA/routing.** Straight-line distance only; no road network, no travel time.
8. **No mobile app.** A hailing product is used on a phone with GPS. The web dashboard is the
   operator/driver console, not the consumer surface. This is the biggest *product* gap.

### The uncomfortable conclusions
- **Phase 5 (mobile + real-time + maps) is where the product actually becomes Careem-like.**
  Phases 1–4 make the existing web app far more trustworthy and complete; they do not make it
  a hailing app.
- **Money is a business project, not a sprint.** I can build the ledger and the state machine;
  I cannot open a merchant account or decide your fee.
- **Regulation.** In Pakistan, commercial passenger transport is regulated provincially
  (Punjab, Sindh, etc.) and ride-hailing operators have historically required licensing. This
  is flagged, not solved — it is a legal question, not a code one.

## 3. Phased plan

Each phase is independently shippable and leaves the app working. Phases are ordered so that
nothing depends on a later phase's decisions.

### Phase 1 — Trust & profile (started; no external dependencies)
Makes a stranger identifiable enough to get into a car with. All in the existing stack.
1a. **Profile**: phone number (verified later), photo, and for drivers a **vehicle** (make,
   model, colour, plate). Shown to the counterpart only once a seat is accepted —
   same privacy rule as the meeting detail already uses.
1b. **Ratings**: after a completed trip both sides rate 1–5 plus an optional tag. Aggregate
   shown as an average + count, never a single number without volume. Ratings are
   *read-only after submission* and immutable; a low rating is not an automatic penalty.
1c. **Reliability surface**: cancellations already exist; expose each participant's completed
   vs cancelled counts so a pattern is visible. **No automatic suspension** — that is a
   policy decision (see §4).
**Exit criteria:** a rider can see, for an accepted trip, the driver's name, photo, phone,
plate and rating; and after the trip, rate them.

### Phase 2 — On-demand trips (schema, no real-time yet)
Introduce a second trip kind: `ON_DEMAND` alongside `SCHEDULED`, so a rider can request "now".
Adds `trip_requests` with a short acceptance window and an expiry, reusing the existing
capacity/locking/idempotency discipline. Still request/accept, no map.
**Depends on:** nothing external. **Exit criteria:** a rider requests now; a driver accepts or
it expires; the whole existing completion/dispute flow applies unchanged.

### Phase 3 — Geospatial dispatch
`earthdistance`/PostGIS, GiST index, driver **availability** state (online/offline) and last
known position, nearest-driver ranking with a search radius that widens on failure.
**Depends on:** a decision on position retention.
**Exit criteria:** a request matches the nearest available driver within N km.

### Phase 4 — Real-time transport + map
SSE (simplest thing that works) for request/accept/position updates; a map view for the driver
and rider. Replaces 30s polling on the hailing path.
**Depends on:** deployment that permits long-lived connections.
**Exit criteria:** a driver sees a new request in under a second; a rider sees the driver move.

### Phase 5 — Money
Fare model (base + distance + time, or upfront quote), a double-entry **ledger**, payment
provider integration, driver payouts, receipts, refunds, cancellation fees.
**Depends on:** provider choice, fee policy, tax — all business decisions.
**Exit criteria:** a completed trip moves money correctly and a refund reverses it exactly.

### Phase 6 — Mobile apps + routing
Native/React-Native client with GPS, background location, push, and a routing provider for ETA
and turn-by-turn. This is where the product becomes recognisably Careem-class.
**Depends on:** everything above.

## 4. Decisions only the owner can make (blocking specific phases)

I have started Phase 1 because it needs **none** of these. I will not guess the rest.

1. **Position retention (Phase 3, blocking).** How long is a driver's location history kept?
   Live-only (never stored) is the most private; storing it enables dispute reconstruction and
   ETA history. Pick a window or say "live only".
2. **Payment provider and fee (Phase 5, blocking).** Which PSP, what commission, who bears the
   fee, how are refunds handled? Also: does the driver get paid out, or does the platform?
3. **Cancellation/discipline policy (Phase 1c is visibility only).** At what point does a
   pattern of cancellations or low ratings suspend an account? Does anyone ever get suspended
   automatically, or only by a human reviewer? The app currently has **no automatic penalty**
   by design; I recommend keeping it that way until you decide.
4. **Phone verification (Phase 1a).** SMS OTP needs a provider and a per-message cost. I can
   store an unverified number now and wire verification when you choose a provider.
5. **Real-time deployment (Phase 4, blocking).** SSE/WebSockets need a host that allows
   long-lived connections (not plain serverless). Where will this run?
6. **Legal/regulatory (blocks real passengers).** Provincial transport licensing, insurance,
   and any applicable law. Nothing in this repo addresses it, and it should gate real rides.
7. **Keep carpooling or replace it?** I am **adding** on-demand alongside scheduled trips, not
   removing the commute flow. If you want carpooling gone, say so — that changes the data model.

## 5. Immediate next steps (this session onward)

1. Record the scope reversal in `DECISIONS.md`; point `plan.md` and `MVP_SPEC.md` at this file.
2. Phase 1a: migration + service + settings UI for phone/photo/vehicle, exposed to the
   counterpart only on an accepted seat.
3. Phase 1b: ratings schema + service, surfaced on the dashboards.
4. Phase 1c: reliability counts on the counterpart view.
5. Re-run the full check suite and browser-verify each addition, as with previous work.

## 6. What I will not do without you
- Move money or model fares with a guessed fee.
- Add automatic suspension or any automatic penalty based on ratings/cancellations.
- Store location history without a chosen retention window.
- Register for or integrate a payment/SMS/licensing provider.
- Delete the carpooling flow (it is the current product; I will add alongside it).
