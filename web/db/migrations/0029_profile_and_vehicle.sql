-- Profile and vehicle identity, the first step toward a hailing-class product.
--
-- A carpool between neighbours can work on a display name alone. A ride-hailing
-- product cannot: someone is about to get into a stranger's car, so they need to
-- know who is coming and which car to look for. `RIDE_HAILING_ROADMAP.md` Phase 1.
--
-- This adds the identity fields a rider needs *at the moment it matters* —
-- `phone` and, for drivers, `vehicle` — while keeping them private until a seat
-- is actually accepted. The rule is the one already used for meeting details and
-- enforced the same way: the read path exposes them only on an ACCEPTED request,
-- not on a pending one, so a driver's number and plate are not exposed to every
-- rider who searches.
--
-- Deliberately NOT added here:
--   * photo/avatar upload — that needs object storage and a moderation path, and
--     a half-built upload with no review is worse than none. Deferred within
--     Phase 1, decided separately (see roadmap §4).
--   * phone *verification* — needs an SMS provider and a budget. The column
--     records the number and whether it is verified; verification is wired when
--     a provider is chosen.
--   * identity documents — a legal/compliance decision, not a schema one.

-- Contact number. E.164-ish free text rather than a strict format, because the
-- app cannot know every country code a driver might use and a rejected valid
-- number is a support ticket. Bounded length only.
ALTER TABLE users
  ADD COLUMN phone text,
  ADD COLUMN phone_verified_at timestamptz;

ALTER TABLE users
  ADD CONSTRAINT users_phone_length
    CHECK (phone IS NULL OR (length(btrim(phone)) BETWEEN 7 AND 20));

-- One row per driver, not columns on `users`, so the vehicle is a thing with its
-- own lifecycle and can later grow (multiple vehicles, documents, inspection).
-- A `users` row is created on first sign-in for both riders and drivers; a
-- vehicle only makes sense for a driver and should be absent, not empty, until
-- one is provided.
CREATE TABLE driver_vehicles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  make text NOT NULL,
  model text NOT NULL,
  colour text NOT NULL,
  plate text NOT NULL,
  seat_capacity integer NOT NULL DEFAULT 4,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT driver_vehicles_make_length CHECK (length(btrim(make)) BETWEEN 1 AND 60),
  CONSTRAINT driver_vehicles_model_length CHECK (length(btrim(model)) BETWEEN 1 AND 60),
  CONSTRAINT driver_vehicles_colour_length CHECK (length(btrim(colour)) BETWEEN 1 AND 30),
  CONSTRAINT driver_vehicles_plate_length CHECK (length(btrim(plate)) BETWEEN 2 AND 20),
  -- A private car carries at most a few passengers; a larger "capacity" here
  -- would be a data-entry error or an attempt to look like a bus service.
  CONSTRAINT driver_vehicles_seat_capacity CHECK (seat_capacity BETWEEN 1 AND 8)
);

-- One vehicle per driver for now. A uniqueness constraint rather than application
-- logic so a race cannot create two, and so "which car is coming" always has one
-- answer while the product cannot yet ask the user to pick.
CREATE UNIQUE INDEX driver_vehicles_one_per_driver ON driver_vehicles (user_id);
