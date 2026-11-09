# Wayline Bus Booking

A browser-based bus schedule and ticket-booking prototype backed by Supabase.

## Features

- Passengers can search published bus schedules and reserve seats.
- Each saved booking receives a reference and an unpaid booking record passengers can view and print.
- Passengers can view and print their booking records or open a prefilled SMS draft in their phone's messaging app.
- Bus companies have a dashboard to add, edit, hide, and remove schedules, manage seat capacity, review bookings, and upload a company logo.
- Schedule fares are calculated from the route distance and selected RURA fare area.
- A Help Center explains booking, unpaid payment status, cancellations, and contact options.
- Passengers choose MTN Mobile Money or Airtel Money as their intended payment method.
- Seat reservations and cancellations update shared availability in Supabase.
- Bus availability is refreshed through Supabase Realtime, with a 30-second fallback refresh.
- Passenger booking records are retrieved from Supabase using a private cancellation token stored in the browser that made the booking.
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
6. Re-run the current `supabase/schema.sql` when updating an existing project. It includes the permissions for schedule editing and database safeguards that preserve already-reserved seats and prevent changing booked trip details.

Company sign-up is open; schedules can be published as soon as the account is ready. Existing browser-only demo records are not automatically migrated to Supabase.

Passenger booking history is available in the same browser where each booking was made; passenger accounts and cross-device booking history are not currently provided.

### RURA fares and database updates

Operators can enter the one-way route distance themselves or calculate an estimated city-center driving distance from the departure and destination cities. The distance lookup uses the Photon geocoder and OSRM public demo routing service, requires an internet connection, and can be unavailable; operators should check the estimate against the actual bus route and can edit it before saving. Map data is from [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Select the applicable fare area and the app calculates and stores the fare using the RURA public transport tariff document:

- City of Kigali: RWF 59.28 per passenger per kilometre.
- Intercity/provincial: RWF 41.58 per passenger per kilometre.

The fare is rounded to the nearest RWF. Existing schedules without a recorded distance remain in the database but are not listed for passengers until a new schedule with a distance is added. Schedule bus name, route, date, and departure time are locked once booking records exist; hide the old schedule and create a new one instead.

Reference: [RURA applicable pump prices and public transport tariffs](https://www.rura.rw/fileadmin/user_upload/RURA/Documents/Tariffs/Applicaple_pump_prices_and_Public_Transport_tariffs.pdf).

## Important limitations

- This is a prototype, not a production-ready ticketing or payment system.
- The public Photon and OSRM demo services have no availability guarantee; use a suitable hosted or self-hosted routing service before relying on automatic distance estimates in production.
- Selecting MTN Mobile Money or Airtel Money only records the passenger's intended method. No payment is initiated or verified; bookings remain unpaid.
- The SMS action only opens a prefilled message in the passenger's messaging app; the passenger must choose a recipient and send it, and their mobile provider may charge. SMS is not sent automatically.
- Use a real payment-provider integration and complete operational, security, and partner checks before accepting real bookings.
