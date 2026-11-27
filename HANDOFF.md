# Handoff: DICES check-in

Written 2026-11-26 from a claude.ai chat, for Claude Code. Owner: Nicolas (Denman Island, BC), who runs this for
DICES (Denman Island Community Education Society, a registered charity). He builds in Next.js + Firebase and has a
similar app, GreenRaven Ops, to match in style (master admin plus staff invites).

## Goal
Programs like Growing Up Denman had no way to collect payment at registration or to track who has paid. Plan:
- **Zeffy** (free for nonprofits) takes payments: card online; cash and e-transfer entered by staff as manual payments.
- **This app** (staff-only) reads payments from Zeffy and handles **check-in and check-out** for punch-card and
  season-pass holders, for liability and record keeping, plus usage reports per program.
- It will serve **many DICES programs**: Growing Up Denman, After School Arts and Rec, Adult Education, Adult
  Recreation (soccer, volleyball, basketball), Teen Night, school food, spring break and summer camps, food bank,
  holiday hampers, market coupons, school support.
- Planned home: https://checkin.dices.ca (subdomain of the WordPress site dices.ca; one CNAME at the DNS host).
- GitHub: https://github.com/RobotCafe/dices_checkin

## Decisions already made (don't re-ask)
- Payments via Zeffy only. Cash/e-transfer = Zeffy manual payment (Payments > Add payment > Add manually).
- Tiers (Growing Up Denman): Drop-in $5, Punch card 10 sessions $40, Year Supporter (donation-flavoured, no refunds),
  Pay what you can ($0 ticket, also used for subsidy). Sessions are Fridays 9:00 am, Nov 27 2026 to Jun 25 2027.
- **A punch card belongs to one program.**
- One punch per person per visit, **except under age 3 (per-program rule, `freeUnderAge`)**: they use no punch but
  still need a valid pass.
- Check-in **and** check-out are recorded. "Close session" checks out everyone left, flagged as automatic.
- Duplicate people can be merged (admin). Staff-only login: one master admin, staff by invite (Google sign-in).
  Invited staff can be limited to specific programs (program leads).
- Children's data kept minimal (name, birth date, dietary, caregiver contact); security rules locked down; a
  retention period still to be decided.
- **Free programs (food bank, hampers, coupons) are headcount-only: a +1/-1 counter, no names stored.**
- BC has no daylight saving; Zeffy is set to GMT-7. All dates here are BC time (`src/lib/time.ts`).
- Product name: "DICES check-in"; repo `dices_checkin`.

## State of the code (all in this repo)
Built and unit-tested (`npm test`, `npm run typecheck`, `next build` all pass). **Never run against a real Firebase
project or a real Zeffy payment.**
- `src/lib/types.ts`: Program, Household, Person, Pass, Visit, Headcount, StaffMember.
- `src/lib/passes.ts`: pure check-in logic (`decideCheckIn`, `statusOf`, `punchCostFor`). Punches left are
  computed from visits (so it works offline). Pass priority: season, punch, drop-in, pay-what-you-can.
- `src/lib/zeffy.ts`: maps a Zeffy payment to tickets. **Field names are guesses** (see below).
- `src/lib/programConfig.ts`: pass-type text parsing and the Growing Up Denman preset.
- `src/app/api/zeffy/webhook/route.ts`: one webhook for all programs; program found by Zeffy campaign id;
  idempotent per payment id; stores the raw payload in `payments/` and flags problems for review.
- `src/app/page.tsx` (check-in/out, program picker remembered per tablet, headcount counter),
  `src/app/admin/page.tsx` (staff and scopes, programs editor, merge people, payments needing review),
  `src/app/reports/page.tsx` (usage per program, CSV export). `src/gate.tsx` is the auth gate.
- `firestore.rules`: staff = verified Google email with a doc in `staff/{email}`; admin sees all; program leads
  limited by `programIds`; headcount docs have no personal data; payments readable by admin only.
- `scripts/seed-admin.ts`: creates the master admin and an example Growing Up Denman program.
- Offline: Firestore persistent local cache is enabled in `src/lib/firebase.ts` (not yet tested on a tablet).

## What is unverified or known-weak (check these first)
1. **Zeffy payload shape.** Zeffy's docs say payments carry line items, buyer info and answers to custom questions,
   but not the field names. `parsePayment` tries several. Do a test purchase of each rate, read the saved raw
   payload (`payments/<id>`), and tighten `src/lib/zeffy.ts` and its tests. The webhook event is `payment.completed`;
   `payment.updated` (refunds/disputes) carries only the id.
2. **Do manual cash/e-transfer entries fire the webhook or appear in the API?** Unknown; docs say the API can filter
   payments by type online/manual/imported. If not, add a scheduled poll of the Zeffy API (Bearer key, read-only for
   payments; it can also write manual payments once Stripe verification is done).
3. How a ticket bought for one Friday occurrence relates to a season pass: Zeffy multi-date events make the buyer
   pick one date per transaction, so a Year Supporter / punch ticket is tied to one occurrence. The app ignores the
   chosen date and treats the pass as valid for the whole season.
4. Firestore rules have not been tested in the emulator. Composite indexes may be requested on first use (the
   error contains a link).
5. Revenue and break-even reporting is not built (only usage). Voiding a visit has a rule but no UI.

## Zeffy facts (read via the official Zeffy connector, read-only; nothing was changed)
- Campaign "Growing Up Denman" (event). Organization is in Canada (CAD). Rates: Drop-in $5; "Punch card: 10 sessions"
  $40; Year Supporter $175 (**the Claude Doc below says $160: unresolved, ask Nicolas**); Pay what you can $0.
  Additional donations enabled.
- Per-ticket questions: Full Name, Email, Phone (optional), Child's Name, Child's Birth date (separate text fields),
  Dietary restrictions (multi-select), Other dietary restrictions, caregiver/guardian checkbox, DICES cost
  acknowledgment checkbox, suggestions (optional).
- 31 weekly Friday occurrences were listed (Nov 27 2026 to Jun 25 2027), with many archived duplicates from edits;
  Nicolas has since updated the dates. Check whether holiday and spring-break Fridays are meant to be included.
- Zeffy connector URL (custom connector in claude.ai): https://api.zeffy.com/mcp (read-only). Zeffy has a free
  public API plus outbound webhooks (Settings > Integrations). No Zeffy sandbox: test purchases need the bank
  account attached first (Nicolas is waiting on that).
- QuickBooks syncs only electronic payouts; cash and e-transfer must be recorded there separately.

## Setup checklist (Nicolas is doing the accounts)
Tools: Firebase CLI (`firebase`, logged in) and Vercel CLI (`vercel`, run `vercel login` once) are installed on
Nicolas's Windows machine. There is no Firebase connector in Claude Code; a Vercel connector is available.
1. `npm install`; create the Firebase project (Firestore + Google sign-in); `firebase use --add` to select it;
   add authorized domains (checkin.dices.ca and the *.vercel.app one).
2. `cp .env.example .env.local` and fill in: Firebase web config, `FIREBASE_SERVICE_ACCOUNT_B64`, and a random
   `ZEFFY_WEBHOOK_TOKEN`. Base64 the key in PowerShell with
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))` (Linux: `base64 -w0 key.json`).
   Delete key.json afterwards; never commit it.
3. `firebase deploy --only firestore`; `npm run seed-admin -- <nicolas's google email>` (reads `.env.local`).
4. Vercel: `vercel link` (or create the project from the GitHub repo), add the same env vars, add the domain
   checkin.dices.ca.
5. In Zeffy (Settings > Integrations) set the webhook to
   `https://checkin.dices.ca/api/zeffy/webhook?token=<ZEFFY_WEBHOOK_TOKEN>`.
6. Admin > Programs: paste the Zeffy campaign id for each program; then test purchases and fix `zeffy.ts` (item 1).

## Suggested next work, in order
1. Get it deployed and signed in; run the Firestore emulator and test `firestore.rules` (staff, lead scoping,
   headcount, check-out-only updates).
2. Test purchases, then fix the Zeffy mapping and add the manual-entry poll if needed.
3. Try it on the actual tablet: offline check-in, large tap targets, program memory.
4. Revenue and break-even per program (inputs: cost per session, revenue from passes) and a visit-void screen.
5. Retention/cleanup of children's records after each season; make it an installable PWA.

## Related material
- Claude Doc "Growing Up Denman: Break-Even and Program Metrics": https://claude.ai/artifact/KwXTcDxdmvaNLSwxGiQAns
  (pricing, break-even method: at about $4.50 per visit, $100/$150/$200 per Friday needs 22/33/44 kids; tier copy;
  thank-you email copy; a "Check-in app: design draft" section that predates the multi-program refactor).

## Conventions
- BC time only through `src/lib/time.ts`. Keep personal data out of headcount programs. Never log or commit
  secrets. Dates are YYYY-MM-DD strings in BC time; timestamps are ISO UTC.
