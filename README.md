# Wayline Bus Booking

A browser-based bus schedule and ticket-booking prototype backed by Supabase.

## Features

- Passengers can search published bus schedules and reserve seats.
- Bus companies can create accounts, publish schedules, view bookings, and upload a company logo.
- Passengers choose MTN Mobile Money or Airtel Money as their intended payment method.
- Seat reservations and cancellations update shared availability in Supabase.

## Supabase setup

1. Create a Supabase project.
2. Open the SQL Editor and run [`supabase/schema.sql`](./supabase/schema.sql).
3. In `database.js`, configure the Supabase project URL and the browser-safe publishable (anon) key. Never put a service-role key in client-side code.
4. Serve the repository as a static website (for example, with GitHub Pages) and use the resulting site URL as the Supabase Auth redirect URL.
5. Create a company account in the app. If email confirmation is enabled in Supabase Auth, confirm the email before signing in and publishing schedules.

Company sign-up is open; schedules can be published as soon as the account is ready. Existing browser-only demo records are not automatically migrated to Supabase.

## Important limitations

- This is a prototype, not a production-ready ticketing or payment system.
- Selecting MTN Mobile Money or Airtel Money only records the passenger's intended method. No payment is initiated or verified; bookings remain unpaid.
- Use a real payment-provider integration and complete operational, security, and partner checks before accepting real bookings.
