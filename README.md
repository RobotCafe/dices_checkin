# DICES check-in

Staff-only check-in/check-out and usage tracking for DICES programs. Zeffy takes payments; this app
reads them (webhook) and records attendance. Next.js + Firebase (Firestore, Google sign-in).
Suggested home: https://checkin.dices.ca

## Programs
Each program (Growing Up Denman, Teen Night, Adult Rec, ...) is a record in Admin > Programs:
- **Tracked**: named people, passes, check-in and check-out.
- **Headcount only**: a tap counter per session, no names stored (food bank, hampers, market coupons).
- Per program: Zeffy campaign id, season dates, pass types (drop-in / punch card / season / pay-what-you-can),
  an optional "free under age" rule, and which Zeffy questions hold the name, birth date and dietary needs.
- A punch card belongs to one program.

## Setup
1. Create a Firebase project; enable Firestore and Google sign-in (Auth).
   Add your domain (checkin.dices.ca, and the *.vercel.app one) to Auth > Settings > Authorized domains.
2. `cp .env.example .env.local` and fill it in (web config, service-account JSON base64, a random webhook token).
3. `npm install`, then `npx firebase deploy --only firestore` (rules + indexes).
4. `npm run seed-admin -- you@example.com` creates the master admin and an example Growing Up Denman program.
5. Deploy to Vercel with the same env vars; add checkin.dices.ca as a domain (a CNAME record at your DNS host).
6. In Zeffy (Settings > Integrations) set the webhook to
   `https://checkin.dices.ca/api/zeffy/webhook?token=<ZEFFY_WEBHOOK_TOKEN>`. One webhook serves every program.
7. In Admin > Programs, paste each program's Zeffy campaign id. Make a test purchase of each rate, then open
   Admin > Payments needing review and the raw payload in Firestore `payments/<id>`, and adjust
   `src/lib/zeffy.ts` field names to match.

## Rules built in
- Pass priority at check-in: season, then punch card, then drop-in, then pay-what-you-can.
- Punch cards cost 1 punch per visit, 0 under the program's free age (Growing Up Denman: under 3).
- Drop-in / pay-what-you-can are single use. Punches left = punches bought minus non-voided visits (works offline).
- BC time is UTC-7 with no DST (`src/lib/time.ts`).
- Staff = verified Google email with a doc in `staff/`. The admin sees everything; invited staff can be limited to
  specific programs (program leads) and then can't read other programs' people or visits.
- Headcount programs store no personal data.

## Not done yet / needs your input
- Verify Zeffy payload field names (step 7). Manual cash/e-transfer entries may not fire the webhook: add a
  scheduled poll of the Zeffy API once confirmed.
- Revenue and break-even reports (usage report and CSV export exist), voiding visits, retention/cleanup policy.
- Firestore rules have not been run against the emulator.

`npm test` runs the logic tests; `npm run typecheck` checks types.
