# Kaamghor

Connects daily-wage workers with households in Tinsukia, Assam. Built to the Kaamghor Design Document v1.0 (October 2026).

## What is here

```
web/                         The app (upload this folder to any static host)
  index.html                 The whole UI, styles and English / Assamese / Hindi text
  api.js                     Supabase settings and every call the app makes
  sw.js                      Service worker: caches the app shell for fast and offline start
  manifest.webmanifest       Makes it installable as a PWA
  logo.svg                   The Kaamghor mark (vector). Also embedded in index.html for the header and login screen
  icon.svg, icon-192.png, icon-512.png   App icon: the mark in white on graphite. Rebuild PNGs with: node tests/make-icons.mjs
  terms.html                 Terms and privacy page (fill in the [FILL IN] parts)
sql/                         Run every file in name order in the Supabase SQL editor
  01_schema.sql              Tables and constraints
  02_security.sql            Row-level security, column privileges, public_workers view, protective trigger
  03_functions.sql           Server-side functions (hire, complete, payments, admin)
  04_storage.sql             Private id-docs bucket and its rules
  05_realtime_admin.sql      Live job updates, and how to make yourself admin
  06_job_types.sql           Caretaker, Healthcare, Others ("Others" needs a description)
  07_days.sql                Work booked in days instead of hours
  08_rates.sql               Usual and minimum daily rates; pay = rate x days, worked out by the database
  09_multi_worker.sql        Several people per job; one assignment (status, payment) per person
  10_handshake.sql           Two-way arrival and completion confirmation, 24-hour auto-confirm, disputes
  11_ratings.sql             Two-way ratings with tags and comments, public profiles and reviews
  12_verified_phone.sql      Every account has an SMS-verified mobile; the profile phone comes from Auth
  13_location.sql            Exact pin for hired people only; a ~1 km point for everyone else
  14_thikadar.sql            Verified Thikadars apply with a crew; the crew fills places and is paid as one
  15_half_days.sql           Jobs can be booked in half days (0.5, 1, 1.5 ...); pay rounds to whole rupees
supabase/functions/
  create-order/              Creates the Razorpay order (holds the Razorpay secret)
  razorpay-webhook/          The only thing that marks an online payment paid (checks signature and amount)
tests/                       Automated tests and a local harness to click through the app without Supabase
```

## Deploy

You need: a Supabase account, a Razorpay account, a Google Cloud account (for "Continue with Google"), an email-sending service for login codes (Resend, Brevo or similar; Supabase's built-in email only sends a few per hour), and a static host (Netlify, Vercel or GitHub Pages).

**1. Supabase project.** Create a project in the **Mumbai (ap-south-1)** region. Move to a paid plan before real users (free projects pause when idle and have no daily backups).

**2. Database.** In the SQL editor, run every file in `sql/` one at a time, in name order (`01` to `15`). Each later file upgrades the tables from the earlier ones and keeps existing data, so an existing project only runs the files it hasn't run yet.

Turn on **pg_cron** first (Database → Extensions → pg_cron) so `10_handshake.sql` can schedule the 24-hour auto-confirm. Without it, overdue jobs are still confirmed whenever someone opens their jobs.

**3. Login (Google, email code and mobile number).**
- *Mobile (required for everyone):* Authentication → Sign In / Providers → Phone: turn it on and enter an SMS provider (Twilio, MSG91, …). Sending SMS in India needs DLT registration with the provider. Until that's ready, add test numbers with fixed codes on the same page (for example `919800000001=123456`). People can sign in with their number, and Google/email users are asked to verify one once.
- *Email code:* Authentication → Sign In / Providers → Email is on by default. In Authentication → Emails → Templates → **Magic Link**, put `{{ .Token }}` in the body (for example "Your Kaamghor code is {{ .Token }}") so users get a code to type instead of a link. Before real users, set up custom SMTP (Authentication → Emails → SMTP Settings) with a provider like Resend or Brevo.
- *Google:* in Google Cloud Console, set up the OAuth consent screen, then Credentials → Create OAuth client ID → Web application. Authorized redirect URI: `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. Paste the Client ID and Client Secret into Supabase → Authentication → Sign In / Providers → Google.
- *Redirect URLs:* Authentication → URL Configuration → Redirect URLs: add your app's address (and `http://localhost:5174/` for local testing).

Mobile numbers are verified by SMS code and always come from Supabase Auth; they are shown to the other side only after a hire.

**4. App settings.** Project Settings → API: copy the Project URL and the `anon` public key into `web/api.js`. The anon key is meant to be public; the database rules protect the data.

**5. Edge Functions.** Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then from this folder:

```bash
supabase login
```
```bash
supabase link --project-ref YOUR-PROJECT-REF
```
```bash
supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx RAZORPAY_WEBHOOK_SECRET=choose-a-long-random-string
```
```bash
supabase functions deploy create-order
```
```bash
supabase functions deploy razorpay-webhook --no-verify-jwt
```

**6. Razorpay.** Start in **Test mode**. Settings → Webhooks → Add: URL `https://YOUR-PROJECT-REF.supabase.co/functions/v1/razorpay-webhook`, secret = the `RAZORPAY_WEBHOOK_SECRET` above, events `payment.captured` and `order.paid`. Make sure payments are set to auto-capture (Settings → Payment capture). Switch to live keys only after testing.

**7. Host the app.** Upload the `web/` folder (Netlify drop, Vercel, or GitHub Pages). It must be served over HTTPS.

**8. Site URL.** In Supabase, Authentication → URL Configuration: set Site URL to your app's address.

**9. Make yourself admin.** Sign in once in the app and finish sign-up, then in the SQL editor:

```sql
update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.com');
```

**Upgrading an existing project:** run the new SQL files in order, redeploy `create-order` (it now takes one person's `payment_id`), and deploy the app. Everyone will be asked to verify their mobile once.

**10. Test** with two phones (one household, one worker) through the whole flow, once for each payment method: Razorpay, direct UPI and cash.

**When you change the app later,** change `CACHE` in `web/sw.js` (for example `kaamghor-v2`) so installed phones pick up the new version.

## How the rules are enforced

- Row-level security on every table. The browser can only insert its own rows and edit harmless columns (name, area, skills, UPI ID, availability).
- Hire, complete, rate and confirm-payment only happen through the SQL functions, which check who is calling. A user cannot edit a row to mark a job paid.
- Only the Razorpay webhook marks an online payment paid, after checking the HMAC signature and that the amount matches the job pay.
- A trigger stops workers changing their own verified flag, rating or job count.
- Phone numbers are visible to the other side only after a hire, and are always SMS-verified. UPI IDs only to the household of a completed job. ID documents only to admins, through 5-minute signed links.
- The exact work location is visible only to the household and the people it hired; others see a point rounded to about 1 km.
- Pay is worked out by the database from the daily rate; a job's progress (arrival, completion) needs both sides; ratings are written only through a function that checks who worked with whom.

## Running the tests

```bash
cd tests && npm install
```
```bash
node sql.test.mjs
```
```bash
node edge.test.mjs
```

`sql.test.mjs` runs every SQL file on a real Postgres engine (PGlite) and checks the security rules and the full job flow (26 tests). `edge.test.mjs` checks both Edge Functions, including bad signatures and wrong amounts (6 tests).

To click through the app without a Supabase project:

```bash
node tests/serve.mjs
```

Open http://localhost:5173. Every query runs on an in-browser Postgres loaded with the real SQL files and row-level security. Any email or mobile number works and the code is always `123456`; "Continue with Google" signs in a test Google user. Paying online simulates Razorpay and the webhook. In the browser console, `__sql("update profiles set role='admin' where full_name='…'")` makes an admin and `__reset()` wipes the data. `node tests/serve.mjs --real` serves `web/` exactly as deployed, on port 5174.

## Decisions taken while building (please confirm)

- **Login:** Google, an emailed code, or a mobile number by SMS. Every account must verify a mobile once.
- **Rates** in `08_rates.sql` are placeholders for Assam daily wages; set real ones in the admin Overview.
- **Maps** use OpenStreetMap tiles shown in monochrome (inverted in dark mode) and OpenStreetMap's Nominatim for "Near …" addresses, both free for light use. At real scale, set `MAP_TILES` to a styled provider (e.g. Stadia, MapTiler) and use a paid geocoder.
- **Thikadars:** a verified worker can turn on "I lead a crew", apply to multi-person jobs with a crew, name the crew, do the handshake for everyone and receive the whole crew's pay to share. Crew members don't need accounts. Aggregator/agency accounts are not built.
- **ID verification through DigiLocker** is a possible later step (DigiLocker's partner API can confirm Aadhaar/driving licence without storing the document). Not built.
- **The six pilot areas** are Tinsukia Town, Hijuguri, Borguri, Rangagora Road, Bordoloi Nagar and Chandmari. Change them in `valid_area()` in `sql/01_schema.sql` and `AREAS` plus the `area_*` texts in `web/index.html`.
- **Platform fee** is 10%, set in one place: `platform_fee_pct()` in `sql/03_functions.sql`.
- **Unverified workers can apply.** Lists put verified workers first, then the best rated, as the doc says.
- **A worker can only apply to jobs that need one of their skills.** The worker job list shows their own area by default, with a switch to see all areas.
- **Admin screens are in English only.** Household and worker screens are in all three languages.
- **Assamese and Hindi translations** were written without a native speaker. Have one review them (the doc lists this as a known gap).

## Still to do (from the design doc)

Rate limits on login codes and job posting, account deletion tooling, an audit log of admin actions, a data retention job, filling in the terms page, and the other known gaps in section 13 of the design doc.
