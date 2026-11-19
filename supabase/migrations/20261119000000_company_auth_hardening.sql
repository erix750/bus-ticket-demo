CREATE OR REPLACE FUNCTION public.is_valid_company_email(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
    SELECT char_length(pg_catalog.btrim(p_email)) BETWEEN 6 AND 254
       AND char_length(pg_catalog.split_part(pg_catalog.btrim(p_email), '@', 1)) BETWEEN 1 AND 64
       AND pg_catalog.lower(pg_catalog.btrim(p_email)) ~
           '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9]([a-z0-9-]{0,57}[a-z0-9])?)$';
$$;

REVOKE ALL ON FUNCTION public.is_valid_company_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_valid_company_email(text) TO authenticated, service_role;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.company_applications'::regclass
          AND conname = 'company_applications_official_email_format_check'
    ) THEN
        ALTER TABLE public.company_applications
            ADD CONSTRAINT company_applications_official_email_format_check
            CHECK (
                official_email = ''
                OR public.is_valid_company_email(official_email)
            ) NOT VALID;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_verified_company_email()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM auth.users AS users
        WHERE users.id = (SELECT auth.uid())
          AND users.email_confirmed_at IS NOT NULL
          AND public.is_valid_company_email(users.email)
    );
$$;

REVOKE ALL ON FUNCTION public.is_verified_company_email() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_verified_company_email() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_verified_approved_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_company_id = (SELECT auth.uid())
       AND public.is_verified_company_email()
       AND EXISTS (
            SELECT 1
            FROM public.companies AS companies
            WHERE companies.id = p_company_id
              AND companies.approval_status = 'approved'
       );
$$;

REVOKE ALL ON FUNCTION public.is_verified_approved_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_verified_approved_company(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_wayline_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (auth.jwt() ->> 'aal') = 'aal2'
       AND EXISTS (
            SELECT 1
            FROM auth.users AS users
            JOIN public.wayline_admins AS admins ON admins.user_id = users.id
            WHERE users.id = (SELECT auth.uid())
              AND users.email_confirmed_at IS NOT NULL
       );
$$;

REVOKE ALL ON FUNCTION public.is_wayline_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_wayline_admin() TO anon, authenticated;

DROP POLICY IF EXISTS companies_owner_select ON public.companies;
CREATE POLICY companies_owner_select
ON public.companies
FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()) AND public.is_verified_company_email());

DROP POLICY IF EXISTS companies_approved_owner_update ON public.companies;
CREATE POLICY companies_approved_owner_update
ON public.companies
FOR UPDATE
TO authenticated
USING (id = (SELECT auth.uid()) AND public.is_verified_approved_company(id))
WITH CHECK (id = (SELECT auth.uid()) AND public.is_verified_approved_company(id));

DROP POLICY IF EXISTS companies_verification_select_guard ON public.companies;
CREATE POLICY companies_verification_select_guard
ON public.companies
AS RESTRICTIVE
FOR SELECT
TO anon, authenticated
USING (
    approval_status = 'approved'
    OR (
        id = (SELECT auth.uid())
        AND public.is_verified_company_email()
    )
    OR public.is_wayline_admin()
);

DROP POLICY IF EXISTS companies_verification_update_guard ON public.companies;
CREATE POLICY companies_verification_update_guard
ON public.companies
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (id = (SELECT auth.uid()) AND public.is_verified_approved_company(id))
WITH CHECK (id = (SELECT auth.uid()) AND public.is_verified_approved_company(id));

DROP POLICY IF EXISTS buses_approved_public_or_owner_select ON public.buses;
CREATE POLICY buses_approved_public_or_owner_select
ON public.buses
FOR SELECT
TO anon, authenticated
USING (
    public.is_approved_company(company_id)
    AND (
        (
            company_id = (SELECT auth.uid())
            AND public.is_verified_approved_company(company_id)
        )
        OR (
            travel_date + departure_time > (now() AT TIME ZONE 'Africa/Kigali')
            AND is_active
            AND NOT is_cancelled
            AND available_seats > 0
        )
    )
);

DROP POLICY IF EXISTS buses_approval_select_guard ON public.buses;
CREATE POLICY buses_approval_select_guard
ON public.buses
AS RESTRICTIVE
FOR SELECT
TO anon, authenticated
USING (
    public.is_approved_company(company_id)
    AND (
        (
            company_id = (SELECT auth.uid())
            AND public.is_verified_approved_company(company_id)
        )
        OR (
            travel_date + departure_time > (now() AT TIME ZONE 'Africa/Kigali')
            AND is_active
            AND NOT is_cancelled
            AND available_seats > 0
        )
    )
);

DROP POLICY IF EXISTS buses_approved_owner_insert ON public.buses;
CREATE POLICY buses_approved_owner_insert
ON public.buses
FOR INSERT
TO authenticated
WITH CHECK (
    company_id = (SELECT auth.uid())
    AND public.is_verified_approved_company(company_id)
);

DROP POLICY IF EXISTS buses_approval_insert_guard ON public.buses;
CREATE POLICY buses_approval_insert_guard
ON public.buses
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
    company_id = (SELECT auth.uid())
    AND public.is_verified_approved_company(company_id)
);

DROP POLICY IF EXISTS buses_approved_owner_update ON public.buses;
CREATE POLICY buses_approved_owner_update
ON public.buses
FOR UPDATE
TO authenticated
USING (
    company_id = (SELECT auth.uid())
    AND public.is_verified_approved_company(company_id)
)
WITH CHECK (
    company_id = (SELECT auth.uid())
    AND public.is_verified_approved_company(company_id)
);

DROP POLICY IF EXISTS buses_approval_update_guard ON public.buses;
CREATE POLICY buses_approval_update_guard
ON public.buses
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
    company_id = (SELECT auth.uid())
    AND public.is_verified_approved_company(company_id)
)
WITH CHECK (
    company_id = (SELECT auth.uid())
    AND public.is_verified_approved_company(company_id)
);

DROP POLICY IF EXISTS buses_approved_owner_delete ON public.buses;
CREATE POLICY buses_approved_owner_delete
ON public.buses
FOR DELETE
TO authenticated
USING (
    company_id = (SELECT auth.uid())
    AND public.is_verified_approved_company(company_id)
);

DROP POLICY IF EXISTS buses_approval_delete_guard ON public.buses;
CREATE POLICY buses_approval_delete_guard
ON public.buses
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
    company_id = (SELECT auth.uid())
    AND public.is_verified_approved_company(company_id)
);

CREATE OR REPLACE FUNCTION public.guard_approved_company_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.is_verified_approved_company(NEW.company_id) THEN
        RAISE EXCEPTION 'Only verified, approved companies can manage schedules.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_portal_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    result jsonb;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION 'Sign in to view your company application.';
    END IF;
    IF NOT public.is_verified_company_email() THEN
        RAISE EXCEPTION 'Confirm your company email before accessing company management.';
    END IF;

    SELECT jsonb_build_object(
        'company_id', companies.id,
        'company_name', companies.name,
        'approval_status', companies.approval_status,
        'application_status', coalesce(applications.status, companies.approval_status),
        'representative_name', applications.representative_name,
        'official_email', applications.official_email,
        'contact_phone', applications.contact_phone,
        'company_address', applications.company_address,
        'company_location', applications.company_location,
        'business_registration', applications.business_registration,
        'business_document_path', applications.business_document_path,
        'transport_license_path', applications.transport_license_path,
        'license_not_applicable', applications.license_not_applicable,
        'review_notes', applications.review_notes,
        'submitted_at', applications.submitted_at
    )
    INTO result
    FROM public.companies AS companies
    LEFT JOIN public.company_applications AS applications
        ON applications.company_id = companies.id
    WHERE companies.id = (SELECT auth.uid());

    IF result IS NULL THEN
        RAISE EXCEPTION 'No company profile is associated with this account.';
    END IF;
    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_portal_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_portal_status() TO authenticated;

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
      AND public.is_verified_approved_company(buses.company_id)
    ORDER BY bookings.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_company_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_bookings() TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_bus_trip(p_bus_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    selected_bus public.buses%rowtype;
    released_seats integer;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION 'Sign in with the bus company account to cancel this trip.';
    END IF;
    IF NOT public.is_verified_approved_company((SELECT auth.uid())) THEN
        RAISE EXCEPTION 'Only verified, approved companies can manage schedules.';
    END IF;

    SELECT *
      INTO selected_bus
      FROM public.buses
     WHERE id = p_bus_id
       AND company_id = (SELECT auth.uid())
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The schedule was not found or you do not have permission to cancel it.';
    END IF;
    IF selected_bus.is_cancelled THEN
        RETURN 0;
    END IF;
    IF selected_bus.travel_date + selected_bus.departure_time <=
        (now() AT TIME ZONE 'Africa/Kigali') THEN
        RAISE EXCEPTION 'A trip cannot be cancelled after its departure time.';
    END IF;

    WITH cancelled_bookings AS (
        UPDATE public.bookings
           SET cancelled = true
         WHERE bus_id = selected_bus.id
           AND NOT cancelled
        RETURNING seat_count
    )
    SELECT coalesce(sum(seat_count), 0)::integer
      INTO released_seats
      FROM cancelled_bookings;

    UPDATE public.buses
       SET is_cancelled = true,
           is_active = false,
           available_seats = least(total_seats, available_seats + released_seats)
     WHERE id = selected_bus.id;
    RETURN released_seats;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_bus_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_bus_trip(uuid) TO authenticated;

DROP POLICY IF EXISTS company_applications_owner_or_admin_select ON public.company_applications;
CREATE POLICY company_applications_owner_or_admin_select
ON public.company_applications
FOR SELECT
TO authenticated
USING (
    (company_id = (SELECT auth.uid()) AND public.is_verified_company_email())
    OR public.is_wayline_admin()
);

DROP POLICY IF EXISTS company_applications_private_select_guard ON public.company_applications;
CREATE POLICY company_applications_private_select_guard
ON public.company_applications
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
    (company_id = (SELECT auth.uid()) AND public.is_verified_company_email())
    OR public.is_wayline_admin()
);

DROP POLICY IF EXISTS company_documents_owner_or_admin_read ON storage.objects;
CREATE POLICY company_documents_owner_or_admin_read
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'company-documents'
    AND (
        (
            split_part(name, '/', 1) = (SELECT auth.uid())::text
            AND public.is_verified_company_email()
        )
        OR public.is_wayline_admin()
    )
);

DROP POLICY IF EXISTS company_documents_pending_owner_upload ON storage.objects;
CREATE POLICY company_documents_pending_owner_upload
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'company-documents'
    AND split_part(name, '/', 1) = (SELECT auth.uid())::text
    AND public.is_verified_company_email()
    AND EXISTS (
        SELECT 1
        FROM public.company_applications AS applications
        WHERE applications.company_id = (SELECT auth.uid())
          AND applications.status IN ('pending', 'under_review', 'rejected')
    )
);

DROP POLICY IF EXISTS company_documents_pending_owner_delete ON storage.objects;
CREATE POLICY company_documents_pending_owner_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'company-documents'
    AND split_part(name, '/', 1) = (SELECT auth.uid())::text
    AND public.is_verified_company_email()
    AND EXISTS (
        SELECT 1
        FROM public.company_applications AS applications
        WHERE applications.company_id = (SELECT auth.uid())
          AND applications.status IN ('pending', 'rejected')
    )
);

DROP POLICY IF EXISTS company_documents_private_select_guard ON storage.objects;
CREATE POLICY company_documents_private_select_guard
ON storage.objects
AS RESTRICTIVE
FOR SELECT
TO anon, authenticated
USING (
    bucket_id <> 'company-documents'
    OR (
        auth.role() = 'authenticated'
        AND (
            (
                split_part(name, '/', 1) = (SELECT auth.uid())::text
                AND public.is_verified_company_email()
            )
            OR public.is_wayline_admin()
        )
    )
);

DROP POLICY IF EXISTS company_documents_private_insert_guard ON storage.objects;
CREATE POLICY company_documents_private_insert_guard
ON storage.objects
AS RESTRICTIVE
FOR INSERT
TO anon, authenticated
WITH CHECK (
    bucket_id <> 'company-documents'
    OR (
        auth.role() = 'authenticated'
        AND split_part(name, '/', 1) = (SELECT auth.uid())::text
        AND public.is_verified_company_email()
        AND EXISTS (
            SELECT 1
            FROM public.company_applications AS applications
            WHERE applications.company_id = (SELECT auth.uid())
              AND applications.status IN ('pending', 'under_review', 'rejected')
        )
    )
);

DROP POLICY IF EXISTS company_documents_private_delete_guard ON storage.objects;
CREATE POLICY company_documents_private_delete_guard
ON storage.objects
AS RESTRICTIVE
FOR DELETE
TO anon, authenticated
USING (
    bucket_id <> 'company-documents'
    OR (
        auth.role() = 'authenticated'
        AND split_part(name, '/', 1) = (SELECT auth.uid())::text
        AND public.is_verified_company_email()
        AND EXISTS (
            SELECT 1
            FROM public.company_applications AS applications
            WHERE applications.company_id = (SELECT auth.uid())
              AND applications.status IN ('pending', 'rejected')
        )
    )
);
