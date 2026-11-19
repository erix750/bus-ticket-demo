# Wayline Bus Booking

A browser-based bus schedule and ticket-booking prototype backed by Supabase.

## Features

- Passengers can search published bus schedules and reserve seats.
- Each saved booking receives a reference and a clear reservation/payment status. Wayline does not yet collect or verify payments, so new bookings remain saved and unpaid.
- New unpaid web and USSD reservations hold seats for 15 minutes before automatic cancellation and seat release. A phone number can hold at most 3 active bookings and 20 seats across the system.
- Passengers provide a name and phone number at checkout; contact details are available to the relevant bus company.
- Passengers search and book without creating an account.
- Passengers can retrieve a booking on another device using its reference and an SMS-verified phone number.
- Bus companies have a dashboard to add, edit, hide, cancel, and remove schedules, manage seat capacity, review bookings, and upload or independently update a company profile picture (PNG, JPG, or WebP up to 10 MB). Images are resized for display. Schedule edits preserve existing reservations and their original itinerary details; cancelling a trip cancels its reservations and releases seats. Companies must contact affected passengers directly.
- Company schedule lists include their own past and full schedules; booking records are restricted to schedules owned by the signed-in company.
- Schedule fares are calculated from the route distance and selected RURA fare area.
- Operators can list intermediate stops and estimated journey duration; online and USSD route labels share the same city-name formatting.
- Operators must confirm they checked estimated city-center road distance against the actual bus route before saving a fare.
- Company dashboards can filter schedules and bookings, group bookings by upcoming/completed/expired/cancelled trip status, and download passenger manifests for their own schedules.
- Passengers review company, bus, route, stops, date, departure, estimated duration, seats and total before saving, and can copy the booking reference.
- Search results and company schedules show an estimated arrival time when the operator has supplied a journey duration.
- A searchable Help Center in the footer suggests answers about booking, payment, cancellations, and contact options; all page footers include legal links, a Made in Rwanda identity, and a current-year copyright.
- The landing page and booking lookup footer provide English, Kinyarwanda, and French for shared navigation and the main booking interface. Legal policy documents remain in English.
- Privacy, terms, and cancellation policies explain passenger information use, booking terms, and how to request cancellation.
- Footer links show Wayline's Rwanda service area and the current copyright year.
- Passengers can select MTN Mobile Money or Airtel Money as their intended payment method; Visa and Mastercard are listed as coming soon.
- The repository includes an Africa's Talking USSD callback for basic-phone reservations. USSD is not live until the provider provisions the shortcode and the service is deployed and configured.
- Seat reservations update shared availability in Supabase. Passengers request cancellations from the relevant bus company. Wayline support: muvunyieric25@gmail.com and WhatsApp +250 798 230 630; support hours are not published.
- Planned Eastern, Southern, Northern, and Western Province corridors are listed separately from live route suggestions. Search suggestions are generated only from active, upcoming schedules with seats available.
- Bus availability is refreshed through Supabase Realtime, with a 30-second fallback refresh.
- Company records and schedules are protected by Supabase authentication and row-level ownership policies. Schedule edits keep reservations attached, and seat-capacity edits cannot reduce capacity below the number already reserved.
- Payment statuses and private payment/fee-ledger tables are prepared for future server-side integrations; no payment provider or collection flow is enabled.
- Public pages apply a Content Security Policy, and the Supabase JavaScript client is pinned to version 2.119.0 with Subresource Integrity.
- Operators can calculate estimated road distances from route cities and review or edit the result before the RWF fare is calculated using the selected RURA area tariff.
- Full buses and trips whose departure time has passed are automatically excluded from public search while company schedules and booking records are retained.
- Operators can hide and restore schedules without deleting the bus or its booking history.
- The website can be installed from a supported mobile browser on Android and iPhone.
- The header menu switches between Home, passenger booking, Company Portal, About, and Contact. The Home hero includes route, date, and passenger search; language, theme, and menu controls share one row, and the app-install action is inside the menu.
- Passengers search and book without an account. Company Portal provides separate sign-in and registration actions; applications require administrator approval before schedules or company bookings are accessible.
- New company accounts must submit company details and private supporting documents, then wait for administrator verification. Only approved companies can manage schedules or view their bookings.
- The protected [`admin.html`](./admin.html) portal lets provisioned Wayline administrators review applications, approve or reject companies, request changes, suspend or reactivate access, and inspect recent company activity.
- Company application documents use a private Supabase Storage bucket. RLS and database-side approval checks restrict applications, schedules, company profiles, bookings, activity records, and document access.

## Supabase setup

1. Create a Supabase project.
2. Apply the checked-in baseline [`supabase/schema.sql`](./supabase/schema.sql) to a new, empty Supabase project. It defines the core `companies`, `buses`, and `bookings` tables and booking RPCs; it also defines the `ussd_sessions` table and `ussd_book_bus` RPC used by the USSD service. The baseline contains compatibility updates and `DROP` statements for legacy database objects, so do not run it against a populated or production database, or rerun it after migrations, without first reviewing its effects against that database.
3. Run [`supabase/migrations/20261116000000_company_approval.sql`](./supabase/migrations/20261116000000_company_approval.sql). This migration treats company profiles already present as approved for continuity; new company accounts start pending. It creates the application workflow, private document bucket, admin controls, activity log, and approval-aware RLS/backend checks.
4. Run [`supabase/migrations/20261117000000_route_segment_fares.sql`](./supabase/migrations/20261117000000_route_segment_fares.sql) to install the route-segment fare support used by the current website.
5. Run [`supabase/migrations/20261119000000_company_auth_hardening.sql`](./supabase/migrations/20261119000000_company_auth_hardening.sql). It requires a confirmed, structurally valid company email for company management, applies strict email checks to application submissions, and requires administrator sessions to use verified TOTP MFA at the database boundary.
6. Run [`supabase/migrations/20261119010000_booking_holds_and_payment_model.sql`](./supabase/migrations/20261119010000_booking_holds_and_payment_model.sql). It adds 15-minute holds for new unpaid bookings, a database-enforced limit of 3 active bookings and 20 held seats per phone number, a minute-by-minute `pg_cron` expiry job, and private payment/fee-ledger tables. Legacy bookings without an expiry remain untouched. This prepares payment data only; it does not select a provider or process payments.
7. In `config.js`, configure the Supabase project URL, browser-safe publishable (anon) key, and public `siteUrl`. Never put a service-role key in client-side code.
8. Serve the repository as a static website (for example, with GitHub Pages). In Supabase Authentication URL Configuration, set the Site URL to `https://erix750.github.io/bus-ticket-demo/` (the project URL, not `https://erix750.github.io/`) and add that exact URL to the Redirect URLs allowlist. Company email-confirmation and password-reset links return to `siteUrl` in `config.js`. If the link expires or is already used, request a new email and open the newest link once.
9. In Supabase Auth, require email confirmation (do not auto-confirm email addresses), set the minimum password length to 12 with lowercase, uppercase, numeric, and symbol requirements, and enable leaked-password protection when available. Configure Auth rate limits for password sign-in, signup, and recovery. If enabling CAPTCHA, integrate a supported challenge and pass its token with those requests before turning it on. Set suitable session lifetime, refresh-token rotation, and inactivity limits in Supabase Auth. These are project-level controls and cannot be enforced by static frontend code. The company UI also validates new and reset passwords; Supabase Auth remains the password hash and verification authority.
10. A company representative creates a company login, confirms their email inbox, signs in, completes the company application, and uploads its business registration and applicable transport licence. The application remains pending or under review until a Wayline administrator approves it. Rejected applicants can correct information and resubmit; suspended companies cannot manage schedules.
11. Provision administrators only through a controlled Supabase project-owner process. Create and confirm the administrator's Auth account through the Supabase Dashboard (not a public registration page), then insert that account into `wayline_admins` from the SQL Editor:

   ```sql
   INSERT INTO public.wayline_admins (user_id)
   SELECT id
   FROM auth.users
   WHERE lower(email) = lower('admin@example.com')
     AND email_confirmed_at IS NOT NULL;
   ```

   Replace the example address with the intended administrator account. Verify that exactly one row was inserted. The account can then sign in at `admin.html`; dashboard data and actions are checked again by Supabase policies and RPCs.
12. Sign in to `admin.html` with the provisioned account and enroll a TOTP authenticator when prompted. The administrator portal and its privileged database operations remain unavailable until the signed-in session has AAL2 assurance. Keep the authenticator recovery codes private.
13. In Supabase Auth, enable phone sign-in and configure Twilio as the SMS provider. Keep the Twilio Account SID, Auth Token, and Messaging Service SID only in Supabase's private Auth provider settings. Test code delivery to both MTN and Airtel numbers before launch; SMS delivery and sender requirements depend on the provider and destination network.
14. Configure Supabase Auth rate limits and CAPTCHA protection for SMS OTP requests before public use. Review Supabase Auth logs for successful and failed authentication and password-recovery events; the protected Wayline activity log records company applications, reviews, status changes, profile changes, and schedule changes. No SMS, payment, or service-role credentials belong in this repository or browser code.

Company login creation is open, but company-management access is not granted until an administrator approves the application. Existing company profiles in the database are grandfathered as approved by the migration; review those records before applying it if they have not already been legitimately verified. Existing browser-only demo records are not automatically migrated to Supabase.

Passenger records are not listed publicly. The separate [`booking.html`](./booking.html) page requires a booking reference and SMS verification of the phone number used at booking before showing a record on another device. Passenger phone sign-in is passwordless and does not provide a separate passenger profile.

## Africa's Talking USSD service

The [`ussd-service/`](./ussd-service/) Node.js 22.9+ application accepts Africa's Talking callbacks for passengers using basic phones. It provides English, Kinyarwanda, French, and Kiswahili menus, lists available approved-company trips from Supabase, and records bookings through an idempotent server-side RPC. USSD bookings are **unpaid**: the selected MTN or Airtel method is only recorded as an intention.

1. For a new, empty Supabase project, apply [`supabase/schema.sql`](./supabase/schema.sql), then all four migrations in timestamp order: [`supabase/migrations/20261116000000_company_approval.sql`](./supabase/migrations/20261116000000_company_approval.sql), [`supabase/migrations/20261117000000_route_segment_fares.sql`](./supabase/migrations/20261117000000_route_segment_fares.sql), [`supabase/migrations/20261119000000_company_auth_hardening.sql`](./supabase/migrations/20261119000000_company_auth_hardening.sql), and [`supabase/migrations/20261119010000_booking_holds_and_payment_model.sql`](./supabase/migrations/20261119010000_booking_holds_and_payment_model.sql). The baseline already defines private, expiring USSD session storage and the service-role-only `ussd_book_bus` RPC; this checkout has no separate `20261116010000_ussd_booking.sql` migration. For an existing database, inspect its current schema and migration history first. Do not apply the baseline to production or a populated database without reviewing its compatibility updates and `DROP` statements.
2. Deploy `ussd-service/` to a Node.js 22.9+ host behind HTTPS. Run `npm test`. For local configuration, copy `.env.example` to `.env`; `npm start` loads that ignored file. In production, set the same values through the host's secret/settings manager. `GET /health` checks service availability without exposing configuration.
3. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `USSD_CALLBACK_TOKEN`, and `USSD_SERVICE_CODE` as host secrets/settings. Also set `LOCAL_USSD_DEMO=false` and `USSD_SIMULATOR_ENABLED=false` to start the provider callback service instead of the local sample simulator. Generate a URL-safe callback token of at least 32 characters (for example, `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`). Never place the service-role key or callback token in the public website or commit them.
4. First verify the callback with the Africa's Talking sandbox. After a shortcode is provisioned for your account, set `USSD_SERVICE_CODE` to that exact code and configure the provider's POST callback as `https://<your-host>/ussd?token=<USSD_CALLBACK_TOKEN>`. The service rejects unrecognized service codes and callbacks without the token. Redact the query token from proxy and host access logs.

The callback accepts Africa's Talking `application/x-www-form-urlencoded` fields (`sessionId`, `serviceCode`, `phoneNumber`, and `text`) and returns `CON` or `END` plain-text responses. Menu state is stored in Supabase for ten minutes so sessions can continue across service instances, and expired state is periodically removed. Duplicate booking callbacks use the session ID as an idempotency key. Configure Supabase database permissions, HTTPS, provider sandbox credentials, and production monitoring before launch. The service does not collect card details or claim payment success. The website continues to mark the shortcode as not active until deployment and provider provisioning are complete.

### RURA fares and database updates

Operators can enter the one-way route distance themselves or calculate an estimated city-center driving distance from the departure and destination cities. The distance lookup uses the Photon geocoder and OSRM public demo routing service, requires an internet connection, and can be unavailable; operators should check the estimate against the actual bus route and can edit it before saving. Map data is from [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Select the applicable fare area and the app calculates and stores the fare using the RURA public transport tariff document:

- City of Kigali: RWF 59.28 per passenger per kilometre.
- Intercity/provincial: RWF 41.58 per passenger per kilometre.

The fare is rounded to the nearest RWF. Existing schedules without a recorded distance remain in the database but are not listed for passengers until a new schedule with a distance is added. Companies can edit schedule details while retaining each reservation's original itinerary details. Seat capacity cannot be reduced below the number of seats already reserved. Cancelling a trip cancels all of its active reservations and releases their seats; passenger notifications and any refunds must be handled directly by the company.

Reference: [RURA applicable pump prices and public transport tariffs](https://www.rura.rw/fileadmin/user_upload/RURA/Documents/Tariffs/Applicaple_pump_prices_and_Public_Transport_tariffs.pdf).

## Important limitations

- This is a prototype, not a production-ready ticketing or payment system.
- The public Photon and OSRM demo services have no availability guarantee; use a suitable hosted or self-hosted routing service before relying on automatic distance estimates in production.
- Selecting MTN Mobile Money or Airtel Money only records the passenger's intended method. No payment is initiated or verified; bookings remain unpaid. Visa and Mastercard payments are not available.
- Phone-based booking limits do not stop a caller from using another phone number, and no per-IP throttle, SMS booking challenge, or CAPTCHA is included. Configure trusted backend rate limits before relying on public booking traffic.
- Cross-device booking retrieval requires phone Auth and an SMS provider to be configured in Supabase; it is unavailable until OTP delivery is set up and tested.
- USSD booking is not live until the required migrations are applied to a compatible Wayline database, the callback is deployed, and Africa's Talking provisions and configures the shortcode.
- Keep payment-provider secret keys off the public website; live payment processing requires a secure server-side integration.
- Use a real payment-provider integration and complete operational, security, and partner checks before accepting real bookings.
- Apply and verify the company approval, authentication-hardening, and booking-hold migrations; require email verification; configure Auth password/rate/session protections; and provision at least one trusted administrator with TOTP MFA before accepting company applications. Supabase Auth logs provide authentication-event monitoring; the protected application activity log records company applications, status reviews, profile changes, and schedule changes.
