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
sql/                         Run these five files in order in the Supabase SQL editor
  01_schema.sql              Tables and constraints
  02_security.sql            Row-level security, column privileges, public_workers view, protective trigger
  03_functions.sql           hire_worker, complete_job, rate_job, confirm_cash, confirm_direct, get_pay_target,
                             verify_worker, admin_payouts, mark_payout_sent, admin_fees_owed, settle_fees, admin_stats
  04_storage.sql             Private id-docs bucket and its rules
  05_realtime_admin.sql      Live job updates, and how to make yourself admin
supabase/functions/
  create-order/              Creates the Razorpay order (holds the Razorpay secret)
  razorpay-webhook/          The only thing that marks an online payment paid (checks signature and amount)
tests/                       Automated tests and a local harness to click through the app without Supabase
```

## Deploy

You need: a Supabase account, a Razorpay account, a Google Cloud account (for "Continue with Google"), an email-sending service for login codes (Resend, Brevo or similar; Supabase's built-in email only sends a few per hour), and a static host (Netlify, Vercel or GitHub Pages).

**1. Supabase project.** Create a project in the **Mumbai (ap-south-1)** region. Move to a paid plan before real users (free projects pause when idle and have no daily backups).

**2. Database.** In the SQL editor, run `sql/01_schema.sql` to `sql/05_realtime_admin.sql`, one at a time, in order.

**3. Login (Google and email code).**
- *Email code:* Authentication → Sign In / Providers → Email is on by default. In Authentication → Emails → Templates → **Magic Link**, put `{{ .Token }}` in the body (for example "Your Kaamghor code is {{ .Token }}") so users get a code to type instead of a link. Before real users, set up custom SMTP (Authentication → Emails → SMTP Settings) with a provider like Resend or Brevo.
- *Google:* in Google Cloud Console, set up the OAuth consent screen, then Credentials → Create OAuth client ID → Web application. Authorized redirect URI: `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. Paste the Client ID and Client Secret into Supabase → Authentication → Sign In / Providers → Google.
- *Redirect URLs:* Authentication → URL Configuration → Redirect URLs: add your app's address (and `http://localhost:5174/` for local testing).

Mobile numbers are typed in at sign-up (not verified by SMS) and are shown to the other side only after a hire.

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

**10. Test** with two phones (one household, one worker) through the whole flow, once for each payment method: Razorpay, direct UPI and cash.

**When you change the app later,** change `CACHE` in `web/sw.js` (for example `kaamghor-v2`) so installed phones pick up the new version.

## How the rules are enforced

- Row-level security on every table. The browser can only insert its own rows and edit harmless columns (name, area, skills, UPI ID, availability).
- Hire, complete, rate and confirm-payment only happen through the SQL functions, which check who is calling. A user cannot edit a row to mark a job paid.
- Only the Razorpay webhook marks an online payment paid, after checking the HMAC signature and that the amount matches the job pay.
- A trigger stops workers changing their own verified flag, rating or job count.
- Phone numbers are visible to the other side only after a hire. UPI IDs only to the household of a completed job. ID documents only to admins, through 5-minute signed links.

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

`sql.test.mjs` runs the five SQL files on a real Postgres engine (PGlite) and checks the security rules and the full job flow (15 tests). `edge.test.mjs` checks both Edge Functions, including bad signatures and wrong amounts (6 tests).

To click through the app without a Supabase project:

```bash
node tests/serve.mjs
```

Open http://localhost:5173. Every query runs on an in-browser Postgres loaded with the real SQL files and row-level security. Any email works and the code is always `123456`; "Continue with Google" signs in a test Google user. Paying online simulates Razorpay and the webhook. In the browser console, `__sql("update profiles set role='admin' where full_name='…'")` makes an admin and `__reset()` wipes the data. `node tests/serve.mjs --real` serves `web/` exactly as deployed, on port 5174.

## Decisions taken while building (please confirm)

- **Login is Google or an emailed code**, not phone OTP as in the design doc (changed at the owner's request). Users type their mobile at sign-up; it isn't verified, so a wrong number is possible.
- **The six pilot areas** are Tinsukia Town, Hijuguri, Borguri, Rangagora Road, Bordoloi Nagar and Chandmari. Change them in `valid_area()` in `sql/01_schema.sql` and `AREAS` plus the `area_*` texts in `web/index.html`.
- **Platform fee** is 10%, set in one place: `platform_fee_pct()` in `sql/03_functions.sql`.
- **Unverified workers can apply.** Lists put verified workers first, then the best rated, as the doc says.
- **A worker can only apply to jobs that need one of their skills.** The worker job list shows their own area by default, with a switch to see all areas.
- **Admin screens are in English only.** Household and worker screens are in all three languages.
- **Assamese and Hindi translations** were written without a native speaker. Have one review them (the doc lists this as a known gap).

## Still to do (from the design doc)

Rate limits on login codes and job posting, account deletion tooling, an audit log of admin actions, a data retention job, filling in the terms page, and the other known gaps in section 13 of the design doc.
