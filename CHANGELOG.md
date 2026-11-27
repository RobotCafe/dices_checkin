# Changelog

All notable changes to DICES check-in. Newest first. Dates are BC time.

Sections per release: **Added** (new features), **Changed** (behaviour that works differently), **Fixed** (bugs),
**Security** (access rules, data protection), **Setup** (tooling, deployment, docs). Add entries under
**Unreleased** as you go; when a version is deployed, rename that heading to the version and date.

## Unreleased

Not yet deployed to Vercel.

### Setup (deployment)
- Firebase project `dices-checkin` created, with a web app registered. Firestore `(default)` database in
  Montréal (`northamerica-northeast1`), so the data stays in Canada; security rules and indexes deployed.
- Google sign-in enabled. Master admin and the Growing Up Denman program (linked to its Zeffy campaign) created.
- Vercel project `dices-checkin` created and connected to the GitHub repo (now public); settings stored in Vercel.
- Firebase service account key files can never be committed.

### Added
- Zeffy webhook signatures are verified, following Zeffy's API documentation: messages without a valid
  `Zeffy-Signature` or older than 5 minutes are rejected. Events the app doesn't act on are kept in an admin-only
  `webhookEvents` collection.
- Refunds and disputes: when Zeffy reports a payment changed, the app looks it up through Zeffy's API and flags
  refunds and disputes for review.

### Changed
- Reading Zeffy payments now follows Zeffy's documented format instead of guessed field names. The purchase time
  comes from Zeffy (it used to be the time the app received the message), donations in the same payment are
  skipped quietly, the buyer's phone is picked up from the phone question, and each payment records whether it
  was online or entered manually. Payments that already have a refund or dispute are flagged.

### Fixed
- Birth dates from Zeffy are read whether the buyer typed one date ("March 2, 2021", "2021-03-02", "25/03/2021")
  or answered separate day / month / year questions. Previously only `YYYY-MM-DD` worked, so the under-3 rule
  never applied and every ticket was flagged. Ambiguous dates such as 03/04/2021 are left blank and flagged for
  review with what the buyer typed, rather than guessed.
- Check-in, override and check-out no longer wait for the server. Offline, the screen used to look frozen because
  Firestore only finishes a write once the server confirms it. The record now shows right away and syncs when the
  connection returns.
- Headcount +1 / −1 uses an atomic increment, so taps from several tablets (or made offline) all count. Before,
  the last tablet to save overwrote the others. −1 does nothing at zero.
- The Zeffy webhook claims each payment in a transaction before processing it. The same payment delivered
  several times at once (Zeffy retries) used to create duplicate passes. A claim left by a crashed attempt
  expires after 2 minutes so the next retry still goes through.
- A refund or dispute event that reaches the webhook before the payment itself no longer has its review flag
  wiped when the payment is processed.

### Security
- A visit can be checked out only once; a second check-out can't overwrite the time.
- Headcount records accept only their expected fields, so names or other personal data can't be stored in them.

### Setup
- Firestore composite indexes declared for the check-in screen's people and household lookups.
- Emulator tests: `npm run test:rules` checks the security rules (staff, program-lead scoping, check-in,
  check-out, voids, headcounts, payments) and the Zeffy webhook. Needs Java. Emulator port 8287.
- `npm test` works on Windows. `npm run seed-admin` reads `.env.local`.
- HANDOFF.md: setup steps for the Firebase and Vercel CLIs on Windows; Zeffy campaign id and the 25 actual
  Growing Up Denman session dates (no session Dec 25, Jan 1, Mar 19, Mar 26, May 21); open decisions.
- This changelog.

## 0.1.0 (2026-11-26): first version, built in claude.ai

### Added
- Staff-only app with Google sign-in: one master admin, staff by invite, optionally limited to specific programs
  (program leads).
- Many programs in one app. Each program is either **tracked** (named people, passes, check-in and check-out) or
  **headcount** (an anonymous +1 / −1 counter for food bank, hampers, coupons; no names stored).
- Check-in and check-out per program, with the program remembered per tablet. Picks the best valid pass (season,
  then punch card, then drop-in, then pay what you can). Under the program's free age, no punch is used.
  Staff override with a reason when there is no valid pass. "Close session" checks out everyone left, marked
  as automatic.
- Zeffy webhook: one endpoint for all programs, matched by Zeffy campaign id. Creates households, people and
  passes from each payment, stores the raw payment, and flags anything it can't read for review.
- Admin: staff and their program scopes, program editor, merge duplicate people, payments needing review.
- Reports: usage per program, with CSV export.
- Growing Up Denman preset: Drop-in, Punch card (10), Year Supporter, Pay what you can; under 3 free; season
  Nov 27 2026 to Jun 25 2027.

### Security
- Firestore rules: only invited staff with a verified Google email; program leads see only their programs;
  payments readable by the admin only; nothing can be deleted from the app.
