# DICES check-in

Staff-only check-in/check-out and usage tracking for DICES programs. Zeffy takes payments; this app
reads them (webhook) and records attendance. Next.js + Firebase (Firestore in Montréal, Google sign-in), hosted
on Vercel.

**Live:** https://dices-checkin.vercel.app (planned: https://checkin.dices.ca)

For the full picture (decisions, deployment details, open questions, next steps) read [HANDOFF.md](HANDOFF.md).
What changed and when: [CHANGELOG.md](CHANGELOG.md).

## Programs
Each program (Growing Up Denman, Teen Night, Adult Rec, ...) is a record in Admin > Programs:
- **Tracked**: named people, passes, check-in and check-out.
- **Headcount only**: a tap counter per session, no names stored (food bank, hampers, market coupons).
- Per program: Zeffy campaign id, season dates, pass types (drop-in / punch card / season / pay-what-you-can),
  an optional "free under age" rule, and which Zeffy questions hold the name, birth date and dietary needs.
- A punch card belongs to one program.

## Development
```
npm install
npm test            # unit tests
npm run test:rules  # security rules + Zeffy webhook on the Firestore emulator (needs Java)
npm run typecheck
npm run dev         # needs .env.local (see .env.example)
```
Pushing to `main` deploys to production on Vercel. Test against the emulator, never the live database.

## Setting up from scratch
(Already done for DICES; see HANDOFF.md > Deployment.)
1. Create a Firebase project. **Create the Firestore database in the console first** and pick the location
   (DICES uses northamerica-northeast1); `firebase deploy` before that creates one in the US. Enable Google
   sign-in, and add your domains under Authentication > Settings > Authorized domains.
2. `cp .env.example .env.local` and fill it in: Firebase web config, service account JSON in base64, a random
   webhook token, and Zeffy's webhook signing secret and API key.
3. `firebase deploy --only firestore` (rules and indexes), then `npm run seed-admin -- you@example.com` to create
   the master admin and an example Growing Up Denman program.
4. Create the Vercel project from the GitHub repo and add the same environment variables. Add your domain
   (a CNAME at your DNS host).
5. In Zeffy (Settings > Integrations > Webhook) set
   `https://YOUR-DOMAIN/api/zeffy/webhook?token=<ZEFFY_WEBHOOK_TOKEN>` for payment.completed, payment.updated and
   payment.deleted. One webhook serves every program.
6. In Admin > Programs, paste each program's Zeffy campaign id.

## Rules built in
- Pass priority at check-in: season, then punch card, then drop-in, then pay-what-you-can.
- Punch cards cost 1 punch per visit, 0 under the program's free age (Growing Up Denman: under 3).
- Drop-in / pay-what-you-can are single use. Punches left = punches bought minus non-voided visits (works offline).
- BC time is UTC-7 with no DST (`src/lib/time.ts`).
- Staff = verified Google email with a doc in `staff/`. The admin sees everything; invited staff can be limited to
  specific programs (program leads) and then can't read other programs' people or visits.
- Headcount programs store no personal data.
- Zeffy messages must carry a valid `Zeffy-Signature`; refunds and disputes are flagged for review.

## Not done yet
- First real Zeffy test purchases (waiting on the bank account being attached in Zeffy).
- Whether manual cash/e-transfer entries in Zeffy trigger the webhook; if not, a scheduled check of Zeffy's API.
- Revenue and break-even reports (usage report and CSV export exist), voiding visits, retention/cleanup policy.
- Testing on the actual tablet.
