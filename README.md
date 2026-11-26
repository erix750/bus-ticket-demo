# Wayline

Wayline is a static bus-booking site for finding Rwanda bus trips and reserving seats. Supabase stores schedules and bookings; reservations remain unpaid until a bus company confirms payment.

## Run locally

Serve the repository root over HTTP (no frontend build step is required):

```sh
python -m http.server 8000
```

Set the Supabase project URL, public anon key, and local site URL in `config.js`, then open `http://localhost:8000`. Never put a Supabase service-role key in the website.

## Supabase setup

The migrations expect the Wayline base schema, including the companies, buses, bookings, and booking RPCs. Ensure a compatible base schema is installed first, then apply every SQL migration in `supabase/migrations/` in timestamp order.

Set the site's URL in Supabase Auth's Site URL and Redirect URLs. For the hosted site, use `https://erix750.github.io/bus-ticket-demo/`.

### Company verification and security

Apply `supabase/migrations/20261126000000_company_licensing_security.sql` after the existing migrations. It adds structured RDB/TIN/RURA licence data, private representative-ID documents, vehicle plate/insurance/inspection fields, manual reviewer checks, staff roles, and passenger company reports. The database refuses company schedule publication and bookings without a current approved licence, all four saved checks, and vehicle cover through the trip date. Existing approvals without the new evidence are intentionally unverified until reviewed.

Company owners and managers must complete Supabase Auth TOTP MFA before changing company details, schedules, staff access, or licences. The Company Portal prompts users to enroll or verify an authenticator. Company sessions are signed out after 15 minutes without activity in the open site. Cashiers can view company bookings but cannot edit company or schedule information. To add staff, first invite their confirmed account in Supabase Auth; the owner then assigns Manager or Cashier from the Company Portal.

In Supabase Dashboard, keep email confirmation enabled, configure Auth rate limits (and CAPTCHA if available) for password sign-in/OTP, and set the Auth session inactivity timeout to 15 minutes where the project plan exposes that setting. The browser idle timer complements these server-side controls; it does not replace them. The migration keeps `company-documents` private with a 10 MB per-file limit and PDF/JPEG/PNG/WebP MIME allowlist. The website continues to use only the public anon key from `config.js`; never put a service-role key in the site.

Wayline admins must use an MFA-protected account. Check the RDB registration, TIN, RURA licence, and document match manually in the admin portal, save the checklist, and only then approve. Documents open from the portal through 60-second signed URLs. Passengers can report a company from a verified booking; reports are private to the admin review portal.

## SMS booking confirmations

The Edge Function in [`supabase/functions/send-booking-sms/`](./supabase/functions/send-booking-sms/) texts the passenger when a booking is created. Apply the `20261123000000_booking_sms_confirmation.sql` migration, then deploy and configure the function:

```sh
supabase functions deploy send-booking-sms --no-verify-jwt --project-ref <project-ref>
supabase secrets set AT_USERNAME=<africastalking-username> AT_API_KEY=<api-key> WEBHOOK_SECRET=<long-random-string> SITE_URL=https://erix750.github.io/bus-ticket-demo/ --project-ref <project-ref>
```

Optionally set `AT_SENDER_ID` once Africa's Talking approves a sender name. Using the username `sandbox` sends to the Africa's Talking sandbox only. In the Supabase dashboard, create a Database Webhook on `public.bookings` for INSERT that calls the function and sends the header `x-webhook-secret` with the same secret. Keep all keys in Supabase secrets, never in the website.

## USSD service

The Africa's Talking callback is in [`ussd-service/`](./ussd-service/) and requires Node.js 22.9 or newer. For local use, copy `.env.example` to `.env` (it enables sample-data demo mode with `LOCAL_USSD_DEMO=true`; leave that unset on the live host), set the service's Supabase URL, service-role key, callback token, and service code, then run:

```sh
cd ussd-service
npm start
```

Keep the service-role key and callback token in private environment settings. Run `npm test` from `ussd-service/`; run the root utility tests with `npm run test` from the repository root.

## Deploy

Deploy the static site from the repository root with GitHub Pages. Set `siteUrl` in `config.js` and configure the same URL in Supabase Auth redirects. Deploy `ussd-service/` separately to a Node.js host with HTTPS, configure its secrets, and point the Africa's Talking POST callback to `/ussd?token=<USSD_CALLBACK_TOKEN>`. USSD booking is unavailable until a shortcode is provisioned and configured.

See [docs/FEATURES.md](./docs/FEATURES.md) for the feature overview.
