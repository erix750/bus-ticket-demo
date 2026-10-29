# Wayline Bus Booking

A browser-based bus schedule and ticket-booking prototype backed by Supabase.

## Features

- Passengers can search published bus schedules and reserve seats.
- Bus companies can create accounts, publish schedules, view bookings, and upload a company logo.
- Passengers choose MTN Mobile Money or Airtel Money as their intended payment method.
- Seat reservations and cancellations update shared availability in Supabase.
- Route fares are calculated in RWF from the operator-entered distance and the selected RURA area tariff.
- Full buses are excluded from passenger search while their schedules and booking records remain available to operators.
- Operators can hide and restore schedules without deleting the bus or its booking history.
- The website can be installed from a supported mobile browser on Android and iPhone.
- Passengers see trip search first; company account sign-in and registration open from the header.

## Supabase setup

1. Create a Supabase project.
2. Open the SQL Editor and run [`supabase/schema.sql`](./supabase/schema.sql).
3. In `config.js`, configure the Supabase project URL, browser-safe publishable (anon) key, and public `siteUrl`. Never put a service-role key in client-side code.
4. Serve the repository as a static website (for example, with GitHub Pages). In Supabase Authentication URL Configuration, set the Site URL to the public `siteUrl` and add that exact URL to the Redirect URLs allowlist. Password reset links always return to this configured URL, including when a reset is requested from a local preview.
5. Create a company account in the app. If email confirmation is enabled in Supabase Auth, confirm the email before signing in and publishing schedules.

Company sign-up is open; schedules can be published as soon as the account is ready. Existing browser-only demo records are not automatically migrated to Supabase.

### RURA fares and database updates

Operators enter the one-way route distance and select the applicable fare area. The app calculates and stores the fare using the RURA public transport tariff document:

- City of Kigali: RWF 59.28 per passenger per kilometre.
- Intercity/provincial: RWF 41.58 per passenger per kilometre.

The fare is rounded to the nearest RWF. Before deploying this update to an existing Supabase project, run the updated `supabase/schema.sql` in the Supabase SQL Editor so it adds the fare, schedule visibility, and live-availability database behavior. Existing schedules without a recorded distance remain in the database but are not listed for passengers until a new schedule with a distance is added.

Reference: [RURA applicable pump prices and public transport tariffs](https://www.rura.rw/fileadmin/user_upload/RURA/Documents/Tariffs/Applicaple_pump_prices_and_Public_Transport_tariffs.pdf).

## Important limitations

- This is a prototype, not a production-ready ticketing or payment system.
- Selecting MTN Mobile Money or Airtel Money only records the passenger's intended method. No payment is initiated or verified; bookings remain unpaid.
- Use a real payment-provider integration and complete operational, security, and partner checks before accepting real bookings.
