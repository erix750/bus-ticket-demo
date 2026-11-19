CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS expired_at timestamptz;

ALTER TABLE public.bookings
    DROP CONSTRAINT IF EXISTS bookings_payment_status_check;

ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_payment_status_check
    CHECK (payment_status IN ('demo-unpaid', 'pending', 'paid', 'failed', 'expired', 'refunded'));

CREATE INDEX IF NOT EXISTS bookings_unpaid_expiration_idx
    ON public.bookings (reservation_expires_at, bus_id)
    WHERE NOT cancelled AND payment_status IN ('demo-unpaid', 'pending');

CREATE TABLE IF NOT EXISTS public.payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
    provider text NOT NULL CHECK (char_length(trim(provider)) BETWEEN 1 AND 40),
    provider_reference text,
    idempotency_key text NOT NULL UNIQUE CHECK (char_length(trim(idempotency_key)) BETWEEN 1 AND 160),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'refunded')),
    amount numeric(12, 2) NOT NULL CHECK (amount > 0),
    platform_fee numeric(12, 2) NOT NULL DEFAULT 0
        CHECK (platform_fee >= 0 AND platform_fee <= amount),
    currency text NOT NULL DEFAULT 'RWF' CHECK (currency ~ '^[A-Z]{3}$'),
    provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_reference_idx
    ON public.payments (provider, provider_reference)
    WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_booking_id_created_at_idx
    ON public.payments (booking_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.payment_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
    entry_type text NOT NULL
        CHECK (entry_type IN ('charge', 'platform_fee', 'company_payout', 'refund')),
    amount numeric(12, 2) NOT NULL CHECK (amount <> 0),
    currency text NOT NULL DEFAULT 'RWF' CHECK (currency ~ '^[A-Z]{3}$'),
    idempotency_key text NOT NULL UNIQUE
        CHECK (char_length(trim(idempotency_key)) BETWEEN 1 AND 160),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_ledger_payment_id_created_at_idx
    ON public.payment_ledger (payment_id, created_at);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payments, public.payment_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.payments, public.payment_ledger TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_booking_hold_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    active_booking_count integer;
    active_seat_count integer;
BEGIN
    IF NEW.cancelled OR NEW.payment_status NOT IN ('demo-unpaid', 'pending') THEN
        RETURN NEW;
    END IF;
    IF NEW.passenger_phone IS NULL OR NEW.passenger_phone !~ '^\+2507[0-9]{8}$' THEN
        RAISE EXCEPTION 'A valid-format Rwanda mobile phone is required to hold seats.';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(0, pg_catalog.hashtext(NEW.passenger_phone));

    SELECT count(*)::integer,
           coalesce(sum(bookings.seat_count), 0)::integer
      INTO active_booking_count, active_seat_count
      FROM public.bookings AS bookings
     WHERE bookings.passenger_phone = NEW.passenger_phone
       AND NOT bookings.cancelled
       AND bookings.payment_status IN ('demo-unpaid', 'pending')
       AND (
            bookings.reservation_expires_at > pg_catalog.clock_timestamp()
            OR (
                bookings.reservation_expires_at IS NULL
                AND bookings.travel_date + bookings.departure_time >
                    (pg_catalog.clock_timestamp() AT TIME ZONE 'Africa/Kigali')
            )
       );

    IF active_booking_count >= 3 OR active_seat_count + NEW.seat_count > 20 THEN
        RAISE EXCEPTION 'This phone number already has the maximum active seat holds. Wait for a hold to expire or use an existing booking.';
    END IF;

    NEW.reservation_expires_at := coalesce(
        NEW.reservation_expires_at,
        pg_catalog.clock_timestamp() + interval '15 minutes'
    );
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_booking_hold_limits() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_booking_hold_limits_before_insert ON public.bookings;
CREATE TRIGGER enforce_booking_hold_limits_before_insert
    BEFORE INSERT ON public.bookings
    FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_hold_limits();

CREATE OR REPLACE FUNCTION public.expire_unpaid_bookings(p_batch_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    candidate record;
    released_seats integer;
    expired_count integer := 0;
BEGIN
    IF p_batch_limit IS NULL OR p_batch_limit NOT BETWEEN 1 AND 5000 THEN
        RAISE EXCEPTION 'Choose an expiration batch limit from 1 to 5,000.';
    END IF;

    FOR candidate IN
        SELECT bookings.id, bookings.bus_id
          FROM public.bookings AS bookings
         WHERE NOT bookings.cancelled
           AND bookings.payment_status IN ('demo-unpaid', 'pending')
           AND bookings.reservation_expires_at <= pg_catalog.clock_timestamp()
         ORDER BY bookings.bus_id, bookings.id
         LIMIT p_batch_limit
    LOOP
        PERFORM 1
          FROM public.buses AS buses
         WHERE buses.id = candidate.bus_id
         FOR UPDATE;

        UPDATE public.bookings
           SET payment_status = 'expired',
               cancelled = true,
               expired_at = coalesce(expired_at, pg_catalog.clock_timestamp())
         WHERE id = candidate.id
           AND NOT cancelled
           AND payment_status IN ('demo-unpaid', 'pending')
           AND reservation_expires_at <= pg_catalog.clock_timestamp()
        RETURNING seat_count INTO released_seats;

        IF FOUND THEN
            UPDATE public.buses
               SET available_seats = least(total_seats, available_seats + released_seats)
             WHERE id = candidate.bus_id;
            expired_count := expired_count + 1;
        END IF;
    END LOOP;

    RETURN expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_unpaid_bookings(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_bookings(integer) TO service_role;

DO $$
DECLARE
    existing_job_id bigint;
BEGIN
    FOR existing_job_id IN
        SELECT jobid
          FROM cron.job
         WHERE jobname = 'wayline-expire-unpaid-bookings'
    LOOP
        PERFORM cron.unschedule(existing_job_id);
    END LOOP;

    PERFORM cron.schedule(
        'wayline-expire-unpaid-bookings',
        '* * * * *',
        'SELECT public.expire_unpaid_bookings();'
    );
END;
$$;

REVOKE SELECT ON public.companies FROM anon, authenticated;
GRANT SELECT (id, name, logo_data) ON public.companies TO anon;
GRANT SELECT (id, name, logo_data, approval_status) ON public.companies TO authenticated;
