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

## USSD service

The Africa's Talking callback is in [`ussd-service/`](./ussd-service/) and requires Node.js 22.9 or newer. For local use, copy `.env.example` to `.env`, set the service's Supabase URL, service-role key, callback token, and service code, then run:

```sh
cd ussd-service
npm start
```

Keep the service-role key and callback token in private environment settings. Run `npm test` from `ussd-service/`; run the root utility tests with `npm run test` from the repository root.

## Deploy

Deploy the static site from the repository root with GitHub Pages. Set `siteUrl` in `config.js` and configure the same URL in Supabase Auth redirects. Deploy `ussd-service/` separately to a Node.js host with HTTPS, configure its secrets, and point the Africa's Talking POST callback to `/ussd?token=<USSD_CALLBACK_TOKEN>`. USSD booking is unavailable until a shortcode is provisioned and configured.

See [docs/FEATURES.md](./docs/FEATURES.md) for the feature overview.
