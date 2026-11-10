# Wayline Bus Booking

A browser-based bus schedule and ticket-booking prototype backed by Supabase.

## Features

- Passengers can search published bus schedules and reserve seats.
- Each saved booking receives a reference and a clear reservation/payment status. Wayline does not yet collect or verify payments, so new bookings remain saved and unpaid.
- Passengers provide a name and phone number at checkout; contact details are available to the relevant bus company.
- Passengers search and book without creating an account.
- Passengers can retrieve a booking on another device using its reference and an SMS-verified phone number.
- Bus companies have a dashboard to add, edit, hide, cancel, and remove schedules, manage seat capacity, review bookings, and upload a company logo. Edits preserve existing reservations and their original itinerary details; cancelling a trip cancels its reservations and releases seats. Companies must contact affected passengers directly.
- Company schedule lists include their own past and full schedules; booking records are restricted to schedules owned by the signed-in company.
- Schedule fares are calculated from the route distance and selected RURA fare area.
- Operators can list intermediate stops and estimated journey duration; online and USSD route labels share the same city-name formatting.
- Operators must confirm they checked estimated city-center road distance against the actual bus route before saving a fare.
- Company dashboards can filter schedules and bookings, group bookings by upcoming/completed/cancelled trip status, and download passenger manifests for their own schedules.
- Passengers review company, bus, route, stops, date, departure, estimated duration, seats and total before saving, and can copy the booking reference.
- Search results and company schedules show an estimated arrival time when the operator has supplied a journey duration.
- A searchable Help Center in the footer suggests answers about booking, payment, cancellations, and contact options; all page footers include legal links, a Made in Rwanda identity, and a current-year copyright.
- Privacy, terms, and cancellation policies explain passenger information use, booking terms, and how to request cancellation.
- Footer links show Wayline's Rwanda service area and the current copyright year.
- Passengers can select MTN Mobile Money or Airtel Money as their intended payment method; Visa and Mastercard are listed as coming soon.
- Passengers can book online now; USSD booking by dialing `*200#` is shown as coming soon until Africa's Talking provisions the code and the service is deployed.
- Seat reservations update shared availability in Supabase. Passengers request cancellations from the relevant bus company. Official Wayline support contacts are not yet published.
- Bus availability is refreshed through Supabase Realtime, with a 30-second fallback refresh.
- Company records and schedules are protected by Supabase authentication and row-level ownership policies. Schedule edits keep reservations attached, and seat-capacity edits cannot reduce capacity below the number already reserved.
- Operators can calculate estimated road distances from route cities and review or edit the result before the RWF fare is calculated using the selected RURA area tariff.
- Full buses and trips whose departure time has passed are automatically excluded from public search while company schedules and booking records are retained.
- Operators can hide and restore schedules without deleting the bus or its booking history.
- The website can be installed from a supported mobile browser on Android and iPhone.
- Passengers see trip search first; company account sign-in and registration open from the footer.

## Supabase setup

1. Create a Supabase project.
2. Open the SQL Editor and run [`supabase/schema.sql`](./supabase/schema.sql).
3. In `config.js`, configure the Supabase project URL, browser-safe publishable (anon) key, and public `siteUrl`. Never put a service-role key in client-side code.
4. Serve the repository as a static website (for example, with GitHub Pages). In Supabase Authentication URL Configuration, set the Site URL to `https://erix750.github.io/bus-ticket-demo/` (the project URL, not `https://erix750.github.io/`) and add that exact URL to the Redirect URLs allowlist. Company email-confirmation and password-reset links return to `siteUrl` in `config.js`. If the link expires or is already used, request a new email and open the newest link once.
5. In Supabase Auth settings, require email confirmations. Create a company account in the app and confirm the email before signing in and publishing schedules. If the address is mistyped or the user cannot access that inbox, they cannot complete confirmation or activate the account.
6. Re-run the current `supabase/schema.sql` when updating an existing project. It adds route stop and estimated duration fields, normalizes Rwanda phone numbers, adds the verified passenger booking lookup RPC, limits booking access to phone-verified passengers or the relevant company dashboard, automatically hides full/departed trips from public search, and includes the schedule-edit safeguards.
7. In Supabase Auth, enable phone sign-in and configure Twilio as the SMS provider. Keep the Twilio Account SID, Auth Token, and Messaging Service SID only in Supabase's private Auth provider settings. Test code delivery to both MTN and Airtel numbers before launch; SMS delivery and sender requirements depend on the provider and destination network.
8. Configure Supabase Auth rate limits and CAPTCHA protection for SMS OTP requests before public use. No SMS or payment credentials belong in this repository or browser code.

Company sign-up is open; schedules can be published as soon as the account is ready. Existing browser-only demo records are not automatically migrated to Supabase.

Passenger records are not listed publicly. The separate [`booking.html`](./booking.html) page requires a booking reference and SMS verification of the phone number used at booking before showing a record on another device. Passenger phone sign-in is passwordless and does not provide a separate passenger profile.

## Africa's Talking USSD service

The separate [`ussd-service/`](./ussd-service/) Node.js application provides an Africa's Talking callback for passengers using basic phones. It offers English, Kinyarwanda, French, and Swahili menus; lets passengers choose their departure, destination, travel date, and bus company; searches matching future trips and seats in Supabase; and creates bookings through a server-side, idempotent database function. USSD bookings are **unpaid**: selecting MTN or Airtel records the intended method but does not start a payment.

1. Apply the current [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL Editor. It creates private USSD session storage and the service-role-only `ussd_book_bus` function.
2. Deploy `ussd-service/` on a Node.js 20+ HTTPS host and install dependencies with `npm install`. Set `LOCAL_USSD_DEMO=false` and `USSD_SIMULATOR_ENABLED=false` in the host settings so it listens for provider callbacks instead of the local-only simulator.
3. Copy `.env.example` to `.env`. Set the Supabase project URL, **service-role key**, and a URL-safe random callback token of at least 32 characters (for example, generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`). `USSD_SERVICE_CODE` defaults to `*200#` and must match the code assigned by Africa's Talking. Keep `.env` and all server credentials private; never add them to the website's `config.js`.
4. Start the server with `npm start`; check `GET /health`. Run the test suite with `npm test`.
5. After Africa's Talking provisions `*200#` for your account, configure that service code in its dashboard and point the USSD application's POST callback to `https://<your-host>/ussd?token=<USSD_CALLBACK_TOKEN>`. The service rejects callback requests for any other code. Use the sandbox before a live short code. Ensure host and proxy access logs redact the callback query token.

The callback accepts Africa's Talking `application/x-www-form-urlencoded` fields (`sessionId`, `serviceCode`, `phoneNumber`, and `text`) and returns `CON` or `END` plain-text responses. Session state is stored in Supabase for ten minutes by default, so sessions can continue across service instances. Per-session rate limiting and a shared callback token are enabled. Configure a strong token, HTTPS, provider sandbox credentials, and production monitoring before launch. The service does not collect card details or claim payment success.

### Run the local USSD prototype

1. In a terminal, open `ussd-service/`, run `npm install`, then run `npm start`. The default local mode starts without Supabase credentials and listens only on your computer at `http://127.0.0.1:3000`.
2. Open `http://127.0.0.1:3000/simulator`, enter a simulated Rwanda caller number, and choose **Dial *200#**. Continue with the keypad or type a passenger name when asked.
3. The sample-data mode offers future Kigali routes, prices calculated with Wayline's RURA rates, simulated seat updates, and booking references. Sample reservations exist only in memory and disappear when the server restarts; they do not affect real schedules or collect payment.
4. To test against real schedules and seat inventory while still using the local simulator, apply the schema above, configure `.env` with the Supabase URL and server-only service-role key, set `LOCAL_USSD_DEMO=false` and `USSD_SIMULATOR_ENABLED=true`, then start the server. It remains bound to localhost in simulator mode. Never expose the simulator or service-role key publicly.
5. To run automated checks, use `npm test`. The sample routes use preloaded demonstration distances; connected mode reads each real schedule's stored map-estimated distance and fare from Supabase, like the website does.

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
- Cross-device booking retrieval requires phone Auth and an SMS provider to be configured in Supabase; it is unavailable until OTP delivery is set up and tested.
- Keep payment-provider secret keys off the public website; live payment processing requires a secure server-side integration.
- Use a real payment-provider integration and complete operational, security, and partner checks before accepting real bookings.
