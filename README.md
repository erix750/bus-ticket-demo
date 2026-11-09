# Wayline Bus Booking

A browser-based bus schedule and ticket-booking prototype backed by Supabase.

## Features

- Passengers can search published bus schedules and reserve seats.
- Each saved booking receives a reference and an unpaid confirmation.
- Passengers provide a name and phone number at checkout; contact details are available to the relevant bus company.
- Passengers search and book without creating an account.
- Bus companies have a dashboard to add, edit, hide, and remove schedules, manage seat capacity, review bookings, and upload a company logo.
- Schedule fares are calculated from the route distance and selected RURA fare area.
- A Help Center explains booking, unpaid payment status, cancellations, and contact options.
- Passengers can select MTN Mobile Money or Airtel Money as their intended payment method; Visa and Mastercard are listed as coming soon.
- Seat reservations update shared availability in Supabase. Passengers contact Wayline or the bus company to request cancellations.
- Bus availability is refreshed through Supabase Realtime, with a 30-second fallback refresh.
- Company records and schedules are protected by Supabase authentication and row-level ownership policies.
- Operators can calculate estimated road distances from route cities and review or edit the result before the RWF fare is calculated using the selected RURA area tariff.
- Full buses are excluded from passenger search while their schedules and booking records remain available to operators.
- Operators can hide and restore schedules without deleting the bus or its booking history.
- The website can be installed from a supported mobile browser on Android and iPhone.
- Passengers see trip search first; company account sign-in and registration open from the footer.

## Supabase setup

1. Create a Supabase project.
2. Open the SQL Editor and run [`supabase/schema.sql`](./supabase/schema.sql).
3. In `config.js`, configure the Supabase project URL, browser-safe publishable (anon) key, and public `siteUrl`. Never put a service-role key in client-side code.
4. Serve the repository as a static website (for example, with GitHub Pages). In Supabase Authentication URL Configuration, set the Site URL to the public `siteUrl` and add that exact URL to the Redirect URLs allowlist. Password reset links always return to this configured URL, including when a reset is requested from a local preview.
5. In Supabase Auth settings, require email confirmations. Create a company account in the app and confirm the email before signing in and publishing schedules. If the address is mistyped or the user cannot access that inbox, they cannot complete confirmation or activate the account.
6. Re-run the current `supabase/schema.sql` when updating an existing project. It adds passenger phone storage, limits booking access to the relevant company dashboard, removes public passenger history/cancellation RPCs, and includes the schedule-edit safeguards.

Company sign-up is open; schedules can be published as soon as the account is ready. Existing browser-only demo records are not automatically migrated to Supabase.

Passenger booking history is not available on the public website. Passengers should keep the reference shown after booking and contact Wayline or the bus company for booking changes or cancellations.

### RURA fares and database updates

Operators can enter the one-way route distance themselves or calculate an estimated city-center driving distance from the departure and destination cities. The distance lookup uses the Photon geocoder and OSRM public demo routing service, requires an internet connection, and can be unavailable; operators should check the estimate against the actual bus route and can edit it before saving. Map data is from [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Select the applicable fare area and the app calculates and stores the fare using the RURA public transport tariff document:

- City of Kigali: RWF 59.28 per passenger per kilometre.
- Intercity/provincial: RWF 41.58 per passenger per kilometre.

The fare is rounded to the nearest RWF. Existing schedules without a recorded distance remain in the database but are not listed for passengers until a new schedule with a distance is added. Schedule bus name, route, date, and departure time are locked once booking records exist; hide the old schedule and create a new one instead.

Reference: [RURA applicable pump prices and public transport tariffs](https://www.rura.rw/fileadmin/user_upload/RURA/Documents/Tariffs/Applicaple_pump_prices_and_Public_Transport_tariffs.pdf).

## Important limitations

- This is a prototype, not a production-ready ticketing or payment system.
- The public Photon and OSRM demo services have no availability guarantee; use a suitable hosted or self-hosted routing service before relying on automatic distance estimates in production.
- Selecting MTN Mobile Money or Airtel Money only records the passenger's intended method. No payment is initiated or verified; bookings remain unpaid. Visa and Mastercard payments are not available.
- Keep payment-provider secret keys off the public website; live payment processing requires a secure server-side integration.
- Use a real payment-provider integration and complete operational, security, and partner checks before accepting real bookings.
