ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS passenger_names text[];

UPDATE public.bookings
   SET passenger_names = array_fill(btrim(passenger_name), ARRAY[seat_count])
 WHERE passenger_names IS NULL
   AND passenger_name IS NOT NULL;

ALTER TABLE public.bookings
    DROP CONSTRAINT IF EXISTS bookings_passenger_names_check;

ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_passenger_names_check CHECK (
        passenger_names IS NOT NULL
        AND array_length(passenger_names, 1) = seat_count
        AND NOT EXISTS (
            SELECT 1
            FROM unnest(passenger_names) AS name
            WHERE name IS NULL OR char_length(btrim(name)) NOT BETWEEN 1 AND 80
        )
    );

CREATE OR REPLACE FUNCTION public.fill_booking_passenger_names()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.passenger_names IS NULL OR cardinality(NEW.passenger_names) <> NEW.seat_count THEN
        NEW.passenger_names := array_fill(btrim(NEW.passenger_name), ARRAY[NEW.seat_count]);
    END IF;
    NEW.passenger_name := btrim(NEW.passenger_names[1]);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_fill_passenger_names ON public.bookings;
CREATE TRIGGER bookings_fill_passenger_names
BEFORE INSERT OR UPDATE OF passenger_name, passenger_names, seat_count
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.fill_booking_passenger_names();

CREATE OR REPLACE FUNCTION public.book_bus(
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
    created_booking jsonb;
    booking_id uuid;
    clean_names text[];
BEGIN
    IF p_passenger_names IS NULL
        OR cardinality(p_passenger_names) <> p_seat_count
        OR EXISTS (
            SELECT 1
            FROM unnest(p_passenger_names) AS name
            WHERE char_length(btrim(name)) NOT BETWEEN 1 AND 80
        ) THEN
        RAISE EXCEPTION 'Enter one passenger name of 1 to 80 characters for each seat.';
    END IF;

    SELECT array_agg(btrim(name) ORDER BY ordinality)
      INTO clean_names
      FROM unnest(p_passenger_names) WITH ORDINALITY AS names(name, ordinality);

    created_booking := public.book_bus(
        p_bus_id,
        clean_names[1],
        p_passenger_phone,
        p_seat_count,
        p_payment_method
    );
    booking_id := (created_booking ->> 'id')::uuid;

    UPDATE public.bookings AS bookings
       SET passenger_names = clean_names,
           passenger_name = clean_names[1]
     WHERE bookings.id = booking_id
     RETURNING to_jsonb(bookings) INTO created_booking;

    IF created_booking IS NULL THEN
        RAISE EXCEPTION 'The booking could not be saved with passenger names.';
    END IF;
    RETURN created_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.book_bus(uuid, text, text[], text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_bus(uuid, text, text[], text, integer, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_company_bookings()
RETURNS SETOF jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'id', bookings.id,
        'bus_id', bookings.bus_id,
        'passenger_name', bookings.passenger_name,
        'passenger_names', coalesce(bookings.passenger_names, ARRAY[bookings.passenger_name]),
        'passenger_phone', bookings.passenger_phone,
        'company_id', buses.company_id,
        'company_name', companies.name,
        'company_logo', companies.logo_data,
        'bus_name', bookings.bus_name,
        'from_city', bookings.from_city,
        'to_city', bookings.to_city,
        'travel_date', bookings.travel_date,
        'departure_time', bookings.departure_time,
        'estimated_duration_minutes', bookings.estimated_duration_minutes,
        'intermediate_stops', bookings.intermediate_stops,
        'seat_count', bookings.seat_count,
        'base_fare', bookings.base_fare,
        'platform_fee', bookings.platform_fee,
        'total_fare', bookings.total_fare,
        'payment_method', bookings.payment_method,
        'payment_status', bookings.payment_status,
        'cancelled', bookings.cancelled
    )
    FROM public.bookings AS bookings
    JOIN public.buses AS buses ON buses.id = bookings.bus_id
    JOIN public.companies AS companies ON companies.id = buses.company_id
    WHERE buses.company_id = (SELECT auth.uid())
      AND public.is_approved_company(buses.company_id)
    ORDER BY bookings.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_company_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_bookings() TO authenticated;
