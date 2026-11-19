ALTER TABLE public.buses
    ADD COLUMN IF NOT EXISTS route_segments jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.buses'::regclass
          AND conname = 'buses_route_segments_array_check'
    ) THEN
        ALTER TABLE public.buses
            ADD CONSTRAINT buses_route_segments_array_check
            CHECK (jsonb_typeof(route_segments) = 'array');
    END IF;
END;
$$;

GRANT INSERT (route_segments) ON public.buses TO authenticated;
GRANT UPDATE (route_segments) ON public.buses TO authenticated;

CREATE OR REPLACE FUNCTION public.set_rura_bus_fare()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    rate_per_km numeric(5, 2);
    route_points text[];
    segment jsonb;
    computed_segments jsonb := '[]'::jsonb;
    segment_count integer;
    segment_distance numeric(8, 2);
    total_distance numeric(8, 2) := 0;
    segment_index integer := 0;
BEGIN
    IF NEW.fare_category = 'kigali' THEN
        rate_per_km := 59.28;
    ELSIF NEW.fare_category = 'intercity' THEN
        rate_per_km := 41.58;
    ELSE
        RAISE EXCEPTION 'Choose a valid RURA fare area.';
    END IF;

    IF NEW.route_segments IS NULL OR jsonb_typeof(NEW.route_segments) <> 'array' THEN
        RAISE EXCEPTION 'Route segments must be a JSON array.';
    END IF;

    segment_count := jsonb_array_length(NEW.route_segments);
    IF segment_count > 0 THEN
        SELECT ARRAY[trim(NEW.from_city)]
            || coalesce(array_agg(trim(stop) ORDER BY ordinal), ARRAY[]::text[])
            || ARRAY[trim(NEW.to_city)]
          INTO route_points
          FROM regexp_split_to_table(coalesce(NEW.intermediate_stops, ''), E'[,\\n]')
               WITH ORDINALITY AS stops(stop, ordinal)
         WHERE trim(stop) <> '';

        IF segment_count <> cardinality(route_points) - 1 THEN
            RAISE EXCEPTION 'Provide one verified distance for every consecutive route leg.';
        END IF;

        FOR segment IN SELECT value FROM jsonb_array_elements(NEW.route_segments) AS parts(value)
        LOOP
            IF lower(trim(coalesce(segment ->> 'from', ''))) <> lower(route_points[segment_index + 1])
                OR lower(trim(coalesce(segment ->> 'to', ''))) <> lower(route_points[segment_index + 2]) THEN
                RAISE EXCEPTION 'Route segment endpoints must match the published stop order.';
            END IF;
            segment_distance := (segment ->> 'distanceKm')::numeric;
            IF segment_distance NOT BETWEEN 0.1 AND 1000 THEN
                RAISE EXCEPTION 'Each route leg distance must be from 0.1 to 1,000 km.';
            END IF;
            total_distance := total_distance + segment_distance;
            computed_segments := computed_segments || jsonb_build_array(jsonb_build_object(
                'from', route_points[segment_index + 1],
                'to', route_points[segment_index + 2],
                'distanceKm', segment_distance,
                'fare', round(segment_distance * rate_per_km)
            ));
            segment_index := segment_index + 1;
        END LOOP;

        IF total_distance > 1000 THEN
            RAISE EXCEPTION 'The total route distance cannot exceed 1,000 km.';
        END IF;
        IF NEW.route_distance_km IS NOT NULL
            AND abs(total_distance - NEW.route_distance_km) > 0.1 THEN
            RAISE EXCEPTION 'The leg distances must add up to the verified full-route distance.';
        END IF;

        NEW.route_distance_km := total_distance;
        NEW.route_segments := computed_segments;
    ELSIF NEW.route_distance_km IS NULL OR NEW.route_distance_km NOT BETWEEN 0.1 AND 1000 THEN
        RAISE EXCEPTION 'Enter a route distance from 0.1 to 1,000 km.';
    END IF;

    NEW.fare := round(NEW.route_distance_km * rate_per_km);
    IF TG_OP = 'INSERT' THEN
        NEW.available_seats := NEW.total_seats;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_rura_bus_fare_before_save ON public.buses;
CREATE TRIGGER set_rura_bus_fare_before_save
    BEFORE INSERT OR UPDATE OF from_city, to_city, intermediate_stops, route_distance_km,
        fare_category, route_segments
    ON public.buses
    FOR EACH ROW EXECUTE FUNCTION public.set_rura_bus_fare();
REVOKE EXECUTE ON FUNCTION public.set_rura_bus_fare() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.book_bus_segment(
    p_bus_id uuid,
    p_origin_city text,
    p_destination_city text,
    p_passenger_name text,
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
    selected_bus public.buses%rowtype;
    new_booking public.bookings%rowtype;
    clean_name text := trim(coalesce(p_passenger_name, ''));
    clean_phone text := regexp_replace(trim(coalesce(p_passenger_phone, '')), '[^0-9+]', '', 'g');
    route_points text[];
    selected_from text;
    selected_to text;
    selected_stops text := '';
    start_index integer;
    end_index integer;
    leg_index integer;
    segment jsonb;
    segment_distance numeric(8, 2);
    section_distance numeric(8, 2) := 0;
    rate_per_km numeric(5, 2);
    section_fare numeric(12, 2);
    base_amount numeric(12, 2);
    fee_amount numeric(12, 2) := 0;
    estimated_duration integer;
BEGIN
    IF clean_phone ~ '^0[0-9]{9}$' THEN
        clean_phone := '+250' || substring(clean_phone FROM 2);
    ELSIF clean_phone ~ '^250[0-9]{9}$' THEN
        clean_phone := '+' || clean_phone;
    END IF;
    IF char_length(clean_name) NOT BETWEEN 1 AND 80 THEN
        RAISE EXCEPTION 'Enter a passenger name of 1 to 80 characters.';
    END IF;
    IF clean_phone !~ '^\+2507[0-9]{8}$' THEN
        RAISE EXCEPTION 'Enter a valid Rwanda mobile phone number.';
    END IF;
    IF p_seat_count IS NULL OR p_seat_count NOT BETWEEN 1 AND 20 THEN
        RAISE EXCEPTION 'Choose between 1 and 20 passengers.';
    END IF;
    IF p_payment_method IS NULL OR p_payment_method NOT IN ('MTN Mobile Money', 'Airtel Money') THEN
        RAISE EXCEPTION 'Choose a supported payment method.';
    END IF;

    SELECT *
      INTO selected_bus
      FROM public.buses
     WHERE id = p_bus_id
       AND travel_date + departure_time > (now() AT TIME ZONE 'Africa/Kigali')
       AND is_active
       AND NOT is_cancelled
     FOR UPDATE;

    IF NOT FOUND OR selected_bus.available_seats < p_seat_count THEN
        RAISE EXCEPTION 'This trip has departed or no longer has enough seats. Search again.';
    END IF;

    IF selected_bus.fare_category = 'kigali' THEN
        rate_per_km := 59.28;
    ELSIF selected_bus.fare_category = 'intercity' THEN
        rate_per_km := 41.58;
    ELSE
        RAISE EXCEPTION 'This trip has an invalid fare area.';
    END IF;

    SELECT ARRAY[trim(selected_bus.from_city)]
        || coalesce(array_agg(trim(stop) ORDER BY ordinal), ARRAY[]::text[])
        || ARRAY[trim(selected_bus.to_city)]
      INTO route_points
      FROM regexp_split_to_table(coalesce(selected_bus.intermediate_stops, ''), E'[,\\n]')
           WITH ORDINALITY AS stops(stop, ordinal)
     WHERE trim(stop) <> '';

    IF jsonb_array_length(selected_bus.route_segments) = 0 THEN
        IF lower(trim(coalesce(p_origin_city, ''))) <> lower(trim(selected_bus.from_city))
            OR lower(trim(coalesce(p_destination_city, ''))) <> lower(trim(selected_bus.to_city)) THEN
            RAISE EXCEPTION 'This schedule has no verified distances for that stop-to-stop section.';
        END IF;
        selected_from := trim(selected_bus.from_city);
        selected_to := trim(selected_bus.to_city);
        selected_stops := coalesce(selected_bus.intermediate_stops, '');
        section_distance := selected_bus.route_distance_km;
        section_fare := selected_bus.fare;
        estimated_duration := selected_bus.estimated_duration_minutes;
    ELSE
        IF jsonb_array_length(selected_bus.route_segments) <> cardinality(route_points) - 1 THEN
            RAISE EXCEPTION 'This schedule has incomplete verified route distances.';
        END IF;
        start_index := NULL;
        end_index := NULL;
        FOR leg_index IN 1..cardinality(route_points) LOOP
            IF start_index IS NULL AND lower(route_points[leg_index]) = lower(trim(coalesce(p_origin_city, ''))) THEN
                start_index := leg_index;
            ELSIF start_index IS NOT NULL AND leg_index > start_index
                AND lower(route_points[leg_index]) = lower(trim(coalesce(p_destination_city, ''))) THEN
                end_index := leg_index;
                EXIT;
            END IF;
        END LOOP;
        IF start_index IS NULL OR end_index IS NULL OR end_index <= start_index THEN
            RAISE EXCEPTION 'Choose a forward section of this published route.';
        END IF;

        selected_from := route_points[start_index];
        selected_to := route_points[end_index];
        FOR leg_index IN start_index..end_index - 1 LOOP
            segment := selected_bus.route_segments -> (leg_index - 1);
            IF lower(trim(coalesce(segment ->> 'from', ''))) <> lower(route_points[leg_index])
                OR lower(trim(coalesce(segment ->> 'to', ''))) <> lower(route_points[leg_index + 1]) THEN
                RAISE EXCEPTION 'This schedule has invalid route segment order.';
            END IF;
            segment_distance := (segment ->> 'distanceKm')::numeric;
            IF segment_distance NOT BETWEEN 0.1 AND 1000 THEN
                RAISE EXCEPTION 'This schedule has an invalid route segment distance.';
            END IF;
            section_distance := section_distance + segment_distance;
        END LOOP;
        section_fare := round(section_distance * rate_per_km);
        IF end_index > start_index + 1 THEN
            selected_stops := array_to_string(route_points[start_index + 1:end_index - 1], ', ');
        END IF;
        IF start_index = 1 AND end_index = cardinality(route_points) THEN
            estimated_duration := selected_bus.estimated_duration_minutes;
        END IF;
    END IF;

    base_amount := section_fare * p_seat_count;
    UPDATE public.buses
       SET available_seats = available_seats - p_seat_count
     WHERE id = selected_bus.id;

    INSERT INTO public.bookings (
        bus_id, bus_name, from_city, to_city, travel_date, departure_time,
        estimated_duration_minutes, intermediate_stops,
        passenger_name, passenger_phone, seat_count, base_fare, platform_fee,
        total_fare, payment_method
    )
    VALUES (
        selected_bus.id, selected_bus.name, selected_from, selected_to,
        selected_bus.travel_date, selected_bus.departure_time,
        estimated_duration, selected_stops,
        clean_name, clean_phone, p_seat_count, base_amount, fee_amount,
        base_amount + fee_amount, p_payment_method
    )
    RETURNING * INTO new_booking;

    RETURN jsonb_build_object(
        'id', new_booking.id,
        'bus_id', new_booking.bus_id,
        'passenger_name', new_booking.passenger_name,
        'passenger_phone', new_booking.passenger_phone,
        'company_id', selected_bus.company_id,
        'bus_name', new_booking.bus_name,
        'from_city', new_booking.from_city,
        'to_city', new_booking.to_city,
        'travel_date', new_booking.travel_date,
        'departure_time', new_booking.departure_time,
        'estimated_duration_minutes', new_booking.estimated_duration_minutes,
        'intermediate_stops', new_booking.intermediate_stops,
        'seat_count', new_booking.seat_count,
        'base_fare', new_booking.base_fare,
        'platform_fee', new_booking.platform_fee,
        'total_fare', new_booking.total_fare,
        'payment_method', new_booking.payment_method,
        'payment_status', new_booking.payment_status,
        'cancelled', new_booking.cancelled
    );
END;
$$;

REVOKE ALL ON FUNCTION public.book_bus_segment(uuid, text, text, text, text, integer, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_bus_segment(uuid, text, text, text, text, integer, text)
    TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.ussd_book_bus_segment(
    p_session_id text,
    p_bus_id uuid,
    p_origin_city text,
    p_destination_city text,
    p_passenger_name text,
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
    SELECT pg_catalog.jsonb_build_object('id', bookings.id, 'payment_status', bookings.payment_status)
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

REVOKE ALL ON FUNCTION public.ussd_book_bus_segment(text, uuid, text, text, text, text, integer, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ussd_book_bus_segment(text, uuid, text, text, text, text, integer, text)
    TO service_role;