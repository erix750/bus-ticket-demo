ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS approval_status text;

UPDATE public.companies
   SET approval_status = 'approved'
 WHERE approval_status IS NULL;

ALTER TABLE public.companies
    ALTER COLUMN approval_status SET DEFAULT 'pending',
    ALTER COLUMN approval_status SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.companies'::regclass
          AND conname = 'companies_approval_status_check'
    ) THEN
        ALTER TABLE public.companies
            ADD CONSTRAINT companies_approval_status_check
            CHECK (approval_status IN ('pending', 'under_review', 'approved', 'rejected', 'suspended'));
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.wayline_admins (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    granted_at timestamptz NOT NULL DEFAULT now(),
    granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.wayline_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wayline_admins FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.company_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
    company_name text NOT NULL CHECK (char_length(company_name) <= 80),
    representative_name text NOT NULL DEFAULT '' CHECK (char_length(representative_name) <= 100),
    official_email text NOT NULL DEFAULT '' CHECK (char_length(official_email) <= 254),
    contact_phone text NOT NULL DEFAULT '' CHECK (char_length(contact_phone) <= 24),
    company_address text NOT NULL DEFAULT '' CHECK (char_length(company_address) <= 240),
    company_location text NOT NULL DEFAULT '' CHECK (char_length(company_location) <= 120),
    business_registration text NOT NULL DEFAULT '' CHECK (char_length(business_registration) <= 160),
    business_document_path text,
    transport_license_path text,
    license_not_applicable boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'under_review', 'approved', 'rejected', 'suspended')),
    review_notes text CHECK (review_notes IS NULL OR char_length(review_notes) <= 2000),
    reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    submitted_at timestamptz,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_applications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.company_applications TO authenticated;

INSERT INTO public.company_applications (company_id, company_name, official_email)
SELECT companies.id, companies.name, left(lower(coalesce(users.email, '')), 254)
FROM public.companies AS companies
JOIN auth.users AS users ON users.id = companies.id
WHERE companies.approval_status = 'pending'
ON CONFLICT (company_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.company_activity_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
    event_type text NOT NULL,
    record_id uuid,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_activity_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_activity_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.company_activity_log TO authenticated;

CREATE OR REPLACE FUNCTION public.is_wayline_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.wayline_admins AS admins
        WHERE admins.user_id = (SELECT auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION public.is_wayline_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_wayline_admin() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_approved_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.companies AS companies
        WHERE companies.id = p_company_id
          AND companies.approval_status = 'approved'
    );
$$;

REVOKE ALL ON FUNCTION public.is_approved_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_approved_company(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_company_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    company_name text;
BEGIN
    company_name := trim(coalesce(NEW.raw_user_meta_data ->> 'company_name', ''));
    IF char_length(company_name) NOT BETWEEN 2 AND 80 THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.companies (id, name, approval_status)
    VALUES (NEW.id, company_name, 'pending')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.company_applications (
        company_id,
        company_name,
        representative_name,
        official_email,
        contact_phone,
        company_address,
        company_location,
        business_registration
    )
    VALUES (
        NEW.id,
        company_name,
        left(trim(coalesce(NEW.raw_user_meta_data ->> 'representative_name', '')), 100),
        left(lower(trim(coalesce(NEW.email, ''))), 254),
        left(trim(coalesce(NEW.raw_user_meta_data ->> 'contact_phone', '')), 24),
        left(trim(coalesce(NEW.raw_user_meta_data ->> 'company_address', '')), 240),
        left(trim(coalesce(NEW.raw_user_meta_data ->> 'company_location', '')), 120),
        left(trim(coalesce(NEW.raw_user_meta_data ->> 'business_registration', '')), 160)
    )
    ON CONFLICT (company_id) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_company_profile() FROM PUBLIC, anon, authenticated;

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

CREATE OR REPLACE FUNCTION public.submit_company_application(
    p_company_name text,
    p_representative_name text,
    p_official_email text,
    p_contact_phone text,
    p_company_address text,
    p_company_location text,
    p_business_registration text,
    p_business_document_path text,
    p_transport_license_path text,
    p_license_not_applicable boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    current_user_id uuid := (SELECT auth.uid());
    verified_email text;
    email_confirmed_at timestamptz;
    company_status text;
    application_status text;
    clean_company_name text := trim(coalesce(p_company_name, ''));
    clean_representative text := trim(coalesce(p_representative_name, ''));
    clean_email text := lower(trim(coalesce(p_official_email, '')));
    clean_phone text := trim(coalesce(p_contact_phone, ''));
    clean_address text := trim(coalesce(p_company_address, ''));
    clean_location text := trim(coalesce(p_company_location, ''));
    clean_registration text := trim(coalesce(p_business_registration, ''));
BEGIN
    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'Sign in to submit a company application.';
    END IF;

    SELECT lower(users.email), users.email_confirmed_at
      INTO verified_email, email_confirmed_at
      FROM auth.users AS users
     WHERE users.id = current_user_id;

    IF email_confirmed_at IS NULL OR verified_email IS NULL THEN
        RAISE EXCEPTION 'Confirm your company email before submitting the application.';
    END IF;
    IF clean_email <> verified_email THEN
        RAISE EXCEPTION 'Use the verified email address for your company application.';
    END IF;
    IF char_length(clean_company_name) NOT BETWEEN 2 AND 80
        OR char_length(clean_representative) NOT BETWEEN 2 AND 100
        OR char_length(clean_email) NOT BETWEEN 5 AND 254
        OR clean_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
        OR char_length(clean_phone) NOT BETWEEN 7 AND 24
        OR char_length(clean_address) NOT BETWEEN 3 AND 240
        OR char_length(clean_location) NOT BETWEEN 2 AND 120
        OR char_length(clean_registration) NOT BETWEEN 2 AND 160 THEN
        RAISE EXCEPTION 'Complete every required company application field.';
    END IF;
    IF p_business_document_path IS NULL
        OR split_part(p_business_document_path, '/', 1) <> current_user_id::text
        OR NOT EXISTS (
            SELECT 1
            FROM storage.objects AS objects
            WHERE objects.bucket_id = 'company-documents'
              AND objects.name = p_business_document_path
        ) THEN
        RAISE EXCEPTION 'Upload your business registration document.';
    END IF;
    IF NOT coalesce(p_license_not_applicable, false) THEN
        IF p_transport_license_path IS NULL
            OR split_part(p_transport_license_path, '/', 1) <> current_user_id::text
            OR NOT EXISTS (
                SELECT 1
                FROM storage.objects AS objects
                WHERE objects.bucket_id = 'company-documents'
                  AND objects.name = p_transport_license_path
            ) THEN
            RAISE EXCEPTION 'Upload your transport operating licence or confirm that it is not applicable.';
        END IF;
    ELSIF p_transport_license_path IS NOT NULL THEN
        RAISE EXCEPTION 'A transport licence cannot be attached when marked not applicable.';
    END IF;

    SELECT applications.status
      INTO application_status
      FROM public.company_applications AS applications
     WHERE applications.company_id = current_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No company application is associated with this account.';
    END IF;
    SELECT companies.approval_status
      INTO company_status
      FROM public.companies AS companies
     WHERE companies.id = current_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No company profile is associated with this account.';
    END IF;
    IF company_status IN ('approved', 'suspended') THEN
        RAISE EXCEPTION 'This account cannot submit or replace a company application.';
    END IF;

    UPDATE public.companies
       SET name = clean_company_name,
           approval_status = 'pending'
     WHERE id = current_user_id;

    INSERT INTO public.company_applications (
        company_id,
        company_name,
        representative_name,
        official_email,
        contact_phone,
        company_address,
        company_location,
        business_registration,
        business_document_path,
        transport_license_path,
        license_not_applicable,
        status,
        review_notes,
        reviewer_id,
        submitted_at,
        reviewed_at,
        updated_at
    )
    VALUES (
        current_user_id,
        clean_company_name,
        clean_representative,
        clean_email,
        clean_phone,
        clean_address,
        clean_location,
        clean_registration,
        p_business_document_path,
        p_transport_license_path,
        coalesce(p_license_not_applicable, false),
        'pending',
        NULL,
        NULL,
        now(),
        NULL,
        now()
    )
    ON CONFLICT (company_id) DO UPDATE
        SET company_name = EXCLUDED.company_name,
            representative_name = EXCLUDED.representative_name,
            official_email = EXCLUDED.official_email,
            contact_phone = EXCLUDED.contact_phone,
            company_address = EXCLUDED.company_address,
            company_location = EXCLUDED.company_location,
            business_registration = EXCLUDED.business_registration,
            business_document_path = EXCLUDED.business_document_path,
            transport_license_path = EXCLUDED.transport_license_path,
            license_not_applicable = EXCLUDED.license_not_applicable,
            status = 'pending',
            review_notes = NULL,
            reviewer_id = NULL,
            submitted_at = now(),
            reviewed_at = NULL,
            updated_at = now();

    RETURN public.get_company_portal_status();
END;
$$;

REVOKE ALL ON FUNCTION public.submit_company_application(text, text, text, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_company_application(text, text, text, text, text, text, text, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_company_application(
    p_application_id uuid,
    p_status text,
    p_review_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    application public.company_applications%rowtype;
    clean_notes text := trim(coalesce(p_review_notes, ''));
BEGIN
    IF NOT public.is_wayline_admin() THEN
        RAISE EXCEPTION 'Only an authorized Wayline administrator can review applications.';
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('under_review', 'approved', 'rejected', 'suspended') THEN
        RAISE EXCEPTION 'Choose a valid application status.';
    END IF;
    IF char_length(clean_notes) > 2000 THEN
        RAISE EXCEPTION 'Review notes must be 2000 characters or fewer.';
    END IF;
    IF p_status IN ('under_review', 'rejected', 'suspended')
        AND char_length(clean_notes) NOT BETWEEN 3 AND 2000 THEN
        RAISE EXCEPTION 'Add a review note for this status change.';
    END IF;

    SELECT *
      INTO application
      FROM public.company_applications AS applications
     WHERE applications.id = p_application_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The company application was not found.';
    END IF;
    IF application.company_id = (SELECT auth.uid()) THEN
        RAISE EXCEPTION 'Administrators cannot approve or review their own company application.';
    END IF;
    IF application.submitted_at IS NULL THEN
        RAISE EXCEPTION 'The applicant has not completed the application.';
    END IF;
    IF p_status = 'under_review' AND application.status NOT IN ('pending', 'rejected') THEN
        RAISE EXCEPTION 'Only pending or rejected applications can be moved under review.';
    END IF;
    IF p_status = 'rejected' AND application.status NOT IN ('pending', 'under_review', 'rejected') THEN
        RAISE EXCEPTION 'Only pending or under-review applications can be rejected.';
    END IF;
    IF p_status = 'suspended' AND application.status <> 'approved' THEN
        RAISE EXCEPTION 'Only an approved company can be suspended.';
    END IF;
    IF p_status = 'approved'
        AND (
            application.business_document_path IS NULL
            OR NOT EXISTS (
                SELECT 1 FROM storage.objects AS objects
                WHERE objects.bucket_id = 'company-documents'
                  AND objects.name = application.business_document_path
            )
            OR (
                NOT application.license_not_applicable
                AND (
                    application.transport_license_path IS NULL
                    OR NOT EXISTS (
                        SELECT 1 FROM storage.objects AS objects
                        WHERE objects.bucket_id = 'company-documents'
                          AND objects.name = application.transport_license_path
                    )
                )
            )
        ) THEN
        RAISE EXCEPTION 'Required supporting documents are missing.';
    END IF;

    UPDATE public.company_applications
       SET status = p_status,
           review_notes = NULLIF(clean_notes, ''),
           reviewer_id = (SELECT auth.uid()),
           reviewed_at = now(),
           updated_at = now()
     WHERE id = application.id;

    UPDATE public.companies
       SET approval_status = p_status
     WHERE id = application.company_id;

    RETURN jsonb_build_object(
        'application_id', application.id,
        'company_id', application.company_id,
        'status', p_status,
        'review_notes', NULLIF(clean_notes, '')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.review_company_application(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_company_application(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_company_access_status(
    p_company_id uuid,
    p_status text,
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    company_status text;
    clean_reason text := trim(coalesce(p_reason, ''));
BEGIN
    IF NOT public.is_wayline_admin() THEN
        RAISE EXCEPTION 'Only an authorized Wayline administrator can manage company access.';
    END IF;
    IF p_company_id IS NULL OR p_status IS NULL OR p_status NOT IN ('approved', 'suspended') THEN
        RAISE EXCEPTION 'Choose a valid company and access status.';
    END IF;
    IF p_company_id = (SELECT auth.uid()) THEN
        RAISE EXCEPTION 'Administrators cannot change access to their own company account.';
    END IF;
    IF char_length(clean_reason) > 2000
        OR (p_status = 'suspended' AND char_length(clean_reason) NOT BETWEEN 3 AND 2000) THEN
        RAISE EXCEPTION 'Add a suspension reason of 3 to 2000 characters.';
    END IF;

    PERFORM 1
      FROM public.company_applications AS applications
     WHERE applications.company_id = p_company_id
     FOR UPDATE;

    SELECT companies.approval_status
      INTO company_status
      FROM public.companies AS companies
     WHERE companies.id = p_company_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The company account was not found.';
    END IF;
    IF (p_status = 'suspended' AND company_status <> 'approved')
        OR (p_status = 'approved' AND company_status <> 'suspended') THEN
        RAISE EXCEPTION 'Only approved companies can be suspended, and only suspended companies can be reactivated.';
    END IF;

    UPDATE public.company_applications
       SET status = p_status,
           review_notes = NULLIF(clean_reason, ''),
           reviewer_id = (SELECT auth.uid()),
           reviewed_at = now(),
           updated_at = now()
     WHERE company_id = p_company_id;

    UPDATE public.companies
       SET approval_status = p_status
     WHERE id = p_company_id;

    INSERT INTO public.company_activity_log (actor_id, company_id, event_type, record_id, details)
    VALUES (
        (SELECT auth.uid()),
        p_company_id,
        CASE WHEN p_status = 'suspended'
            THEN 'company_account_suspended'
            ELSE 'company_account_reactivated'
        END,
        p_company_id,
        jsonb_build_object('status', p_status, 'reason', NULLIF(clean_reason, ''))
    );

    RETURN jsonb_build_object(
        'company_id', p_company_id,
        'status', p_status,
        'reason', NULLIF(clean_reason, '')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.set_company_access_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_company_access_status(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_company_application_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    event_name text;
    details jsonb;
BEGIN
    IF TG_OP = 'INSERT' THEN
        event_name := CASE WHEN NEW.submitted_at IS NULL
            THEN 'company_application_started'
            ELSE 'company_application_submitted'
        END;
        details := jsonb_build_object('status', NEW.status);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        event_name := 'company_application_status_changed';
        details := jsonb_build_object('from', OLD.status, 'to', NEW.status);
    ELSIF NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
        event_name := 'company_application_submitted';
        details := jsonb_build_object('status', NEW.status);
    ELSIF ROW(
        NEW.company_name,
        NEW.representative_name,
        NEW.official_email,
        NEW.contact_phone,
        NEW.company_address,
        NEW.company_location,
        NEW.business_registration,
        NEW.business_document_path,
        NEW.transport_license_path
    ) IS DISTINCT FROM ROW(
        OLD.company_name,
        OLD.representative_name,
        OLD.official_email,
        OLD.contact_phone,
        OLD.company_address,
        OLD.company_location,
        OLD.business_registration,
        OLD.business_document_path,
        OLD.transport_license_path
    ) THEN
        event_name := 'company_application_updated';
        details := jsonb_build_object('status', NEW.status);
    ELSE
        RETURN NEW;
    END IF;

    INSERT INTO public.company_activity_log (actor_id, company_id, event_type, record_id, details)
    VALUES (
        (SELECT auth.uid()),
        NEW.company_id,
        event_name,
        NEW.id,
        details
    );
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_company_profile_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    event_name text;
BEGIN
    IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
        event_name := 'company_status_changed';
    ELSIF ROW(NEW.name, NEW.logo_data) IS DISTINCT FROM ROW(OLD.name, OLD.logo_data) THEN
        event_name := 'company_profile_updated';
    ELSE
        RETURN NEW;
    END IF;

    INSERT INTO public.company_activity_log (actor_id, company_id, event_type, record_id, details)
    VALUES (
        (SELECT auth.uid()),
        NEW.id,
        event_name,
        NEW.id,
        jsonb_build_object('approval_status', NEW.approval_status)
    );
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_company_schedule_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    company_user_id uuid;
    schedule_id uuid;
    event_name text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        company_user_id := OLD.company_id;
        schedule_id := OLD.id;
        event_name := 'bus_schedule_deleted';
    ELSIF TG_OP = 'INSERT' THEN
        company_user_id := NEW.company_id;
        schedule_id := NEW.id;
        event_name := 'bus_schedule_created';
    ELSE
        IF ROW(
            NEW.name,
            NEW.from_city,
            NEW.to_city,
            NEW.travel_date,
            NEW.departure_time,
            NEW.total_seats,
            NEW.fare,
            NEW.is_active,
            NEW.is_cancelled
        ) IS NOT DISTINCT FROM ROW(
            OLD.name,
            OLD.from_city,
            OLD.to_city,
            OLD.travel_date,
            OLD.departure_time,
            OLD.total_seats,
            OLD.fare,
            OLD.is_active,
            OLD.is_cancelled
        ) THEN
            RETURN NEW;
        END IF;
        company_user_id := NEW.company_id;
        schedule_id := NEW.id;
        event_name := 'bus_schedule_updated';
    END IF;

    INSERT INTO public.company_activity_log (actor_id, company_id, event_type, record_id, details)
    VALUES (
        (SELECT auth.uid()),
        company_user_id,
        event_name,
        schedule_id,
        jsonb_build_object('operation', TG_OP)
    );
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_application_activity_log ON public.company_applications;
CREATE TRIGGER company_application_activity_log
AFTER INSERT OR UPDATE ON public.company_applications
FOR EACH ROW EXECUTE FUNCTION public.log_company_application_activity();

DROP TRIGGER IF EXISTS company_profile_activity_log ON public.companies;
CREATE TRIGGER company_profile_activity_log
AFTER UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.log_company_profile_activity();

DROP TRIGGER IF EXISTS company_schedule_activity_log ON public.buses;
CREATE TRIGGER company_schedule_activity_log
AFTER INSERT OR UPDATE OR DELETE ON public.buses
FOR EACH ROW EXECUTE FUNCTION public.log_company_schedule_activity();

CREATE OR REPLACE FUNCTION public.guard_approved_company_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    company_user_id uuid;
    company_status text;
BEGIN
    company_user_id := NEW.company_id;
    SELECT companies.approval_status
      INTO company_status
      FROM public.companies AS companies
     WHERE companies.id = company_user_id
     FOR SHARE;
    IF NOT FOUND OR company_status IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'Only approved companies can manage schedules.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_approved_company_schedule ON public.buses;
CREATE TRIGGER guard_approved_company_schedule
BEFORE INSERT OR UPDATE ON public.buses
FOR EACH ROW EXECUTE FUNCTION public.guard_approved_company_schedule();

CREATE OR REPLACE FUNCTION public.guard_booking_for_approved_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    bus_company_id uuid;
    company_status text;
BEGIN
    SELECT buses.company_id
      INTO bus_company_id
      FROM public.buses AS buses
     WHERE buses.id = NEW.bus_id;

    IF bus_company_id IS NOT NULL THEN
        SELECT companies.approval_status
          INTO company_status
          FROM public.companies AS companies
         WHERE companies.id = bus_company_id
         FOR SHARE;
    END IF;
    IF bus_company_id IS NULL OR NOT FOUND OR company_status IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'This trip is not available for booking.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_booking_for_approved_company ON public.bookings;
CREATE TRIGGER guard_booking_for_approved_company
BEFORE INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.guard_booking_for_approved_company();

DROP POLICY IF EXISTS "Public can view company profiles" ON public.companies;
DROP POLICY IF EXISTS "Companies can update their own profile" ON public.companies;
DROP POLICY IF EXISTS companies_public_approved_select ON public.companies;
DROP POLICY IF EXISTS companies_owner_select ON public.companies;
DROP POLICY IF EXISTS companies_admin_select ON public.companies;
DROP POLICY IF EXISTS companies_approved_owner_update ON public.companies;

CREATE POLICY companies_public_approved_select
ON public.companies
FOR SELECT
TO anon, authenticated
USING (approval_status = 'approved');

CREATE POLICY companies_owner_select
ON public.companies
FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()));

CREATE POLICY companies_admin_select
ON public.companies
FOR SELECT
TO authenticated
USING (public.is_wayline_admin());

CREATE POLICY companies_approved_owner_update
ON public.companies
FOR UPDATE
TO authenticated
USING (id = (SELECT auth.uid()) AND public.is_approved_company(id))
WITH CHECK (id = (SELECT auth.uid()) AND public.is_approved_company(id));

DROP POLICY IF EXISTS companies_verification_select_guard ON public.companies;
CREATE POLICY companies_verification_select_guard
ON public.companies
AS RESTRICTIVE
FOR SELECT
TO anon, authenticated
USING (
    approval_status = 'approved'
    OR id = (SELECT auth.uid())
    OR public.is_wayline_admin()
);

DROP POLICY IF EXISTS companies_verification_update_guard ON public.companies;
CREATE POLICY companies_verification_update_guard
ON public.companies
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (id = (SELECT auth.uid()) AND public.is_approved_company(id))
WITH CHECK (id = (SELECT auth.uid()) AND public.is_approved_company(id));

DROP POLICY IF EXISTS "Public can view future bus schedules" ON public.buses;
DROP POLICY IF EXISTS "Companies can add their own schedules" ON public.buses;
DROP POLICY IF EXISTS "Companies can update their own schedules" ON public.buses;
DROP POLICY IF EXISTS "Companies can remove their own schedules" ON public.buses;
DROP POLICY IF EXISTS buses_approved_public_or_owner_select ON public.buses;
DROP POLICY IF EXISTS buses_approved_owner_insert ON public.buses;
DROP POLICY IF EXISTS buses_approved_owner_update ON public.buses;
DROP POLICY IF EXISTS buses_approved_owner_delete ON public.buses;

CREATE POLICY buses_approved_public_or_owner_select
ON public.buses
FOR SELECT
TO anon, authenticated
USING (
    public.is_approved_company(company_id)
    AND (
        company_id = (SELECT auth.uid())
        OR (
            travel_date + departure_time > (now() AT TIME ZONE 'Africa/Kigali')
            AND is_active
            AND NOT is_cancelled
            AND available_seats > 0
        )
    )
);

CREATE POLICY buses_approved_owner_insert
ON public.buses
FOR INSERT
TO authenticated
WITH CHECK (
    company_id = (SELECT auth.uid())
    AND public.is_approved_company(company_id)
);

CREATE POLICY buses_approved_owner_update
ON public.buses
FOR UPDATE
TO authenticated
USING (
    company_id = (SELECT auth.uid())
    AND public.is_approved_company(company_id)
)
WITH CHECK (
    company_id = (SELECT auth.uid())
    AND public.is_approved_company(company_id)
);

CREATE POLICY buses_approved_owner_delete
ON public.buses
FOR DELETE
TO authenticated
USING (
    company_id = (SELECT auth.uid())
    AND public.is_approved_company(company_id)
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
        company_id = (SELECT auth.uid())
        OR (
            travel_date + departure_time > (now() AT TIME ZONE 'Africa/Kigali')
            AND is_active
            AND NOT is_cancelled
            AND available_seats > 0
        )
    )
);

DROP POLICY IF EXISTS buses_approval_insert_guard ON public.buses;
CREATE POLICY buses_approval_insert_guard
ON public.buses
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
    company_id = (SELECT auth.uid())
    AND public.is_approved_company(company_id)
);

DROP POLICY IF EXISTS buses_approval_update_guard ON public.buses;
CREATE POLICY buses_approval_update_guard
ON public.buses
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
    company_id = (SELECT auth.uid())
    AND public.is_approved_company(company_id)
)
WITH CHECK (
    company_id = (SELECT auth.uid())
    AND public.is_approved_company(company_id)
);

DROP POLICY IF EXISTS buses_approval_delete_guard ON public.buses;
CREATE POLICY buses_approval_delete_guard
ON public.buses
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
    company_id = (SELECT auth.uid())
    AND public.is_approved_company(company_id)
);

REVOKE ALL ON public.bookings FROM PUBLIC, anon, authenticated;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

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
      AND public.is_approved_company(buses.company_id)
    ORDER BY bookings.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_company_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_bookings() TO authenticated;

DROP POLICY IF EXISTS company_applications_owner_or_admin_select ON public.company_applications;
CREATE POLICY company_applications_owner_or_admin_select
ON public.company_applications
FOR SELECT
TO authenticated
USING (company_id = (SELECT auth.uid()) OR public.is_wayline_admin());

DROP POLICY IF EXISTS company_applications_private_select_guard ON public.company_applications;
CREATE POLICY company_applications_private_select_guard
ON public.company_applications
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (company_id = (SELECT auth.uid()) OR public.is_wayline_admin());

DROP POLICY IF EXISTS company_activity_log_admin_select ON public.company_activity_log;
CREATE POLICY company_activity_log_admin_select
ON public.company_activity_log
FOR SELECT
TO authenticated
USING (public.is_wayline_admin());

DROP POLICY IF EXISTS company_activity_log_private_select_guard ON public.company_activity_log;
CREATE POLICY company_activity_log_private_select_guard
ON public.company_activity_log
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (public.is_wayline_admin());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'company-documents',
    'company-documents',
    false,
    10485760,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS company_documents_owner_or_admin_read ON storage.objects;
CREATE POLICY company_documents_owner_or_admin_read
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'company-documents'
    AND (
        split_part(name, '/', 1) = (SELECT auth.uid())::text
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
            split_part(name, '/', 1) = (SELECT auth.uid())::text
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
        AND EXISTS (
            SELECT 1
            FROM public.company_applications AS applications
            WHERE applications.company_id = (SELECT auth.uid())
              AND applications.status IN ('pending', 'under_review', 'rejected')
        )
    )
);

DROP POLICY IF EXISTS company_documents_private_update_guard ON storage.objects;
CREATE POLICY company_documents_private_update_guard
ON storage.objects
AS RESTRICTIVE
FOR UPDATE
TO anon, authenticated
USING (bucket_id <> 'company-documents')
WITH CHECK (bucket_id <> 'company-documents');

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
        AND EXISTS (
            SELECT 1
            FROM public.company_applications AS applications
            WHERE applications.company_id = (SELECT auth.uid())
              AND applications.status IN ('pending', 'rejected')
        )
    )
);
