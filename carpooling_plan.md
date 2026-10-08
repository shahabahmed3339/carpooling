Absolutely. Below is the **full source-of-truth specification** you can paste directly into an AI coding agent. I’ve structured it so the agent can use it as a product + architecture + development + testing + deployment specification.

# Carpool Pakistan — Complete AI-Agent Build Specification

## 0. Purpose

Build a production-minded, low-budget recurring carpooling platform for Pakistan.

The platform should **not** initially be an Uber/Careem clone.

The initial product is:

> **A verified recurring-commute platform that connects people from the same organization or community who travel similar routes at similar times.**

Start in **Lahore**.

The first target is not millions of users. The first target is:

- 50–100 real users
- 15–20 active drivers
- 20+ recurring matches
- 100+ completed shared trips
- repeat usage
- at least one organization/community willing to pay

The architecture must allow future expansion into:

- corporate mobility
- parking optimization
- company transport
- shuttle management
- multi-city mobility

---

# 1. Product Strategy

## 1.1 Start Narrow

Initial target users:

1. Corporate employees
2. University students/staff
3. Housing-society residents commuting to business districts
4. Organizations with parking or employee transportation problems

Recommended first experiment:

> One organization/community + recurring weekday commute corridors.

Example:

```text
DHA/Bahria/Gulberg
        ↓
Gulberg/PECHS/business districts

Monday–Friday
Morning + evening
Recurring rides
```

Do not attempt to create a Lahore-wide marketplace immediately.

---

# 2. Product Positioning

Initial positioning:

> **Save money on your daily commute with verified people going your way.**

Alternative B2B positioning:

> **Reduce employee commute friction and parking pressure with verified workplace carpooling.**

The consumer product should feel like a trusted commuting network, not a taxi service.

---

# 3. What This Product Is

The product is:

- recurring commute matching
- community-based
- organization-aware
- trust-focused
- mobile-first
- safety-conscious
- location-aware
- eventually corporate/B2B

The product is NOT initially:

- Uber
- Careem
- taxi marketplace
- instant ride-hailing
- delivery platform
- courier platform
- vehicle rental marketplace

---

# 4. Core Product Principles

The AI coding agent must follow these principles throughout development.

## Principle 1 — Trust before features

A mediocre matching algorithm with trusted users is better than an excellent matching algorithm with anonymous users.

## Principle 2 — Recurring before instant

The first product should focus on predictable recurring commuting.

For example:

```text
Monday-Friday
8:00 AM
DHA Phase 5 → Gulberg
```

rather than:

```text
I need a ride right now.
```

## Principle 3 — Closed communities before public marketplace

Users should initially belong to:

- company
- university
- housing society
- verified community

This improves trust and marketplace liquidity.

## Principle 4 — Mobile-first

Users need:

- GPS
- push notifications
- maps
- trip status
- safety features
- potentially background location

Therefore mobile should be React Native/Expo.

## Principle 5 — Web for administration

Admin and organization dashboards should be web applications.

## Principle 6 — Modular monolith

Do not begin with microservices.

Do not begin with:

- Kubernetes
- Kafka
- service mesh
- event sourcing
- distributed systems
- multiple independently deployed backend services

Build a strong modular monolith first.

## Principle 7 — Deterministic matching

Do not use an LLM for geographic matching.

Matching should use:

- PostGIS
- distance
- time
- route compatibility
- availability
- organization
- trust
- reliability

## Principle 8 — Instrument everything

The system must make it easy to answer:

- How many people signed up?
- How many verified?
- How many created commutes?
- How many matches were found?
- How many requests were sent?
- How many accepted?
- How many trips completed?
- How many repeated?
- Which routes have demand?
- Which organizations are active?

---

# 5. User Types

## 5.1 Rider

A person looking for a ride.

Capabilities:

- signup
- verification
- profile
- organization membership
- create commute
- search rides
- request seat
- view booking
- receive notifications
- participate in trip
- rate
- report
- block
- safety tools

---

# 6. Driver

A person offering seats.

Capabilities:

- signup
- verification
- profile
- add vehicle
- create recurring commute
- define available seats
- define contribution
- accept/reject requests
- view passengers
- trip status
- rate
- report
- safety tools

A single user can be:

```text
RIDER
DRIVER
BOTH
```

---

# 7. Organization Admin

For a company/university/community.

Capabilities:

- manage organization
- invite members
- approve members
- configure policies
- view aggregate commute analytics
- manage organization settings
- manage organization reports

Important:

> Organization admins must not automatically have access to individual users' private travel histories.

---

# 8. Platform Admin

Internal platform operator.

Capabilities:

- users
- organizations
- verification
- vehicles
- commutes
- bookings
- trips
- reports
- incidents
- suspicious activity
- analytics
- configuration
- suspension
- support

---

# 9. Support Operator

Limited operational role.

Must have restricted access.

Do not give support users unrestricted access to sensitive information.

---

# 10. MVP

The first production MVP must contain only what is required to create safe recurring matches.

## P0 Features

### Authentication

- phone OTP
- session management
- refresh token
- logout
- logout all devices
- rate limiting

### User profile

- name
- profile photo
- phone
- organization
- home area
- work/study area
- emergency contact
- rider/driver/both
- verification state

### Organization

- create organization
- join organization
- invite link
- invite code
- admin approval
- optional organization email verification

### Verification

Initial levels:

```text
PHONE_VERIFIED
ORGANIZATION_VERIFIED
IDENTITY_VERIFIED
DRIVER_VERIFIED
```

Do not collect sensitive information unless required.

### Vehicle

- vehicle type
- make/model
- color
- protected registration identifier
- number of seats
- verification state

### Recurring commute

- origin
- destination
- pickup radius
- destination radius
- days
- departure time
- return time
- role
- seats
- contribution
- preferences
- active/inactive

### Search

Search by:

- origin
- destination
- date/day
- time

### Matching

Must consider:

- geographic proximity
- time compatibility
- route compatibility
- organization
- available seats
- verification
- preferences
- blocked users
- reliability

### Ride request

Statuses:

```text
PENDING
ACCEPTED
REJECTED
CANCELLED
EXPIRED
```

### Booking

A recurring commute is not the same thing as a specific trip.

Example:

```text
Commute:
Monday-Friday
08:00
DHA → Gulberg
```

Specific occurrence:

```text
Monday
2026-10-12
08:00
```

This distinction must exist in the database.

### Trip

Statuses:

```text
SCHEDULED
READY
STARTED
COMPLETED
CANCELLED
```

### Notifications

Initial:

- push
- in-app
- optional email

Later:

- WhatsApp Business API
- SMS

### Rating

After completed trip:

- 1–5 stars
- optional reason
- report

### Safety

- emergency contact
- trip status/share action
- report
- block
- incident
- support

---

# 11. Explicitly Do NOT Build in MVP

Do not build:

- instant ride hailing
- taxi service
- delivery
- courier
- vehicle rental
- nationwide launch
- multiple cities
- public anonymous marketplace
- complex wallet
- complicated payment settlement
- surge pricing
- public chat
- social feed
- cryptocurrency
- blockchain
- AI driver matching
- AI route planning
- microservices
- Kubernetes
- Kafka
- vector database
- native Android + native iOS separately

---

# 12. Recommended Technology Stack

## Mobile

### React Native + Expo + TypeScript

Reason:

- one codebase
- Android/iOS
- GPS
- push notifications
- maps
- background capabilities
- fast development
- low initial cost

---

# 13. Web

### Next.js + TypeScript

Use for:

- landing page
- admin
- organization dashboard
- internal operations

UI:

```text
Tailwind CSS
shadcn/ui
```

---

# 14. Backend

### NestJS + TypeScript

Architecture:

```text
Controller
   ↓
Application Service
   ↓
Domain Module
   ↓
Repository
   ↓
PostgreSQL
```

Use:

- REST
- OpenAPI
- Swagger
- DTO validation
- structured errors

---

# 15. Database

### PostgreSQL

Extension:

```text
PostGIS
```

ORM:

```text
Prisma
```

Important:

Do not depend entirely on ORM-level validation.

Use database constraints:

- foreign keys
- unique indexes
- normal indexes
- check constraints
- transactions
- spatial indexes

---

# 16. Redis

Use Redis for:

- OTP rate limiting
- temporary cache
- distributed locks when necessary
- job queue infrastructure
- ephemeral state

Do not store primary business records only in Redis.

---

# 17. Background Jobs

Use:

### BullMQ

Jobs:

- OTP cleanup
- notification delivery
- trip generation
- reminders
- verification workflows
- cleanup
- analytics processing

---

# 18. Storage

Use S3-compatible object storage.

Store:

- profile photos
- vehicle documents
- identity documents
- support attachments

Use signed URLs.

Sensitive files should not be publicly accessible.

---

# 19. Monitoring

Use:

- Sentry
- structured application logs
- health checks
- metrics
- alerts

Every production API should have request tracing/correlation IDs.

---

# 20. Repository Structure

Recommended:

```text
carpool/
│
├── apps/
│   ├── api/
│   ├── mobile/
│   ├── web/
│   └── worker/
│
├── packages/
│   ├── config/
│   ├── types/
│   ├── validation/
│   ├── ui/
│   └── eslint-config/
│
├── infrastructure/
│   ├── docker/
│   ├── terraform/
│   └── scripts/
│
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── product/
│   ├── security/
│   └── decisions/
│
├── .github/
│   └── workflows/
│
├── docker-compose.yml
├── pnpm-workspace.yaml
└── README.md
```

A simple pnpm workspace is acceptable. Use Turborepo only if it genuinely helps.

---

# 21. Backend Modules

```text
apps/api/src/
│
├── main.ts
├── app.module.ts
│
├── common/
│   ├── auth/
│   ├── guards/
│   ├── decorators/
│   ├── filters/
│   ├── interceptors/
│   ├── pipes/
│   ├── errors/
│   ├── logging/
│   └── pagination/
│
├── modules/
│   ├── auth/
│   ├── users/
│   ├── organizations/
│   ├── memberships/
│   ├── verification/
│   ├── vehicles/
│   ├── commutes/
│   ├── matching/
│   ├── ride-requests/
│   ├── bookings/
│   ├── trips/
│   ├── ratings/
│   ├── reports/
│   ├── safety/
│   ├── notifications/
│   ├── payments/
│   └── admin/
│
└── infrastructure/
    ├── database/
    ├── redis/
    ├── storage/
    ├── maps/
    ├── notifications/
    └── payments/
```

Business logic must not live inside controllers.

---

# 22. Database Entities

Initial entities:

```text
User
UserSession
Organization
OrganizationMembership
Verification
Vehicle
Commute
CommuteSchedule
RideRequest
Booking
Trip
TripParticipant
Rating
Report
Incident
EmergencyContact
Notification
Device
BlockedUser
AuditLog
Payment
PaymentTransaction
```

Payments may remain disabled until required.

---

# 23. Important Relationships

```text
User
 ├── OrganizationMembership
 ├── Verification
 ├── Vehicle
 ├── Commute
 ├── RideRequest
 ├── Booking
 ├── TripParticipant
 ├── Rating
 ├── Report
 ├── EmergencyContact
 ├── Device
 └── BlockedUser

Organization
 └── OrganizationMembership

Commute
 └── CommuteSchedule

Booking
 └── Trip

Trip
 └── TripParticipant
```

---

# 24. Multi-Tenancy

Organizations are tenants.

Organization-owned records should generally contain:

```text
organization_id
```

Use:

- application authorization
- PostgreSQL RLS where appropriate

Critical security requirement:

> User from Organization A must never be able to access Organization B's private information by changing IDs in API requests.

Write automated tests specifically for this.

---

# 25. Authorization

Roles:

```text
USER
ORGANIZATION_MEMBER
ORGANIZATION_ADMIN
SUPPORT
PLATFORM_ADMIN
SUPER_ADMIN
```

Authorization must happen on the backend.

Frontend hiding is not security.

---

# 26. API Structure

Base:

```text
/api/v1
```

Authentication:

```http
POST /auth/request-otp
POST /auth/verify-otp
POST /auth/refresh
POST /auth/logout
```

User:

```http
GET /users/me
PATCH /users/me
```

Organizations:

```http
POST /organizations
GET /organizations/:id
POST /organizations/:id/join
```

Vehicles:

```http
POST /vehicles
GET /vehicles
PATCH /vehicles/:id
```

Commutes:

```http
POST /commutes
GET /commutes
GET /commutes/:id
PATCH /commutes/:id
DELETE /commutes/:id
```

Matching:

```http
POST /matching/search
```

Ride requests:

```http
POST /ride-requests
GET /ride-requests
POST /ride-requests/:id/accept
POST /ride-requests/:id/reject
POST /ride-requests/:id/cancel
```

Bookings:

```http
GET /bookings
GET /bookings/:id
```

Trips:

```http
POST /trips/:id/start
POST /trips/:id/complete
POST /trips/:id/cancel
```

Safety:

```http
POST /ratings
POST /reports
POST /users/:id/block
```

Notifications:

```http
GET /notifications
POST /notifications/:id/read
```

---

# 27. API Error Format

Use:

```json
{
  "error": {
    "code": "RIDE_REQUEST_NOT_ALLOWED",
    "message": "You cannot request this ride."
  }
}
```

Never return stack traces in production.

Use stable machine-readable error codes.

---

# 28. Time Handling

Store timestamps in UTC.

Display using:

```text
Asia/Karachi
```

Recurring schedules must retain timezone information.

Never rely on server timezone.

Use ISO 8601.

Test:

- UTC conversion
- recurring schedules
- midnight boundaries
- future timezone support

---

# 29. Location Privacy

Never publicly expose exact home coordinates.

Example:

User enters:

```text
DHA Phase 5
```

Store:

```text
approximate coordinates
```

Display:

```text
DHA Phase 5
```

Never display:

```text
House 123, Street 45
```

Use pickup and destination radii.

---

# 30. Matching Engine

The matching engine is one of the most important modules.

It must NOT use an LLM.

## Input

Rider:

```text
origin
destination
day
departure_time
arrival_time_preference
organization
preferences
```

Driver:

```text
origin
destination
departure_time
available_seats
organization
verification
rating
```

---

# 31. Matching Stage 1 — Hard Filters

Reject candidate when:

- incompatible organization
- inactive commute
- blocked user
- insufficient verification
- no seats
- incompatible day
- time difference too large
- origin too far
- destination too far

---

# 32. Matching Stage 2 — PostGIS

Use spatial queries.

Conceptually:

```sql
ST_DWithin(driver_origin, rider_origin, radius)
```

and:

```sql
ST_DWithin(driver_destination, rider_destination, radius)
```

Use spatial indexes.

Do not load thousands of candidates into Node.js to calculate distance.

---

# 33. Matching Stage 3 — Time

Initial configurable rule:

```text
absolute(driver departure - rider preferred departure)
<= 20 minutes
```

Make this configurable.

Potential future configuration:

```text
10 min
15 min
20 min
30 min
```

---

# 34. Matching Stage 4 — Route

Version 1:

- origin distance
- destination distance
- approximate corridor

Version 2:

- route geometry
- route overlap
- detour cost

Create interfaces:

```text
MapsProvider
RoutingProvider
GeocodingProvider
```

Never hard-code Google/Mapbox-specific code throughout business logic.

---

# 35. Matching Stage 5 — Trust

Consider:

```text
organization verification
identity verification
driver verification
completed trips
rating
cancellation rate
reports
account age
```

---

# 36. Matching Stage 6 — Ranking

Initial hypothesis:

```text
score =
    geographic_score * 0.30
  + time_score * 0.20
  + route_score * 0.20
  + trust_score * 0.15
  + organization_score * 0.10
  + reliability_score * 0.05
```

These weights must be configurable.

Do not expose internal score to users.

---

# 37. Recurring Commute Architecture

Separate:

## Commute Template

```text
Monday-Friday
08:00
DHA → Gulberg
```

from:

## Trip Occurrence

```text
Monday
2026-10-12
08:00
```

Worker should generate upcoming trips only.

Recommended horizon:

```text
7–30 days
```

Do not generate years of trip records.

---

# 38. Booking State Machine

```text
REQUESTED
    |
    +--> ACCEPTED
    |       |
    |       +--> COMPLETED
    |       |
    |       +--> CANCELLED
    |
    +--> REJECTED
    |
    +--> EXPIRED
```

Validate every transition.

Do not allow invalid transitions such as:

```text
COMPLETED → ACCEPTED
```

unless an explicit administrative correction workflow exists.

---

# 39. Trip State Machine

```text
SCHEDULED
   ↓
READY
   ↓
STARTED
   ↓
COMPLETED
```

Possible alternatives:

```text
SCHEDULED → CANCELLED
STARTED → INCIDENT
```

Every transition must be audited.

---

# 40. Concurrency

Important race:

```text
1 seat available
2 riders request simultaneously
```

Solution:

```text
BEGIN TRANSACTION
    lock booking/commute capacity
    re-check available seats
    allocate seat
    create booking
COMMIT
```

The frontend must never be trusted for capacity.

---

# 41. Idempotency

Important operations should support idempotency.

Examples:

```text
Create ride request
Complete trip
Create payment
```

A mobile retry must not create duplicate records.

---

# 42. Notifications

Types:

```text
OTP
RIDE_REQUEST_RECEIVED
RIDE_REQUEST_ACCEPTED
RIDE_REQUEST_REJECTED
RIDE_CANCELLED
TRIP_REMINDER
TRIP_STARTED
TRIP_COMPLETED
RATING_REMINDER
SAFETY_ALERT
REPORT_UPDATE
VERIFICATION_UPDATE
```

Use:

```text
NotificationProvider
```

Implement:

```text
PushProvider
EmailProvider
SmsProvider
WhatsAppProvider
```

WhatsApp should come later.

---

# 43. Payment

Do not make payment a blocker for MVP.

Initially:

```text
Contribution = informational
Settlement = direct/cash arrangement
```

Later:

```text
PaymentIntent
PaymentTransaction
Refund
PaymentFailure
```

Never store raw card information.

Use a locally appropriate payment provider when payments are validated.

---

# 44. Safety Architecture

Safety must be a first-class feature.

## Reports

Categories:

```text
HARASSMENT
UNSAFE_DRIVING
INAPPROPRIATE_BEHAVIOR
FAKE_IDENTITY
PAYMENT_ISSUE
NO_SHOW
DANGEROUS_ROUTE
OTHER
```

## Incident lifecycle

```text
OPEN
↓
UNDER_REVIEW
↓
ACTION_REQUIRED
↓
RESOLVED
```

Possible actions:

- warning
- temporary suspension
- permanent suspension
- verification review
- no action

---

# 45. Emergency Features

MVP:

- emergency contact
- safety page
- trip information
- report action
- support action

Future:

- trusted contact notification
- configurable trip sharing
- live location
- safety timer

Do not claim the platform provides emergency response unless it actually does.

---

# 46. Fraud / Abuse

Implement:

- OTP rate limiting
- login rate limiting
- device/session tracking
- duplicate account detection
- excessive cancellation detection
- repeated report detection
- vehicle verification
- organization membership checks
- block lists

Later:

- risk scoring
- fraud models

Do not use an LLM for automatic bans.

---

# 47. Admin Dashboard

Pages:

```text
Dashboard
Users
Organizations
Verification Queue
Vehicles
Commutes
Ride Requests
Bookings
Trips
Reports
Incidents
Payments
Notifications
Audit Logs
Settings
```

Dashboard metrics:

```text
Registered Users
Verified Users
Active Users
Active Drivers
Active Riders
Active Commutes
Matches
Requests
Accepted Requests
Completed Trips
Cancellation Rate
Report Rate
Organization Activity
Weekly Retention
```

---

# 48. Organization Dashboard

Example:

```text
Employees registered
Verified users
Active commuters
Drivers
Riders
Completed trips
Estimated shared rides
Estimated parking reduction
```

Do not expose individual travel history unnecessarily.

---

# 49. Analytics

Create centralized event tracking.

Events:

```text
USER_REGISTERED
PHONE_VERIFIED
PROFILE_COMPLETED
ORGANIZATION_JOINED
VEHICLE_ADDED
VEHICLE_VERIFIED
COMMUTE_CREATED
COMMUTE_UPDATED
MATCH_SEARCHED
MATCH_VIEWED
RIDE_REQUEST_CREATED
RIDE_REQUEST_ACCEPTED
RIDE_REQUEST_REJECTED
RIDE_REQUEST_CANCELLED
TRIP_STARTED
TRIP_COMPLETED
TRIP_CANCELLED
RATING_CREATED
REPORT_CREATED
USER_BLOCKED
```

Event structure:

```text
event_id
event_name
user_id
organization_id
timestamp
metadata
```

Do not put sensitive personal information into analytics metadata unnecessarily.

---

# 50. North Star Metric

Primary metric:

> **Completed shared commute trips per week**

Secondary:

- weekly active commuters
- weekly active drivers
- match rate
- acceptance rate
- trip completion rate
- 7-day retention
- 30-day retention
- cancellation rate
- report rate
- average rating
- average seats filled
- repeat rides
- organization activation
- revenue per organization
- churn

Downloads are not the main success metric.

---

# 51. Mobile Screens

Authentication:

```text
Splash
Phone Login
OTP
Profile Setup
Organization Join
Verification
```

Main:

```text
Home
Find a Ride
Offer a Ride
My Commutes
My Trips
Notifications
Profile
Safety
```

Driver:

```text
Vehicle
Verification
Offer Commute
Requests
Passengers
Trip
```

Rider:

```text
Search
Matches
Ride Details
Request
Booking
Trip
Rating
```

---

# 52. Match Card

Example:

```text
Ahmed
4.8 ★
Organization Verified
Driver Verified

DHA Phase 5 → Gulberg
Mon–Fri
8:00 AM
2 seats
Rs. XXX contribution

[View]
[Request Seat]
```

Never show exact residential location.

---

# 53. Web Screens

Public:

```text
Landing
How It Works
Safety
For Companies
FAQ
Terms
Privacy
```

Organization:

```text
Dashboard
Members
Commute Insights
Policies
Settings
```

Admin:

```text
Dashboard
Users
Organizations
Verification
Vehicles
Commutes
Bookings
Trips
Reports
Incidents
Analytics
Audit Logs
Settings
```

---

# 54. UI Design

Design goals:

- trustworthy
- simple
- professional
- low cognitive load
- mobile-first

Avoid:

- excessive animation
- overly futuristic UI
- too many colors
- complex dashboards
- gamification

Highlight:

- verification
- rating
- route
- time
- seats
- contribution
- organization
- safety

---

# 55. Onboarding

Target:

> User should reach their first potential match in under five minutes.

Flow:

```text
Phone
 ↓
OTP
 ↓
Name
 ↓
Photo
 ↓
Organization
 ↓
Rider/Driver/Both
 ↓
Home Area
 ↓
Work/Study Area
 ↓
Verification
 ↓
Create Commute
 ↓
Show Matches
```

---

# 56. Rider Flow

```text
Signup
 ↓
Verify
 ↓
Join organization
 ↓
Create commute
 ↓
Search
 ↓
View driver
 ↓
Request seat
 ↓
Driver accepts
 ↓
Booking
 ↓
Reminder
 ↓
Trip
 ↓
Complete
 ↓
Rate/report
```

---

# 57. Driver Flow

```text
Signup
 ↓
Verify
 ↓
Join organization
 ↓
Add vehicle
 ↓
Vehicle verification
 ↓
Create recurring commute
 ↓
Set seats
 ↓
Set contribution
 ↓
Receive request
 ↓
Accept
 ↓
Trip
 ↓
Complete
 ↓
Rate/report
```

---

# 58. Marketplace Validation

Before spending months coding, validate manually.

## Interviews

Talk to:

- 20 employees
- 10 drivers
- 10 riders
- 5 HR/admin representatives
- 5 university/community representatives

Questions:

1. How do you commute?
2. How much do you spend?
3. How long does it take?
4. Do you drive alone?
5. Would you share with colleagues?
6. What prevents you?
7. Have you carpooled before?
8. What makes you trust another person?
9. Would you share your commute schedule?
10. Would your employer support it?
11. Would you pay?
12. Would you use it repeatedly?

Do not pitch too early.

---

# 59. Manual Marketplace Experiment

Create a simple form.

Collect:

```text
Name
Phone
Organization
Home area
Work area
Departure time
Return time
Driver/Rider
Available seats
```

Manually match users.

Use:

- spreadsheet
- simple backend
- WhatsApp for coordination

Goal:

> 20+ real recurring matches.

If 100 people register but nobody agrees to ride, do not continue blindly building the app.

Investigate why.

---

# 60. Pilot Success Target

Initial internal target:

```text
50+ users
15+ drivers
20+ riders
10+ recurring matches
30+ completed trips
30%+ repeat usage
```

These are product validation targets, not guaranteed industry benchmarks.

---

# 61. Development Phases

## Phase 0 — Discovery

Duration:

```text
1–2 weeks
```

Deliver:

- interviews
- landing page
- manual matching
- first community
- safety policy draft
- pricing hypotheses
- pilot commitments

Exit condition:

```text
3+ strong organization/community opportunities
AND
real users willing to participate
```

---

# 62. Phase 1 — Foundation

Build:

- monorepo
- CI/CD
- Docker
- PostgreSQL
- PostGIS
- Redis
- NestJS
- Next.js
- Expo
- environment management
- logging
- health checks
- Swagger/OpenAPI

---

# 63. Phase 2 — Authentication

Build:

- OTP
- sessions
- refresh
- logout
- users
- organization membership
- verification

Tests:

- correct OTP
- incorrect OTP
- expired OTP
- repeated OTP
- rate limiting
- session refresh
- logout
- authorization

---

# 64. Phase 3 — Vehicles / Commutes

Build:

- vehicle CRUD
- vehicle verification
- recurring commute
- schedules
- geospatial storage
- location privacy

Tests:

- coordinate validation
- schedule validation
- unauthorized access
- duplicate commute prevention
- inactive commute
- cross-tenant access

---

# 65. Phase 4 — Matching

Build:

- candidate search
- PostGIS
- time filtering
- organization filtering
- capacity
- trust ranking
- preferences

Test:

- exact match
- nearby match
- wrong time
- wrong organization
- no seats
- blocked user
- unverified user
- incompatible route
- ranking order

---

# 66. Phase 5 — Ride Requests / Booking

Build:

- request
- accept
- reject
- cancel
- booking
- trip generation

Test:

- duplicate request
- race conditions
- two riders requesting last seat
- cancellation
- expired request
- concurrent acceptance

---

# 67. Phase 6 — Trips / Safety

Build:

- trip lifecycle
- reminders
- emergency contact
- report
- block
- incident
- rating

Test:

- valid trip transitions
- invalid transitions
- report authorization
- block behavior
- safety data access

---

# 68. Phase 7 — Admin

Build:

- user management
- verification queue
- reports
- incidents
- organization management
- analytics
- audit logs

---

# 69. Phase 8 — Pilot

Deploy to:

```text
1 organization/community
```

Target:

```text
50–100 users
```

Founder should personally observe the experience.

---

# 70. Phase 9 — Improvement

Prioritize based on actual user friction.

Likely areas:

- matching
- onboarding
- organization joining
- verification
- notifications
- cancellation
- maps
- recurring trips
- safety

Do not build random features.

---

# 71. Phase 10 — Monetization

Only after repeat usage.

Add:

- platform fee
- organization subscriptions
- invoices
- payment provider
- reconciliation
- refunds

---

# 72. First 30-Day Engineering Schedule

## Days 1–3

```text
Repository
Architecture docs
Docker
PostgreSQL/PostGIS
Redis
CI
```

## Days 4–7

```text
Auth
Users
Sessions
Organizations
```

## Days 8–11

```text
Verification
Vehicles
Profiles
```

## Days 12–16

```text
Recurring commutes
Schedules
Location
```

## Days 17–21

```text
Matching engine
Matching UI
```

## Days 22–25

```text
Ride requests
Booking
Concurrency
```

## Days 26–28

```text
Trip generation
Trip lifecycle
Notifications
```

## Days 29–30

```text
Safety
Reports
Ratings
Pilot build
```

This is aggressive. Quality takes priority over the calendar.

---

# 73. Testing Strategy

## Backend Unit Tests

Test:

- matching scores
- commute rules
- booking rules
- state machines
- authorization
- cancellation
- pricing

## Integration Tests

Use actual PostgreSQL/PostGIS.

Test:

- repositories
- transactions
- spatial queries
- RLS
- authorization
- concurrency

## API Tests

Use:

```text
Jest
Supertest
```

## Web E2E

Use:

```text
Playwright
```

## Mobile

Use React Native testing tools.

Critical E2E:

```text
Signup
→ Verify
→ Join organization
→ Create commute
→ Search
→ Request
→ Accept
→ Trip
→ Complete
→ Rate
```

---

# 74. Seed Data

Create:

```text
5 organizations
100 users
30 drivers
70 riders
50 vehicles
100 commutes
200 trip occurrences
```

Include:

- blocked users
- suspended users
- unverified users
- full vehicles
- cancelled trips
- conflicting schedules
- invalid coordinates
- cross-organization requests

---

# 75. Security Checklist

Before pilot:

- HTTPS
- secure tokens/cookies
- refresh token rotation
- OTP rate limiting
- brute-force protection
- request validation
- SQL injection protection
- XSS protection
- CSRF protection where applicable
- strict CORS
- security headers
- secrets outside repository
- encrypted storage
- signed file URLs
- audit logs
- least privilege
- dependency scanning
- backups
- restore testing
- error redaction
- PII minimization

Never log:

```text
OTP
password
access token
refresh token
identity documents
unnecessary exact location
```

---

# 76. Privacy

Never expose:

- exact home address
- exact residential coordinates
- identity documents
- emergency contact information
- internal risk score
- private phone number without explicit policy

Use:

- approximate locations
- masked communication
- controlled access
- audit logs

Identity documents should preferably be separated from normal application data.

---

# 77. Data Retention

Define retention for:

```text
Account data
Trip data
Financial data
Identity documents
Reports/incidents
Audit logs
Analytics
```

Sensitive identity documents should not be retained indefinitely.

Get qualified local legal advice for exact requirements.

---

# 78. Legal Review

Before public launch, consult qualified Pakistan legal professionals regarding:

- company structure
- terms of service
- privacy
- consent
- identity verification
- transport/carriage regulations
- liability
- insurance
- payment/tax requirements
- data retention
- minors
- university users
- employer data

Do not use AI-generated legal text as a substitute for legal review.

---

# 79. AI Development Rules

AI coding tools may:

- generate boilerplate
- write tests
- create migrations
- review code
- refactor
- write documentation
- inspect logs
- create test cases
- generate edge cases

But every AI-generated change must:

1. Compile
2. Pass lint
3. Pass typecheck
4. Pass tests
5. Pass security checks
6. Be reviewed
7. Match product requirements

Never let an AI agent rewrite the architecture without approval.

---

# 80. AI Product Features Later

Potential AI:

## Support assistant

Answer:

- how to cancel
- how verification works
- how to report
- how contributions work

## Support triage

Classify support tickets.

## Fraud detection

Identify suspicious patterns for human review.

## Natural language commute creation

User:

> I need a ride from DHA Phase 6 to Gulberg at 8:15 every weekday.

AI converts it into structured data.

User must confirm before saving.

## Organization insights

Summarize aggregate commute trends.

Do not expose individual private travel information unnecessarily.

---

# 81. AI Must Never Autonomously

Do not allow AI to:

- approve sensitive identity documents without controls
- make final safety decisions
- permanently ban users solely based on an LLM judgment
- expose private locations
- perform core geospatial matching
- invent emergency information
- make legal claims
- promise safety

---

# 82. Feature Flags

Implement:

```text
WHATSAPP_NOTIFICATIONS
PAYMENTS
LIVE_LOCATION
AI_SUPPORT
CORPORATE_DASHBOARD
IDENTITY_VERIFICATION
ROUTE_MATCHING_V2
```

Feature flags should support organization-level rollout where useful.

---

# 83. Configuration

Do not hard-code:

- matching radius
- time tolerance
- contribution
- cancellation window
- verification requirements
- notification intervals

Configuration examples:

```text
MATCH_ORIGIN_RADIUS_METERS
MATCH_DESTINATION_RADIUS_METERS
MATCH_TIME_TOLERANCE_MINUTES
MAX_DRIVER_SEATS
TRIP_GENERATION_DAYS
CANCELLATION_WINDOW_MINUTES
```

---

# 84. Weak Network Support

Pakistan's mobile networks can be unreliable.

Mobile app must support:

- retries
- timeout
- offline banner
- loading state
- safe queued operations
- duplicate request prevention

Do not build full offline-first architecture initially.

---

# 85. Localization

Start with:

```text
English
```

Architecture must support:

```text
Urdu
Roman Urdu
```

later.

Do not hard-code strings everywhere.

---

# 86. Accessibility

Minimum:

- semantic HTML
- readable typography
- adequate contrast
- accessible touch targets
- screen-reader labels
- keyboard navigation
- understandable errors

---

# 87. CI/CD

Use GitHub Actions.

Pipeline:

```text
Pull Request
     ↓
Lint
     ↓
Typecheck
     ↓
Unit Tests
     ↓
Integration Tests
     ↓
Build
     ↓
Security Checks
     ↓
Merge
     ↓
Staging
     ↓
Smoke Tests
     ↓
Production Approval
     ↓
Production
```

Do not automatically ship untested code to production.

---

# 88. Observability

Every request should have:

```text
request_id
user_id
organization_id
endpoint
status
latency
error_code
```

where available.

Use structured logging.

---

# 89. Disaster Recovery

Minimum:

- automated PostgreSQL backups
- restore testing
- object-storage versioning where appropriate
- rollback documentation
- migration backups

Initial targets:

```text
RPO = 24 hours
RTO = 4 hours
```

Improve as the platform grows.

---

# 90. Definition of Done

A feature is NOT done because it compiles.

It is done when:

- requirement implemented
- validation implemented
- authorization implemented
- database constraints implemented
- unit tests
- integration tests
- E2E where relevant
- error handling
- logging
- analytics
- API docs
- loading state
- empty state
- failure state
- accessibility
- security review
- migration
- documentation

---

# 91. AI Agent Operating Loop

The coding agent must follow:

```text
READ REQUIREMENTS
      ↓
PLAN
      ↓
INSPECT EXISTING CODE
      ↓
IMPLEMENT SMALL CHANGE
      ↓
TYPECHECK
      ↓
LINT
      ↓
UNIT TEST
      ↓
INTEGRATION TEST
      ↓
E2E IF RELEVANT
      ↓
SECURITY REVIEW
      ↓
UPDATE DOCUMENTATION
      ↓
COMMIT
```

Never generate the entire platform in one huge operation.

---

# 92. AI Agent Persistent System Prompt

Give your coding agent this instruction:

```text
You are the principal engineer responsible for building a production-minded recurring carpooling platform for Pakistan.

Treat the repository documentation and product specification as the source of truth.

Primary priorities:

1. Correctness
2. Security
3. Privacy
4. Reliability
5. Testability
6. Maintainability
7. Low infrastructure cost
8. Fast iteration

Technology:

- React Native + Expo
- TypeScript
- Next.js
- NestJS
- PostgreSQL
- PostGIS
- Prisma
- Redis
- BullMQ
- S3-compatible object storage
- REST
- OpenAPI

Architecture:

- modular monolith
- clean module boundaries
- repository/service patterns where appropriate
- database-backed business rules
- provider abstractions for external services

Rules:

- Do not introduce microservices unless explicitly requested.
- Do not introduce Kubernetes unless explicitly requested.
- Do not introduce Kafka unless explicitly requested.
- Do not use an LLM for geographic matching.
- Never expose exact residential locations.
- Never bypass backend authorization because the UI hides a feature.
- Never store secrets in source control.
- Never create database migrations without checking their data impact.
- Never silently break API contracts.
- Never remove tests to make CI pass.
- Never ignore TypeScript errors.
- Never silently swallow exceptions.
- Never add major dependencies without explaining why.
- Prefer simple maintainable implementations.
- Prefer database constraints over application assumptions.
- Use transactions for race-sensitive operations.
- Use PostGIS for spatial candidate filtering.
- Store timestamps in UTC.
- Keep external APIs behind interfaces.
- Use feature flags for experimental features.
- Minimize collection and exposure of personal data.

For every task:

1. Restate the requirement.
2. Inspect the existing implementation.
3. Identify impacted modules.
4. Make the smallest coherent change.
5. Add or update tests.
6. Run lint.
7. Run typecheck.
8. Run unit tests.
9. Run integration tests.
10. Run E2E tests when relevant.
11. Review authorization/security/privacy.
12. Update documentation.
13. Report what changed.
14. Report tests executed.
15. Report remaining risks.

If a requirement is ambiguous:

- If it affects architecture, security, privacy, database design, or public API, ask before making a major assumption.
- For minor implementation choices, choose the simplest maintainable solution and document the decision.

Never invent business requirements.
Never invent legal requirements.
Never claim a security property that has not actually been implemented and tested.
```

---

# 93. First AI Coding Tasks

Execute these sequentially.

## Task 1 — Monorepo

Create:

```text
apps/api
apps/mobile
apps/web
apps/worker
packages/*
```

Acceptance:

- all projects build
- shared packages work
- lint passes
- typecheck passes

## Task 2 — Infrastructure

Docker:

```text
PostgreSQL + PostGIS
Redis
```

Acceptance:

- containers start
- health checks work
- migrations run

## Task 3 — Database

Create:

- Prisma schema
- migrations
- seed system
- indexes
- PostGIS setup

## Task 4 — Authentication

Implement:

- OTP
- sessions
- refresh
- logout
- rate limiting

## Task 5 — Users / Organizations

Implement:

- profiles
- organizations
- memberships
- invitation
- authorization

## Task 6 — Verification

Implement verification state/workflow.

## Task 7 — Vehicles / Commutes

Implement:

- vehicles
- recurring commutes
- schedules
- approximate locations

## Task 8 — Matching

Implement:

- PostGIS candidate search
- filters
- scoring
- ranking

## Task 9 — Ride Requests

Implement:

- request
- accept
- reject
- cancel
- booking
- concurrency

## Task 10 — Trips

Implement:

- trip generation
- state machine
- completion

## Task 11 — Notifications

Implement:

- push
- in-app
- reminders

## Task 12 — Safety

Implement:

- reports
- blocks
- incidents
- emergency contacts

## Task 13 — Ratings

Implement:

- post-trip ratings
- review aggregation

## Task 14 — Admin

Implement:

- admin web
- verification
- incidents
- reports
- users
- organizations

## Task 15 — Analytics

Implement:

- event system
- dashboards
- KPI calculations

## Task 16 — Staging

Deploy staging.

## Task 17 — Pilot

Recruit real users.

Do not build major new functionality before observing the pilot.

---

# 94. 90-Day Business + Engineering Plan

## Month 1

Product:

- 50–100 pilot users
- one community
- recurring matching
- real completed trips

Engineering:

- MVP
- tests
- staging
- monitoring

## Month 2

Product:

- improve matching
- improve onboarding
- improve retention
- improve safety
- second community

Engineering:

- organization dashboard
- support tooling
- analytics
- notification improvements

## Month 3

Product:

- 3–5 communities/organizations
- start charging selected organizations
- test B2B pricing

Engineering:

- payment abstraction
- improved verification
- better matching
- production hardening

---

# 95. 6–12 Month Expansion

Possible sequence:

```text
Month 1
MVP

Month 2
Pilot + reliability

Month 3
Multiple communities + monetization

Month 4
Corporate dashboard + verification

Month 5
Improved route matching

Month 6
Payments + WhatsApp

Month 7
Parking management

Month 8
Corporate mobility analytics

Month 9
Advanced safety

Month 10
Islamabad/Rawalpindi pilot

Month 11
Enterprise features

Month 12
Multi-city infrastructure
```

This is a hypothesis, not a rigid schedule.

Advance only when real usage supports it.

---

# 96. Growth Loop

Natural growth:

```text
Driver joins
      ↓
Creates commute
      ↓
Riders discover commute
      ↓
Riders join
      ↓
Driver gets value
      ↓
Riders invite colleagues
      ↓
More commuters
      ↓
More matches
```

The product should encourage:

> Invite colleagues from the same commute corridor.

---

# 97. Corporate Sales

Target:

- HR
- Administration
- Operations
- Facilities
- People Experience
- Office Management

Pitch:

> Reduce employee commute friction and parking pressure through a verified employee carpool network.

---

# 98. University Sales

Target:

- administration
- student affairs
- societies
- transport office

Position around:

- affordability
- safety
- verified communities
- predictable commuting

---

# 99. Housing Society Sales

Target:

- community management
- resident associations
- resident groups

Position:

> Help residents share recurring commuting costs with verified people from the same community.

---

# 100. Five-Minute Sales Demo

Demo:

```text
1. Join organization
2. Verify
3. Create commute
4. Find compatible driver
5. Request seat
6. Driver accepts
7. Show trip
8. Show safety
9. Show organization dashboard
```

Do not lead with:

```text
NestJS
PostGIS
Redis
AI
Docker
```

The customer does not care about the stack.

---

# 101. Pilot Offer

Example:

> Founding Community Program

Includes:

- onboarding
- verification
- private community
- commute matching
- admin dashboard
- support

Offer a fixed free/discounted pilot.

Never promise indefinite free service.

---

# 102. Pricing Experiments

Test:

### Model A

Free user + transaction fee.

### Model B

Premium individual plan.

### Model C

Organization SaaS.

### Model D

Organization subsidizes commuting.

### Model E

Hybrid.

Do not assume the commuter is the payer.

---

# 103. Marketplace Liquidity

Measure marketplace health at:

```text
corridor × day × time × organization
```

Example:

```text
DHA → Gulberg
Monday-Friday
08:00
Company X
```

Measure:

- drivers
- riders
- open seats
- demand
- matches
- completed trips
- repeat trips

A city can have 10,000 registered users and still have poor marketplace liquidity.

---

# 104. Founder Operations

Initially the founder acts as:

- engineer
- product manager
- sales
- customer support
- community manager
- incident manager

Daily activities:

- monitor trips
- handle reports
- review incidents
- recruit users
- contact organizations
- inspect failed matches
- talk to users
- improve onboarding

Automate later.

---

# 105. Parking Expansion

Future B2B feature:

> Reduce employee parking demand.

Possible analytics:

```text
Employees
      ↓
Single-occupancy commuters
      ↓
Potential carpool candidates
      ↓
Potential shared rides
      ↓
Vehicles avoided
      ↓
Parking demand reduction
```

This may be a stronger enterprise proposition than simply "carpooling."

---

# 106. Corporate Transport Expansion

Long-term evolution:

```text
Carpool
  ↓
Parking
  ↓
Shuttle demand
  ↓
Corporate transport
  ↓
Mobility management
```

Potential long-term positioning:

> **Workplace Mobility Platform for Pakistan**

---

# 107. Expansion Strategy

Only expand after local liquidity.

Suggested:

```text
One Lahore organization
        ↓
Three organizations
        ↓
One Lahore business district
        ↓
Several Lahore communities
        ↓
Lahore-wide selected corridors
        ↓
Islamabad/Rawalpindi
        ↓
Karachi
        ↓
Other cities
```

Do not expand merely because registrations increase.

---

# 108. Kill Criteria

Be willing to pivot if:

- users refuse to share rides
- safety concerns prevent adoption
- driver supply is too low
- recurring matches are poor
- users only want instant rides
- acquisition cost becomes unreasonable
- organizations refuse participation
- users do not repeat
- no clear payer emerges

Possible pivots:

```text
Corporate transport software
Parking management
Company shuttle management
Commute analytics
Employee mobility platform
```

Do not keep building just because code already exists.

---

# 109. Final Architecture

The initial production architecture should look approximately like:

```text
                 ┌──────────────────┐
                 │   React Native   │
                 │   Expo Mobile    │
                 └────────┬─────────┘
                          │
                          │ HTTPS
                          ▼
                 ┌──────────────────┐
                 │    NestJS API    │
                 │ Modular Monolith │
                 └───────┬──────────┘
                         │
          ┌──────────────┼───────────────┐
          │              │               │
          ▼              ▼               ▼
 ┌────────────────┐ ┌──────────┐ ┌──────────────┐
 │ PostgreSQL     │ │  Redis   │ │ Object       │
 │ + PostGIS      │ │          │ │ Storage      │
 └────────────────┘ └────┬─────┘ └──────────────┘
                          │
                          ▼
                    ┌───────────┐
                    │  BullMQ   │
                    │  Worker   │
                    └───────────┘

                 ┌──────────────────┐
                 │     Next.js      │
                 │ Admin / Company  │
                 └──────────────────┘
```

---

# 110. Final Product Architecture

The core domain should eventually look like:

```text
AUTH
 │
 ├── USERS
 │
 ├── ORGANIZATIONS
 │      │
 │      └── MEMBERSHIPS
 │
 ├── VERIFICATION
 │
 ├── VEHICLES
 │
 ├── COMMUTES
 │      │
 │      └── SCHEDULES
 │
 ├── MATCHING
 │
 ├── RIDE REQUESTS
 │
 ├── BOOKINGS
 │
 ├── TRIPS
 │      │
 │      └── PARTICIPANTS
 │
 ├── RATINGS
 │
 ├── SAFETY
 │      ├── REPORTS
 │      ├── INCIDENTS
 │      └── BLOCKS
 │
 ├── NOTIFICATIONS
 │
 ├── PAYMENTS
 │
 └── ANALYTICS
```

---

# 111. Long-Term Product Evolution

The business should evolve:

```text
                    START
                      │
                      ▼
            Closed Community
                Carpooling
                      │
                      ▼
          Recurring Commute
              Matching
                      │
                      ▼
          Verified Workplace/
          University Mobility
                      │
                      ▼
            Corporate SaaS
                      │
              ┌───────┴───────┐
              ▼               ▼
          Parking          Analytics
         Management
              │               │
              └───────┬───────┘
                      ▼
            Corporate Transport
                      │
                      ▼
            Multi-City Mobility
```

---

# 112. Final Engineering Rule

Build the:

> **smallest trustworthy system capable of producing real recurring shared trips.**

Do not optimize for:

- downloads
- vanity metrics
- feature count
- complicated architecture
- AI everywhere

Optimize for:

```text
Real users
     ↓
Real matches
     ↓
Real trips
     ↓
Repeated trips
     ↓
Trust
     ↓
Paying organization
     ↓
Repeatable acquisition
     ↓
Scale
```

---

# 113. First Business Milestone

The first serious milestone is:

```text
100 real users
        ↓
20 real drivers
        ↓
20+ recurring matches
        ↓
100+ completed trips
        ↓
repeat usage
        ↓
one organization willing to pay
```

Once this is achieved, invest more heavily in:

- route matching
- payments
- WhatsApp
- corporate dashboards
- parking
- safety
- analytics
- infrastructure scaling

Until then, keep everything simple.

---

# 114. One-Sentence Product Definition

> **A verified recurring-commute platform that connects people from the same organization or community who travel similar routes at similar times, starting in Lahore and eventually becoming a broader workplace mobility platform.**