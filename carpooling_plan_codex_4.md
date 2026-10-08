# Carpool Pakistan — Review and Pilot Execution Plan, Revision 4

> **Superseded direction (2026-10-07):** this document records the earlier concierge/community strategy. The current product decision is open email signup with one account that can switch between Rider and Driver. No user-facing community, sponsor, or operator gate is required for signup. See `MVP_SPEC.md` and `plan.md` for the current direction. This historical review is retained for context.

## Review of the latest feedback

The feedback correctly identifies three gaps in Revision 2: acquisition effort, coordinator effort, and precise repeat-behavior definitions. Those are worth adding to the pilot scorecard because a manual pilot can otherwise appear successful while depending on unusually intensive recruiting or founder coordination.

The feedback’s overall direction remains sound: test one dense commute cell manually, observe completed and repeated trips, then decide whether to build, revise the hypothesis, or stop. The comments do not constitute market evidence, though. The suggested cohort, channels, effort examples, and trip counts are prompts for measurement, not benchmarks.

### Qualifications to the additions

- **Recruitment channel:** Attribute invitations and subsequent funnel steps to a source, but a single small pilot cannot establish a scalable or low-cost acquisition channel. Referrals, HR introductions, and WhatsApp groups may overlap; record multiple touches where relevant, and do not claim causal attribution from simple source tags.
- **Operator effort:** Record both initial setup/recruiting time and recurring coordination time. Report total hours and hours per completed trip, with the period and trip count. This is a useful operational burden measure, but early values are affected by learning, one-off setup, and small denominators; it is not yet unit economics.
- **Repeat behavior:** Separate people who complete a second trip from people who had a genuine later opportunity to repeat. A person with no comparable commute in the observation window should not be counted as a failure to repeat. Conversely, two trips arranged for one unusual occasion should not be described as evidence of a recurring habit.
- **Trip thresholds:** “10 trips,” “2–5 matches,” and “30–50 participants” may help with planning, but none is a universal gate. Set a minimum observation window and a cohort-appropriate threshold before starting; evaluate trips across distinct commute cycles and disclose the denominator.
- **Three outcomes:** Build, change the hypothesis, and stop are useful decision categories, but “continue the experiment with a revised cell or operating rule” may be a legitimate intermediate decision. Set a limit on how many changes will be tested so that indefinite experimentation does not substitute for a decision.
- **Safety:** Neither low operator effort nor repeat usage demonstrates safety. Safety remains a prerequisite and an operational process, not a small-sample success statistic.

The feedback's stack guidance is sensible after validation, but the right tools still depend on the actual team's skills and support capacity. No particular framework should be selected solely because the feedback assumes the founder knows it.

The recommendation to “freeze” Revision 3 is reasonable as a warning against endless document iteration. However, the feedback identifies practical omissions that change how the pilot should be run. This revision adds those execution details and should be the last strategy-plan iteration unless new evidence or a material constraint emerges.

## Objective

> Find one sufficiently dense Lahore community/organization with overlapping recurring commutes, manually create real shared trips, learn whether participants repeat, and test whether a sponsor has a concrete reason to continue.

This pilot is a learning experiment. It is not a city launch, proof of product-market fit, statistical safety assessment, or proof of a repeatable enterprise sales process.

## Stage 1 — Choose and prepare one commute cell

Select one reachable organization/community and a sponsor or community contact who will help recruit and handle operational coordination. Define one or two candidate cells by:

```text
community × weekday(s) × departure/arrival window × approximate origin area × destination area
```

Before recruiting at scale, write a short hypothesis and identify its assumptions. For example:

> Adults in Community X who regularly travel between approximate Area A and Area B during Window W will accept suitable carpool proposals, and some participants with later comparable commute opportunities will choose to repeat.

List the assumptions this depends on: existing recurring travel, enough driver seats and rider demand, schedule overlap, acceptable pickup/detour, trust within the community, meaningful participant value, and sponsor access. For each, state what observation could weaken it. Keep this as a testable hypothesis, not a claim about demand.

Do a small, consent-based density discovery before broad recruitment: invite a reachable subset to share approximate origin area, destination, travel days, departure/arrival window, and driver/rider/seat availability. Cluster responses into candidate cells and focus recruitment on the densest plausible cell. Collect this commute information only after the privacy protocol is in place. A target such as 30–50 reachable adults can be used for planning, but revise it from actual schedules and seat supply; total cohort size does not establish liquidity. Keep any initial pilot adult-only unless a proper safeguarding process for minors is designed.

Before collecting commute information or facilitating trips, prepare a short pilot brief and safety/privacy protocol. Specify:

- eligibility, membership checks, driver/vehicle review, and what those checks do and do not establish;
- consent, participant opt-out, and who may see profile, commute, contact, and vehicle information;
- approximate location collection, exact pickup sharing only when needed between matched participants, access controls, and a deletion date;
- named support owner, support hours, report intake and escalation, suspension/review, and operational limitations;
- cancellation, no-show, cost-sharing, and dispute expectations;
- the actual emergency escalation route; do not imply the pilot provides emergency response;
- any qualified local legal, insurance, or organizational review needed before the first organized trip.

Collect only the data needed to operate the experiment. Do not collect CNIC or identity documents by default. Keep trip data out of open group chats and general-purpose shared files. Restrict the operational record and delete it according to the stated retention rule.

**Readiness gate:** a named operator; a reachable cohort; at least one plausible cell with drivers/seats and riders; participant understanding and consent; and a workable process for questions and concerns. If overlap is insufficient, refine the cell or recruit more of the same community before arranging trips.

## Stage 2 — Run the concierge pilot

Use a short intake form, restricted operational record, and a communication channel participants already accept. The coordinator checks eligibility, proposes candidates using simple stated filters, and facilitates individual dated trips. Each request is for a specific date; do not create indefinite recurring reservations. Confirm outcomes with both parties where practical and record disagreement separately.

The founder should personally observe and participate in the early concierge workflow where practical: recruitment, commute intake, match proposal, rejection, acceptance, coordination, cancellation, trip confirmation, repeat, and any concern/report. This firsthand observation helps reveal workflow and trust barriers before they are automated. It does not mean the founder should handle a report beyond their training or the agreed escalation process; use the named responsible operator and escalation route.

Set a start date, review date, observation window, and stop conditions before recruiting. A weekday pilot may need several commute cycles; two to four weeks is an initial planning range, not a guaranteed duration. Holidays, recruitment speed, and sparse cells may require a different period.

### Scorecard and definitions

Keep definitions stable and report counts with denominators. Avoid pooling different commute cells in ways that hide a lack of overlap.

| Funnel stage | Record |
|---|---|
| Invited | People invited; recruitment source(s), date, and inviter |
| Responded | People who respond; distinguish positive, negative, and no response where known |
| Eligible/consented | People meeting pilot rules who consent to participate |
| Commute submitted | Eligible participants with a sufficiently complete commute for matching |
| Active supply/demand | Drivers with seats and riders with an actual dated need, by cell and date |
| Viable candidate | Pair meeting the simple, predeclared matching filters for a dated trip |
| Offered / accepted | Candidate proposal sent / both participants agree to that dated trip |
| Completed | Trip confirmed by both participants, or confirmation discrepancy explicitly recorded |
| Repeat participant | Participant completes at least two trips on separate dates during the stated window |
| Repeat opportunity | A participant had at least one later comparable commute for which a viable trip was available or offered |
| Repeat among opportunity | Participants who complete a later comparable trip divided by participants with a repeat opportunity; also report raw counts |
| Continued action | Participant opts into a later cycle, submits another real commute, or takes another concrete continuation step |

Do not count “registered,” “interested,” “matched,” and “completed” as interchangeable. Report both participant-level repeat and trip-level repeat. If useful, report repeat among completers as a secondary measure, but do not confuse it with repeat among participants who had a viable later opportunity.

### Acquisition and operating effort

For each channel or introduction path (for example, sponsor/HR introduction, member referral, existing community group, or direct outreach), record:

```text
Invited → responded → eligible/consented → commute submitted → viable match → completed → repeat
```

Record more than one source when people encounter multiple channels. Treat the results as descriptive for this pilot; do not infer that one channel caused conversion or will scale cheaply from a small, overlapping sample. Ask what access or sponsor effort was required to reach the participants.

Track operator time separately as:

- one-time setup and recruitment;
- recurring intake and eligibility review;
- matching and participant coordination;
- trip follow-up and recordkeeping;
- support/report handling.

Report total time and recurring coordination hours per completed trip for each period, alongside completed-trip count. Explain one-off work and changes in process; do not present early hours-per-trip as validated unit economics. Include founder/sponsor introductions and unpaid labor rather than treating them as free.

Also record declined-match reasons, cancellations/no-shows, time from intake to proposal, participant feedback, support workload, and concerns/handling outcomes. Offer optional, non-leading decline reasons such as pickup distance, timing, destination/detour, schedule uncertainty, contribution, insufficient trust/familiarity, vehicle/driver concern, preference not met, already-arranged transport, or other/prefer not to say. Allow multiple or participant-written reasons. Do not infer sensitive traits, pressure users to explain, or use a single decline reason as proof of a broad product requirement. Review repeated patterns with context.

Do not use a low incident count as evidence of safety. A small sample cannot support a reliable safety-rate claim.

### Pre-agreed learning gates

Agree thresholds with the pilot contact before starting, based on cohort size, commute frequency, and the time available. Do not use the examples below as universal industry benchmarks.

1. **Liquidity:** at least one defined cell has overlapping drivers/seats and riders, with viable dated candidates.
2. **Actual behavior:** enough trips complete across multiple distinct commute cycles to inspect acceptance, cancellations, and participant feedback. Set the minimum count/window in advance; a number like 10 is only an illustrative planning prompt.
3. **Repeat signal:** report how many completers had another comparable opportunity, how many accepted and completed it, and over what period. Do not call an isolated second trip a habit or market validation.
4. **Operational feasibility:** the named operator can perform the workflow, control access to data, and respond under the stated process. Any unresolved serious safety, privacy, or operational issue pauses live matching.
5. **Sponsor/value signal:** distinguish positive comments from action. Stronger evidence includes a scheduled continuation, sponsor-provided recruiting access, a budget-owner meeting, or a concrete paid-pilot discussion. One pilot does not prove a repeatable B2B sales process.
6. **Effort and access:** describe how participants were reached and the setup/recurring operator time required. Use this to decide what to test next, not to claim scalable acquisition economics.

If the cell is sparse, adjust recruitment/cell once or twice within a pre-agreed experiment limit before concluding. If trips complete but do not repeat, investigate actual reasons and test one material change. Then decide whether to build, revise the hypothesis, run one bounded follow-up, or stop. Do not keep changing the target indefinitely to avoid a decision.

## Stage 3 — Decide whether to build

At the review date, summarize:

- which cells had real overlapping supply and demand;
- the funnel by recruitment source, with the limitations above;
- completed trips and repeat rates with clear opportunity denominators;
- cancellation/no-show and decline reasons;
- one-time and recurring operator effort;
- participant behavior versus stated interest;
- sponsor actions and any real budget/continuation path;
- safety/privacy concerns and how they were handled;
- which manual steps repeatedly caused friction.

Build only if repeated use and a responsible operating process justify software, and if software addresses observed friction. If not, choose a bounded hypothesis change, another defined experiment, or stop. Manual coordination being inconvenient by itself is not proof that a software marketplace will work.

If building, start invitation-only with a responsive web flow for the same cohort. Scope only the demonstrated workflow: approved membership, approximate commute templates, a small rolling window of dated occurrences, explainable candidate filters, request/accept/cancel for one occurrence, limited operator tools, and report/block handling. Keep trip requests date-specific. Defer payments, live location, route optimization, complex trust scoring, identity-document storage, organization analytics, multi-city support, native apps, Redis/queues, and separate services until evidence or a clear operational need supports them.

Before implementation, decide occurrence creation, seat reservation/release, expiry and cancellation, edits after acceptance, contact and vehicle visibility, report access, retention/deletion, suspension, and audit rules. Test access boundaries, matching rules, valid state transitions, duplicate requests, and simultaneous requests for the last seat. Select technology based on actual team capability and deployment/support needs; PostgreSQL and a modular monolith are reasonable defaults for a justified custom product, with PostGIS conditional on query needs.

## Stage 4 — Controlled software pilot and expansion

Invite the original community first and retain the same scorecard. Compare manual and software-assisted operation without assuming that a change in conversion was caused by the software. Observe early trips, review failed matches, and fix the largest demonstrated issue. Expand to another cell or organization only after the recruiting and operating method appears repeatable and there is a credible sponsor/value path.

Treat commuter savings, community service, employer parking/commute value, and broader mobility management as separate business hypotheses. Evidence from one pilot can inform them but cannot establish general willingness to pay, acquisition scalability, safety, or enterprise sales repeatability.

## Lightweight artifacts

For a solo pilot, keep the process lean:

1. `PILOT_BRIEF.md` — cohort, cell(s), owner, dates, gates, and scorecard.
2. `SAFETY_PRIVACY.md` — eligibility, consent, access, retention, support, escalation, and limitations.
3. `CONCIERGE_RUNBOOK.md` — intake, matching, communication, confirmation, and issue handling.
4. `DECISIONS.md` — dated decisions, evidence, owner, and revisit/stop trigger.

Create product requirements and an engineering specification only after the pilot gate. Keep the original plan as long-term vision/reference material, not as an implementation backlog.

## Recommendation

Adopt the concierge-first strategy and add recruitment-source tracking, separated operator-time accounting, explicit repeat denominators, density discovery, decline-reason capture, and firsthand observation of early operations. The next milestone is one prepared commute cell and a bounded manual experiment with a written hypothesis and pre-agreed gates. Judge it by actual dated trips, later comparable opportunities, repeat behavior, operating burden, participant access, and sponsor actions. Treat all small-sample findings as directional learning; they do not prove safety, unit economics, product-market fit, or scalable acquisition. Freeze this strategy document after this revision unless new pilot evidence or a material constraint requires a change.
