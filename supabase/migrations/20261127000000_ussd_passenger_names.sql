DROP FUNCTION IF EXISTS public.ussd_book_bus(text, uuid, text, text, integer, text);

CREATE OR REPLACE FUNCTION public.ussd_book_bus(
    p_session_id text,
    p_bus_id uuid,
    p_passenger_name text,
    p_passenger_names text[],
    p_passenger_phone text,
    p_seat_count integer,
    p_payment_method text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    clean_session_id text := pg_catalog.btrim(coalesce(p_session_id, ''));
    existing_booking jsonb;
    new_booking jsonb;
BEGIN
    IF clean_session_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
        RAISE EXCEPTION 'Invalid USSD session identifier.';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(0, pg_catalog.hashtext(clean_session_id));
    SELECT pg_catalog.jsonb_build_object(
        'id', bookings.id,
        'payment_status', bookings.payment_status
    )
      INTO existing_booking
      FROM public.bookings AS bookings
     WHERE bookings.ussd_session_id = clean_session_id;
    IF existing_booking IS NOT NULL THEN
        RETURN existing_booking;
    END IF;

    new_booking := public.book_bus(
        p_bus_id,
        p_passenger_name,
        p_passenger_names,
        p_passenger_phone,
        p_seat_count,
        p_payment_method
    );
    UPDATE public.bookings
       SET ussd_session_id = clean_session_id
     WHERE id = (new_booking ->> 'id')::uuid;
    RETURN new_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.ussd_book_bus(text, uuid, text, text[], text, integer, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ussd_book_bus(text, uuid, text, text[], text, integer, text)
    TO service_role;

DROP FUNCTION IF EXISTS public.ussd_book_bus_segment(text, uuid, text, text, text, text, integer, text);

CREATE OR REPLACE FUNCTION public.ussd_book_bus_segment(
    p_session_id text,
    p_bus_id uuid,
    p_origin_city text,
    p_destination_city text,
    p_passenger_name text,
    p_passenger_names text[],
    p_passenger_phone text,
    p_seat_count integer,
    p_payment_method text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    clean_session_id text := pg_catalog.btrim(coalesce(p_session_id, ''));
    existing_booking jsonb;
    new_booking jsonb;
BEGIN
    IF clean_session_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
        RAISE EXCEPTION 'Invalid USSD session identifier.';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(0, pg_catalog.hashtext(clean_session_id));
    SELECT pg_catalog.jsonb_build_object(
        'id', bookings.id,
        'payment_status', bookings.payment_status
    )
      INTO existing_booking
      FROM public.bookings AS bookings
     WHERE bookings.ussd_session_id = clean_session_id;
    IF existing_booking IS NOT NULL THEN
        RETURN existing_booking;
    END IF;

    new_booking := public.book_bus_segment(
        p_bus_id,
        p_origin_city,
        p_destination_city,
        p_passenger_name,
        p_passenger_names,
        p_passenger_phone,
        p_seat_count,
        p_payment_method
    );
    UPDATE public.bookings
       SET ussd_session_id = clean_session_id
     WHERE id = (new_booking ->> 'id')::uuid;
    RETURN new_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.ussd_book_bus_segment(text, uuid, text, text, text, text[], text, integer, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ussd_book_bus_segment(text, uuid, text, text, text, text[], text, integer, text)
    TO service_role;
