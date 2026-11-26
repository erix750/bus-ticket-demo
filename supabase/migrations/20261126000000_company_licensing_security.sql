ALTER TABLE public.company_applications
    ADD COLUMN IF NOT EXISTS rdb_registration_number text,
    ADD COLUMN IF NOT EXISTS tin text,
    ADD COLUMN IF NOT EXISTS transport_license_number text,
    ADD COLUMN IF NOT EXISTS transport_license_type text,
    ADD COLUMN IF NOT EXISTS transport_license_issue_date date,
    ADD COLUMN IF NOT EXISTS transport_license_expiry_date date,
    ADD COLUMN IF NOT EXISTS allowed_routes_areas text,
    ADD COLUMN IF NOT EXISTS representative_id_document_path text,
    ADD COLUMN IF NOT EXISTS registration_checked boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS tin_valid boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS rura_license_valid boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS documents_match boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS verification_reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS verification_reviewer_name text,
    ADD COLUMN IF NOT EXISTS verification_date date;

ALTER TABLE public.buses
    ADD COLUMN IF NOT EXISTS plate_number text,
    ADD COLUMN IF NOT EXISTS insurance_expiry date,
    ADD COLUMN IF NOT EXISTS technical_inspection_expiry date;

ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS wayline_verified boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS transport_license_valid_until date;

GRANT SELECT (wayline_verified, transport_license_valid_until)
ON public.companies TO anon, authenticated;

UPDATE public.company_applications
   SET license_not_applicable = false,
       rdb_registration_number = coalesce(nullif(rdb_registration_number, ''), nullif(business_registration, ''))
 WHERE license_not_applicable
    OR rdb_registration_number IS NULL;

ALTER TABLE public.company_applications
    ALTER COLUMN license_not_applicable SET DEFAULT false;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.company_applications'::regclass
          AND conname = 'company_applications_no_license_exemption'
    ) THEN
        ALTER TABLE public.company_applications
            ADD CONSTRAINT company_applications_no_license_exemption
            CHECK (license_not_applicable = false) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.company_applications'::regclass
          AND conname = 'company_applications_license_date_order'
    ) THEN
        ALTER TABLE public.company_applications
            ADD CONSTRAINT company_applications_license_date_order
            CHECK (
                transport_license_issue_date IS NULL
                OR transport_license_expiry_date IS NULL
                OR transport_license_expiry_date >= transport_license_issue_date
            ) NOT VALID;
    END IF;
END;
$$;

ALTER TABLE public.company_applications
    VALIDATE CONSTRAINT company_applications_no_license_exemption;

CREATE TABLE IF NOT EXISTS public.company_staff (
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, user_id)
);

ALTER TABLE public.company_staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_staff FROM PUBLIC, anon, authenticated;

INSERT INTO public.company_staff (company_id, user_id, role)
SELECT companies.id, companies.id, 'owner'
FROM public.companies AS companies
ON CONFLICT (company_id, user_id) DO UPDATE SET role = 'owner';

CREATE OR REPLACE FUNCTION public.seed_company_owner_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.company_staff (company_id, user_id, role)
    VALUES (NEW.id, NEW.id, 'owner')
    ON CONFLICT (company_id, user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_company_owner_role ON public.companies;
CREATE TRIGGER seed_company_owner_role
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.seed_company_owner_role();

CREATE OR REPLACE FUNCTION public.has_company_role(p_company_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_company_id IS NOT NULL
       AND (SELECT auth.uid()) IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM public.company_staff AS staff
            JOIN auth.users AS users ON users.id = staff.user_id
            WHERE staff.company_id = p_company_id
              AND staff.user_id = (SELECT auth.uid())
              AND staff.role = ANY(p_roles)
              AND users.email_confirmed_at IS NOT NULL
       );
$$;

REVOKE ALL ON FUNCTION public.has_company_role(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_company_role(uuid, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_company_license_valid(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.company_applications AS applications
        JOIN public.companies AS companies ON companies.id = applications.company_id
        WHERE applications.company_id = p_company_id
          AND applications.status = 'approved'
          AND companies.approval_status = 'approved'
          AND nullif(pg_catalog.btrim(applications.rdb_registration_number), '') IS NOT NULL
          AND coalesce(nullif(pg_catalog.btrim(applications.tin), ''), '') ~ '^[0-9]{9}$'
          AND nullif(pg_catalog.btrim(applications.transport_license_number), '') IS NOT NULL
          AND nullif(pg_catalog.btrim(applications.transport_license_type), '') IS NOT NULL
          AND applications.transport_license_issue_date <= current_date
          AND applications.transport_license_expiry_date > current_date
          AND applications.transport_license_expiry_date >= applications.transport_license_issue_date
          AND nullif(pg_catalog.btrim(applications.allowed_routes_areas), '') IS NOT NULL
          AND applications.business_document_path IS NOT NULL
          AND applications.transport_license_path IS NOT NULL
          AND applications.representative_id_document_path IS NOT NULL
          AND applications.registration_checked
          AND applications.tin_valid
          AND applications.rura_license_valid
          AND applications.documents_match
          AND NOT applications.license_not_applicable
          AND EXISTS (
              SELECT 1 FROM storage.objects AS objects
              WHERE objects.bucket_id = 'company-documents'
                AND objects.name = applications.business_document_path
          )
          AND EXISTS (
              SELECT 1 FROM storage.objects AS objects
              WHERE objects.bucket_id = 'company-documents'
                AND objects.name = applications.transport_license_path
          )
          AND EXISTS (
              SELECT 1 FROM storage.objects AS objects
              WHERE objects.bucket_id = 'company-documents'
                AND objects.name = applications.representative_id_document_path
          )
    );
$$;

REVOKE ALL ON FUNCTION public.is_company_license_valid(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_company_license_valid(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_verified_approved_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.has_company_role(p_company_id, ARRAY['owner', 'manager'])
       AND public.is_company_license_valid(p_company_id)
   AND coalesce((auth.jwt() ->> 'aal') = 'aal2', false);
$$;

REVOKE ALL ON FUNCTION public.is_verified_approved_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_verified_approved_company(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_company_verification_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.companies
       SET wayline_verified = NEW.status = 'approved'
           AND NEW.transport_license_expiry_date > current_date
           AND NEW.registration_checked
           AND NEW.tin_valid
           AND NEW.rura_license_valid
           AND NEW.documents_match
           AND NOT NEW.license_not_applicable,
           transport_license_valid_until = NEW.transport_license_expiry_date
     WHERE id = NEW.company_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_company_verification_status ON public.company_applications;
CREATE TRIGGER sync_company_verification_status
AFTER INSERT OR UPDATE OF status, rdb_registration_number, tin, transport_license_number,
    transport_license_type, transport_license_issue_date, transport_license_expiry_date,
    allowed_routes_areas, business_document_path, transport_license_path,
    representative_id_document_path, registration_checked, tin_valid,
    rura_license_valid, documents_match, license_not_applicable
ON public.company_applications
FOR EACH ROW EXECUTE FUNCTION public.sync_company_verification_status();

CREATE OR REPLACE FUNCTION public.verify_company_application(
    p_application_id uuid,
    p_registration_checked boolean,
    p_tin_valid boolean,
    p_rura_license_valid boolean,
    p_documents_match boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    application public.company_applications%rowtype;
    reviewer_name text;
BEGIN
    IF NOT public.is_wayline_admin() THEN
        RAISE EXCEPTION 'Only an authenticated Wayline administrator can verify company documents.';
    END IF;
    SELECT * INTO application
      FROM public.company_applications
     WHERE id = p_application_id
     FOR UPDATE;
    IF NOT FOUND OR application.submitted_at IS NULL THEN
        RAISE EXCEPTION 'The submitted company application was not found.';
    END IF;
    IF application.company_id = (SELECT auth.uid()) THEN
        RAISE EXCEPTION 'Administrators cannot verify their own company application.';
    END IF;
    IF coalesce(application.tin, '') !~ '^[0-9]{9}$'
        OR nullif(pg_catalog.btrim(application.rdb_registration_number), '') IS NULL
        OR nullif(pg_catalog.btrim(application.transport_license_number), '') IS NULL
        OR nullif(pg_catalog.btrim(application.transport_license_type), '') IS NULL
        OR nullif(pg_catalog.btrim(application.allowed_routes_areas), '') IS NULL
        OR application.transport_license_issue_date IS NULL
        OR application.transport_license_issue_date > current_date
        OR application.transport_license_expiry_date IS NULL
        OR application.transport_license_expiry_date <= current_date THEN
        RAISE EXCEPTION 'The TIN or transport licence dates are invalid or expired.';
    END IF;
    reviewer_name := coalesce(
        nullif(pg_catalog.btrim(auth.jwt() ->> 'email'), ''),
        (SELECT auth.uid())::text
    );

    UPDATE public.company_applications
       SET registration_checked = coalesce(p_registration_checked, false),
           tin_valid = coalesce(p_tin_valid, false),
           rura_license_valid = coalesce(p_rura_license_valid, false),
           documents_match = coalesce(p_documents_match, false),
           verification_reviewer_id = (SELECT auth.uid()),
           verification_reviewer_name = reviewer_name,
           verification_date = current_date,
           updated_at = now()
     WHERE id = application.id;

    INSERT INTO public.company_activity_log (actor_id, company_id, event_type, record_id, details)
    VALUES (
        (SELECT auth.uid()),
        application.company_id,
        'company_verification_checklist_saved',
        application.id,
        jsonb_build_object(
            'registration_checked', coalesce(p_registration_checked, false),
            'tin_valid', coalesce(p_tin_valid, false),
            'rura_license_valid', coalesce(p_rura_license_valid, false),
            'documents_match', coalesce(p_documents_match, false),
            'reviewer_name', reviewer_name,
            'verification_date', current_date
        )
    );
    RETURN jsonb_build_object('application_id', application.id, 'reviewer_name', reviewer_name);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_company_application(uuid, boolean, boolean, boolean, boolean)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_company_application(uuid, boolean, boolean, boolean, boolean)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_company_application_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.status = 'approved' AND (
        NOT NEW.registration_checked
        OR NOT NEW.tin_valid
        OR NOT NEW.rura_license_valid
        OR NOT NEW.documents_match
        OR NEW.license_not_applicable
        OR NEW.transport_license_issue_date IS NULL
        OR NEW.transport_license_issue_date > current_date
        OR NEW.transport_license_expiry_date IS NULL
        OR NEW.transport_license_expiry_date <= current_date
        OR NEW.transport_license_expiry_date < NEW.transport_license_issue_date
        OR coalesce(NEW.tin, '') !~ '^[0-9]{9}$'
        OR nullif(pg_catalog.btrim(NEW.rdb_registration_number), '') IS NULL
        OR nullif(pg_catalog.btrim(NEW.transport_license_number), '') IS NULL
        OR nullif(pg_catalog.btrim(NEW.transport_license_type), '') IS NULL
        OR nullif(pg_catalog.btrim(NEW.allowed_routes_areas), '') IS NULL
        OR NEW.business_document_path IS NULL
        OR NEW.transport_license_path IS NULL
        OR NEW.representative_id_document_path IS NULL
        OR NOT EXISTS (
            SELECT 1 FROM storage.objects
            WHERE bucket_id = 'company-documents' AND name = NEW.business_document_path
        )
        OR NOT EXISTS (
            SELECT 1 FROM storage.objects
            WHERE bucket_id = 'company-documents' AND name = NEW.transport_license_path
        )
        OR NOT EXISTS (
            SELECT 1 FROM storage.objects
            WHERE bucket_id = 'company-documents' AND name = NEW.representative_id_document_path
        )
    ) THEN
        RAISE EXCEPTION 'Complete the manual verification checklist and provide a valid, unexpired licence before approval.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_company_application_approval ON public.company_applications;
CREATE TRIGGER guard_company_application_approval
BEFORE INSERT OR UPDATE OF status ON public.company_applications
FOR EACH ROW EXECUTE FUNCTION public.guard_company_application_approval();

DROP FUNCTION IF EXISTS public.submit_company_application(text, text, text, text, text, text, text, text, text, boolean);
CREATE FUNCTION public.submit_company_application(
    p_company_name text,
    p_representative_name text,
    p_official_email text,
    p_contact_phone text,
    p_company_address text,
    p_company_location text,
    p_rdb_registration_number text,
    p_tin text,
    p_transport_license_number text,
    p_transport_license_type text,
    p_transport_license_issue_date date,
    p_transport_license_expiry_date date,
    p_allowed_routes_areas text,
    p_business_document_path text,
    p_transport_license_path text,
    p_representative_id_document_path text
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
    clean_company_name text := pg_catalog.btrim(coalesce(p_company_name, ''));
    clean_representative text := pg_catalog.btrim(coalesce(p_representative_name, ''));
    clean_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_official_email, '')));
    clean_phone text := pg_catalog.btrim(coalesce(p_contact_phone, ''));
    clean_address text := pg_catalog.btrim(coalesce(p_company_address, ''));
    clean_location text := pg_catalog.btrim(coalesce(p_company_location, ''));
    clean_rdb text := pg_catalog.btrim(coalesce(p_rdb_registration_number, ''));
    clean_tin text := pg_catalog.btrim(coalesce(p_tin, ''));
    clean_license_number text := pg_catalog.btrim(coalesce(p_transport_license_number, ''));
    clean_license_type text := pg_catalog.btrim(coalesce(p_transport_license_type, ''));
    clean_allowed_routes text := pg_catalog.btrim(coalesce(p_allowed_routes_areas, ''));
    document_path text;
BEGIN
    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'Sign in to submit a company application.';
    END IF;
    SELECT lower(users.email), users.email_confirmed_at
      INTO verified_email, email_confirmed_at
      FROM auth.users AS users
     WHERE users.id = current_user_id;
    IF email_confirmed_at IS NULL OR verified_email IS NULL OR clean_email <> verified_email THEN
        RAISE EXCEPTION 'Use the confirmed account email for your company application.';
    END IF;
    IF char_length(clean_company_name) NOT BETWEEN 2 AND 80
        OR char_length(clean_representative) NOT BETWEEN 2 AND 100
        OR char_length(clean_email) NOT BETWEEN 5 AND 254
        OR NOT public.is_valid_company_email(clean_email)
        OR char_length(clean_phone) NOT BETWEEN 7 AND 24
        OR char_length(clean_address) NOT BETWEEN 3 AND 240
        OR char_length(clean_location) NOT BETWEEN 2 AND 120
        OR char_length(clean_rdb) NOT BETWEEN 2 AND 80
        OR clean_tin !~ '^[0-9]{9}$'
        OR char_length(clean_license_number) NOT BETWEEN 2 AND 100
        OR char_length(clean_license_type) NOT BETWEEN 2 AND 80
        OR char_length(clean_allowed_routes) NOT BETWEEN 2 AND 1000 THEN
        RAISE EXCEPTION 'Complete all required company, registration, tax, and licence fields.';
    END IF;
    IF p_transport_license_issue_date IS NULL
        OR p_transport_license_issue_date > current_date
        OR p_transport_license_expiry_date IS NULL
        OR p_transport_license_expiry_date <= current_date
        OR p_transport_license_expiry_date < p_transport_license_issue_date THEN
        RAISE EXCEPTION 'Enter a valid issue date and a future transport licence expiry date.';
    END IF;
    FOREACH document_path IN ARRAY ARRAY[
        p_business_document_path,
        p_transport_license_path,
        p_representative_id_document_path
    ] LOOP
        IF document_path IS NULL
            OR pg_catalog.split_part(document_path, '/', 1) <> current_user_id::text
            OR NOT EXISTS (
                SELECT 1 FROM storage.objects AS objects
                WHERE objects.bucket_id = 'company-documents'
                  AND objects.name = document_path
            ) THEN
            RAISE EXCEPTION 'Upload all three required company documents to private storage.';
        END IF;
    END LOOP;

    SELECT companies.approval_status
      INTO company_status
      FROM public.companies AS companies
     WHERE companies.id = current_user_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No company profile is associated with this account.';
    END IF;
    IF company_status IN ('approved', 'suspended') THEN
        RAISE EXCEPTION 'Use the licence renewal process for an existing approved company.';
    END IF;
    UPDATE public.companies
       SET name = clean_company_name,
           approval_status = 'pending'
     WHERE id = current_user_id;

    INSERT INTO public.company_applications (
        company_id, company_name, representative_name, official_email, contact_phone,
        company_address, company_location, business_registration, rdb_registration_number,
        tin, transport_license_number, transport_license_type, transport_license_issue_date,
        transport_license_expiry_date, allowed_routes_areas, business_document_path,
        transport_license_path, representative_id_document_path, license_not_applicable,
        registration_checked, tin_valid, rura_license_valid, documents_match, status,
        review_notes, reviewer_id, verification_reviewer_id, verification_reviewer_name,
        verification_date, submitted_at, reviewed_at, updated_at
    )
    VALUES (
        current_user_id, clean_company_name, clean_representative, clean_email, clean_phone,
        clean_address, clean_location, clean_rdb, clean_rdb, clean_tin, clean_license_number,
        clean_license_type, p_transport_license_issue_date, p_transport_license_expiry_date,
        clean_allowed_routes, p_business_document_path, p_transport_license_path,
        p_representative_id_document_path, false, false, false, false, false, 'pending',
        NULL, NULL, NULL, NULL, NULL, now(), NULL, now()
    )
    ON CONFLICT (company_id) DO UPDATE
        SET company_name = EXCLUDED.company_name,
            representative_name = EXCLUDED.representative_name,
            official_email = EXCLUDED.official_email,
            contact_phone = EXCLUDED.contact_phone,
            company_address = EXCLUDED.company_address,
            company_location = EXCLUDED.company_location,
            business_registration = EXCLUDED.business_registration,
            rdb_registration_number = EXCLUDED.rdb_registration_number,
            tin = EXCLUDED.tin,
            transport_license_number = EXCLUDED.transport_license_number,
            transport_license_type = EXCLUDED.transport_license_type,
            transport_license_issue_date = EXCLUDED.transport_license_issue_date,
            transport_license_expiry_date = EXCLUDED.transport_license_expiry_date,
            allowed_routes_areas = EXCLUDED.allowed_routes_areas,
            business_document_path = EXCLUDED.business_document_path,
            transport_license_path = EXCLUDED.transport_license_path,
            representative_id_document_path = EXCLUDED.representative_id_document_path,
            license_not_applicable = false,
            registration_checked = false,
            tin_valid = false,
            rura_license_valid = false,
            documents_match = false,
            verification_reviewer_id = NULL,
            verification_reviewer_name = NULL,
            verification_date = NULL,
            status = 'pending',
            review_notes = NULL,
            reviewer_id = NULL,
            submitted_at = now(),
            reviewed_at = NULL,
            updated_at = now();
    RETURN public.get_company_portal_status();
END;
$$;

REVOKE ALL ON FUNCTION public.submit_company_application(
    text, text, text, text, text, text, text, text, text, text, date, date, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_company_application(
    text, text, text, text, text, text, text, text, text, text, date, date, text, text, text, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.renew_company_licence(
    p_rdb_registration_number text,
    p_tin text,
    p_transport_license_number text,
    p_transport_license_type text,
    p_transport_license_issue_date date,
    p_transport_license_expiry_date date,
    p_allowed_routes_areas text,
    p_business_document_path text,
    p_transport_license_path text,
    p_representative_id_document_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    target_company_id uuid;
    application public.company_applications%rowtype;
    uploader_id uuid := (SELECT auth.uid());
    document_path text;
BEGIN
    SELECT staff.company_id INTO target_company_id
      FROM public.company_staff AS staff
     WHERE staff.user_id = uploader_id
       AND staff.role IN ('owner', 'manager')
     ORDER BY CASE staff.role WHEN 'owner' THEN 0 ELSE 1 END
     LIMIT 1
     FOR UPDATE;
    IF target_company_id IS NULL OR coalesce((auth.jwt() ->> 'aal'), '') <> 'aal2' THEN
        RAISE EXCEPTION 'A verified owner or manager with two-step authentication is required to renew a licence.';
    END IF;
    IF NOT public.is_verified_company_email() THEN
        RAISE EXCEPTION 'Confirm the company account email before renewing a licence.';
    END IF;
    IF coalesce(p_tin, '') !~ '^[0-9]{9}$'
        OR nullif(pg_catalog.btrim(p_rdb_registration_number), '') IS NULL
        OR nullif(pg_catalog.btrim(p_transport_license_number), '') IS NULL
        OR nullif(pg_catalog.btrim(p_transport_license_type), '') IS NULL
        OR nullif(pg_catalog.btrim(p_allowed_routes_areas), '') IS NULL
        OR p_transport_license_issue_date IS NULL
        OR p_transport_license_issue_date > current_date
        OR p_transport_license_expiry_date IS NULL
        OR p_transport_license_expiry_date <= current_date
        OR p_transport_license_expiry_date < p_transport_license_issue_date THEN
        RAISE EXCEPTION 'Enter a valid TIN, licence number, type, route area, and future licence dates.';
    END IF;
    FOREACH document_path IN ARRAY ARRAY[
        p_business_document_path,
        p_transport_license_path,
        p_representative_id_document_path
    ] LOOP
        IF document_path IS NULL
            OR pg_catalog.split_part(document_path, '/', 1) <> uploader_id::text
            OR NOT EXISTS (
                SELECT 1 FROM storage.objects AS objects
                WHERE objects.bucket_id = 'company-documents'
                  AND objects.name = document_path
            ) THEN
            RAISE EXCEPTION 'Upload a new transport licence and representative ID document.';
        END IF;
    END LOOP;
    SELECT * INTO application
      FROM public.company_applications
     WHERE company_applications.company_id = target_company_id
     FOR UPDATE;
    IF NOT FOUND OR application.status NOT IN ('approved', 'under_review') THEN
        RAISE EXCEPTION 'Only an approved company can renew a transport licence.';
    END IF;
    UPDATE public.company_applications
       SET business_registration = pg_catalog.btrim(p_rdb_registration_number),
           rdb_registration_number = pg_catalog.btrim(p_rdb_registration_number),
           tin = pg_catalog.btrim(p_tin),
           transport_license_number = pg_catalog.btrim(p_transport_license_number),
           transport_license_type = pg_catalog.btrim(p_transport_license_type),
           transport_license_issue_date = p_transport_license_issue_date,
           transport_license_expiry_date = p_transport_license_expiry_date,
           allowed_routes_areas = pg_catalog.btrim(p_allowed_routes_areas),
           business_document_path = p_business_document_path,
           transport_license_path = p_transport_license_path,
           representative_id_document_path = p_representative_id_document_path,
           registration_checked = false,
           tin_valid = false,
           rura_license_valid = false,
           documents_match = false,
           verification_reviewer_id = NULL,
           verification_reviewer_name = NULL,
           verification_date = NULL,
           status = 'under_review',
           review_notes = NULL,
           reviewer_id = NULL,
           reviewed_at = NULL,
           updated_at = now()
     WHERE id = application.id;
    RETURN public.get_company_portal_status();
END;
$$;

REVOKE ALL ON FUNCTION public.renew_company_licence(text, text, text, text, date, date, text, text, text, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_company_licence(text, text, text, text, date, date, text, text, text, text)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.set_company_staff_role(p_email text, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    company_id uuid := (SELECT auth.uid());
    target_user_id uuid;
BEGIN
    IF p_role IS NULL
        OR p_role NOT IN ('manager', 'cashier')
        OR coalesce((auth.jwt() ->> 'aal'), '') <> 'aal2'
        OR NOT public.has_company_role(company_id, ARRAY['owner']) THEN
        RAISE EXCEPTION 'Only the company owner using two-step authentication can assign staff roles.';
    END IF;
    SELECT users.id INTO target_user_id
      FROM auth.users AS users
     WHERE lower(users.email) = lower(pg_catalog.btrim(p_email))
       AND users.email_confirmed_at IS NOT NULL;
    IF target_user_id IS NULL OR target_user_id = company_id THEN
        RAISE EXCEPTION 'Enter the confirmed email address of another existing Wayline account.';
    END IF;
    INSERT INTO public.company_staff (company_id, user_id, role)
    VALUES (company_id, target_user_id, p_role)
    ON CONFLICT (company_id, user_id) DO UPDATE SET role = EXCLUDED.role;
    INSERT INTO public.company_activity_log (actor_id, company_id, event_type, details)
    VALUES (
        (SELECT auth.uid()), company_id, 'company_staff_role_assigned',
        jsonb_build_object('user_id', target_user_id, 'role', p_role)
    );
    RETURN jsonb_build_object('company_id', company_id, 'user_id', target_user_id, 'role', p_role);
END;
$$;

REVOKE ALL ON FUNCTION public.set_company_staff_role(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_company_staff_role(text, text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.company_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    category text NOT NULL CHECK (category IN ('safety', 'service', 'vehicle', 'licence', 'other')),
    details text NOT NULL CHECK (char_length(pg_catalog.btrim(details)) BETWEEN 10 AND 2000),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
    reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    review_notes text CHECK (review_notes IS NULL OR char_length(review_notes) <= 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz
);

ALTER TABLE public.company_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.company_reports TO authenticated;

CREATE POLICY company_reports_wayline_admin_select
ON public.company_reports FOR SELECT TO authenticated
USING (public.is_wayline_admin());

CREATE OR REPLACE FUNCTION public.report_booking_company(
    p_booking_id uuid,
    p_category text,
    p_details text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    booking public.bookings%rowtype;
    report_id uuid;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION 'Verify your booking phone number before reporting a company.';
    END IF;
    IF p_category NOT IN ('safety', 'service', 'vehicle', 'licence', 'other')
        OR char_length(pg_catalog.btrim(coalesce(p_details, ''))) NOT BETWEEN 10 AND 2000 THEN
        RAISE EXCEPTION 'Choose a report category and provide 10 to 2000 characters of detail.';
    END IF;
    SELECT * INTO booking
      FROM public.bookings
     WHERE id = p_booking_id
        AND pg_catalog.regexp_replace(passenger_phone, '[^0-9]', '', 'g')
            = pg_catalog.regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '[^0-9]', '', 'g')
     FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The verified booking could not be matched to the signed-in passenger.';
    END IF;
    INSERT INTO public.company_reports (company_id, booking_id, category, details)
    VALUES (
        (SELECT buses.company_id FROM public.buses AS buses WHERE buses.id = booking.bus_id),
        booking.id, p_category, pg_catalog.btrim(p_details)
    )
    RETURNING id INTO report_id;
    RETURN report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.report_booking_company(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_booking_company(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_company_report(p_report_id uuid, p_status text, p_notes text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.is_wayline_admin()
        OR p_status NOT IN ('reviewing', 'resolved', 'dismissed')
        OR char_length(pg_catalog.btrim(coalesce(p_notes, ''))) > 2000 THEN
        RAISE EXCEPTION 'Only an authenticated Wayline administrator can review a report.';
    END IF;
    UPDATE public.company_reports
       SET status = p_status,
           reviewer_id = (SELECT auth.uid()),
           review_notes = nullif(pg_catalog.btrim(p_notes), ''),
           reviewed_at = now()
     WHERE id = p_report_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The company report was not found.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_company_report(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_company_report(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_company_portal_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    active_company_id uuid;
    active_role text;
    result jsonb;
BEGIN
    IF (SELECT auth.uid()) IS NULL OR NOT public.is_verified_company_email() THEN
        RAISE EXCEPTION 'Sign in and confirm your company account email before accessing company management.';
    END IF;
    SELECT staff.company_id, staff.role
      INTO active_company_id, active_role
      FROM public.company_staff AS staff
     WHERE staff.user_id = (SELECT auth.uid())
     ORDER BY CASE staff.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END
     LIMIT 1;
    IF active_company_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT jsonb_build_object(
        'company_id', companies.id,
        'company_name', companies.name,
        'logo_data', companies.logo_data,
        'approval_status', companies.approval_status,
        'application_status', coalesce(applications.status, companies.approval_status),
        'company_role', active_role,
        'wayline_verified', companies.wayline_verified
            AND applications.transport_license_expiry_date > current_date,
        'transport_license_expiry_date', applications.transport_license_expiry_date,
        'license_days_remaining', applications.transport_license_expiry_date - current_date,
        'representative_name', applications.representative_name,
        'official_email', applications.official_email,
        'contact_phone', applications.contact_phone,
        'company_address', applications.company_address,
        'company_location', applications.company_location,
        'business_registration', applications.rdb_registration_number,
        'rdb_registration_number', applications.rdb_registration_number,
        'tin', applications.tin,
        'transport_license_number', applications.transport_license_number,
        'transport_license_type', applications.transport_license_type,
        'transport_license_issue_date', applications.transport_license_issue_date,
        'transport_license_expiry_date', applications.transport_license_expiry_date,
        'allowed_routes_areas', applications.allowed_routes_areas,
        'business_document_path', applications.business_document_path,
        'transport_license_path', applications.transport_license_path,
        'representative_id_document_path', applications.representative_id_document_path,
        'registration_checked', applications.registration_checked,
        'tin_valid', applications.tin_valid,
        'rura_license_valid', applications.rura_license_valid,
        'documents_match', applications.documents_match,
        'verification_reviewer_name', applications.verification_reviewer_name,
        'verification_date', applications.verification_date,
        'review_notes', applications.review_notes,
        'submitted_at', applications.submitted_at
    )
      INTO result
      FROM public.companies AS companies
      LEFT JOIN public.company_applications AS applications
        ON applications.company_id = companies.id
     WHERE companies.id = active_company_id;
    IF active_role = 'cashier' THEN
        RETURN result - ARRAY[
            'representative_name', 'official_email', 'contact_phone', 'company_address',
            'company_location', 'business_registration', 'rdb_registration_number', 'tin',
            'transport_license_number', 'transport_license_type', 'transport_license_issue_date',
            'transport_license_expiry_date', 'allowed_routes_areas', 'business_document_path',
            'transport_license_path', 'representative_id_document_path', 'registration_checked',
            'tin_valid', 'rura_license_valid', 'documents_match', 'verification_reviewer_name',
            'verification_date', 'review_notes', 'submitted_at'
        ]::text[];
    END IF;
    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_portal_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_portal_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_approved_company_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.is_verified_approved_company(NEW.company_id) THEN
        RAISE EXCEPTION 'Only a verified owner or manager with a current licence and two-step authentication can manage schedules.';
    END IF;
    IF nullif(pg_catalog.btrim(NEW.plate_number), '') IS NULL
        OR NEW.insurance_expiry IS NULL
        OR NEW.technical_inspection_expiry IS NULL
        OR NEW.insurance_expiry < NEW.travel_date
        OR NEW.technical_inspection_expiry < NEW.travel_date THEN
        RAISE EXCEPTION 'Enter the vehicle plate number and ensure insurance and technical inspection cover the entire trip date.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_company_booking_compliance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    bus_record public.buses%rowtype;
BEGIN
    SELECT * INTO bus_record
      FROM public.buses
     WHERE id = NEW.bus_id;
    IF NOT FOUND
        OR NOT public.is_company_license_valid(bus_record.company_id)
        OR bus_record.plate_number IS NULL
        OR bus_record.insurance_expiry IS NULL
        OR bus_record.technical_inspection_expiry IS NULL
        OR bus_record.insurance_expiry < bus_record.travel_date
        OR bus_record.technical_inspection_expiry < bus_record.travel_date
        OR bus_record.insurance_expiry < current_date
        OR bus_record.technical_inspection_expiry < current_date THEN
        RAISE EXCEPTION 'This company or vehicle is not currently verified and cannot accept bookings.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_company_booking_compliance ON public.bookings;
CREATE TRIGGER guard_company_booking_compliance
BEFORE INSERT OR UPDATE OF bus_id ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.guard_company_booking_compliance();

DROP POLICY IF EXISTS companies_owner_select ON public.companies;
DROP POLICY IF EXISTS companies_approved_owner_update ON public.companies;
DROP POLICY IF EXISTS companies_verification_select_guard ON public.companies;
DROP POLICY IF EXISTS companies_verification_update_guard ON public.companies;
CREATE POLICY companies_company_staff_select
ON public.companies FOR SELECT TO authenticated
USING (public.has_company_role(id, ARRAY['owner', 'manager', 'cashier']) OR public.is_wayline_admin());
CREATE POLICY companies_company_staff_update
ON public.companies FOR UPDATE TO authenticated
USING (public.is_verified_approved_company(id))
WITH CHECK (public.is_verified_approved_company(id));
CREATE POLICY companies_company_staff_select_guard
ON public.companies AS RESTRICTIVE FOR SELECT TO anon, authenticated
USING (
    approval_status = 'approved'
    OR public.has_company_role(id, ARRAY['owner', 'manager', 'cashier'])
    OR public.is_wayline_admin()
);
CREATE POLICY companies_company_staff_update_guard
ON public.companies AS RESTRICTIVE FOR UPDATE TO authenticated
USING (public.is_verified_approved_company(id))
WITH CHECK (public.is_verified_approved_company(id));

DROP POLICY IF EXISTS buses_approved_public_or_owner_select ON public.buses;
DROP POLICY IF EXISTS buses_approval_select_guard ON public.buses;
DROP POLICY IF EXISTS buses_approved_owner_insert ON public.buses;
DROP POLICY IF EXISTS buses_approval_insert_guard ON public.buses;
DROP POLICY IF EXISTS buses_approved_owner_update ON public.buses;
DROP POLICY IF EXISTS buses_approval_update_guard ON public.buses;
DROP POLICY IF EXISTS buses_approved_owner_delete ON public.buses;
DROP POLICY IF EXISTS buses_approval_delete_guard ON public.buses;

CREATE POLICY buses_license_public_or_staff_select
ON public.buses FOR SELECT TO anon, authenticated
USING (
    (
        public.has_company_role(company_id, ARRAY['owner', 'manager', 'cashier'])
        OR (
            public.is_company_license_valid(company_id)
            AND travel_date + departure_time > (now() AT TIME ZONE 'Africa/Kigali')
            AND travel_date >= current_date
            AND is_active
            AND NOT is_cancelled
            AND available_seats > 0
            AND insurance_expiry >= travel_date
            AND technical_inspection_expiry >= travel_date
        )
    )
);
CREATE POLICY buses_license_staff_select_guard
ON public.buses AS RESTRICTIVE FOR SELECT TO anon, authenticated
USING (
    public.has_company_role(company_id, ARRAY['owner', 'manager', 'cashier'])
    OR (
        public.is_company_license_valid(company_id)
        AND travel_date + departure_time > (now() AT TIME ZONE 'Africa/Kigali')
        AND travel_date >= current_date
        AND is_active
        AND NOT is_cancelled
        AND available_seats > 0
        AND insurance_expiry >= travel_date
        AND technical_inspection_expiry >= travel_date
    )
);
CREATE POLICY buses_license_manager_insert
ON public.buses FOR INSERT TO authenticated
WITH CHECK (public.is_verified_approved_company(company_id));
CREATE POLICY buses_license_manager_update
ON public.buses FOR UPDATE TO authenticated
USING (public.is_verified_approved_company(company_id))
WITH CHECK (public.is_verified_approved_company(company_id));
CREATE POLICY buses_license_manager_delete
ON public.buses FOR DELETE TO authenticated
USING (public.is_verified_approved_company(company_id));

DROP POLICY IF EXISTS company_applications_owner_or_admin_select ON public.company_applications;
DROP POLICY IF EXISTS company_applications_private_select_guard ON public.company_applications;
CREATE POLICY company_applications_company_manager_select
ON public.company_applications FOR SELECT TO authenticated
USING (
    public.has_company_role(company_id, ARRAY['owner', 'manager'])
    OR public.is_wayline_admin()
);
CREATE POLICY company_applications_company_manager_select_guard
ON public.company_applications AS RESTRICTIVE FOR SELECT TO authenticated
USING (
    public.has_company_role(company_id, ARRAY['owner', 'manager'])
    OR public.is_wayline_admin()
);

DROP POLICY IF EXISTS company_documents_owner_or_admin_read ON storage.objects;
CREATE POLICY company_documents_owner_or_admin_read
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'company-documents'
    AND (
        split_part(name, '/', 1) = (SELECT auth.uid())::text
        OR public.has_company_role(
            CASE
                WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN split_part(name, '/', 1)::uuid
                ELSE NULL
            END,
            ARRAY['owner', 'manager']
        )
        OR EXISTS (
            SELECT 1
            FROM public.company_applications AS applications
            WHERE (
                applications.business_document_path = name
                OR applications.transport_license_path = name
                OR applications.representative_id_document_path = name
            )
              AND public.has_company_role(applications.company_id, ARRAY['owner', 'manager'])
        )
        OR public.is_wayline_admin()
    )
);

DROP POLICY IF EXISTS company_documents_private_select_guard ON storage.objects;
CREATE POLICY company_documents_private_select_guard
ON storage.objects AS RESTRICTIVE
FOR SELECT TO anon, authenticated
USING (
    bucket_id <> 'company-documents'
    OR (
        auth.role() = 'authenticated'
        AND (
            split_part(name, '/', 1) = (SELECT auth.uid())::text
            OR public.has_company_role(
                CASE
                    WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN split_part(name, '/', 1)::uuid
                    ELSE NULL
                END,
                ARRAY['owner', 'manager']
            )
            OR EXISTS (
                SELECT 1
                FROM public.company_applications AS applications
                WHERE (
                    applications.business_document_path = name
                    OR applications.transport_license_path = name
                    OR applications.representative_id_document_path = name
                )
                  AND public.has_company_role(applications.company_id, ARRAY['owner', 'manager'])
            )
            OR public.is_wayline_admin()
        )
    )
);

DROP POLICY IF EXISTS company_documents_private_insert_guard ON storage.objects;
CREATE POLICY company_documents_private_insert_guard
ON storage.objects AS RESTRICTIVE
FOR INSERT TO anon, authenticated
WITH CHECK (
    bucket_id <> 'company-documents'
    OR (
        auth.role() = 'authenticated'
        AND split_part(name, '/', 1) = (SELECT auth.uid())::text
        AND EXISTS (
            SELECT 1
            FROM public.company_applications AS applications
            WHERE (
                applications.company_id = (SELECT auth.uid())
                OR public.has_company_role(applications.company_id, ARRAY['owner', 'manager'])
            )
              AND applications.status IN ('pending', 'under_review', 'rejected', 'approved')
        )
    )
);

DROP POLICY IF EXISTS company_documents_staff_upload ON storage.objects;
CREATE POLICY company_documents_staff_upload
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'company-documents'
    AND split_part(name, '/', 1) = (SELECT auth.uid())::text
    AND EXISTS (
        SELECT 1
        FROM public.company_applications AS applications
        WHERE public.has_company_role(applications.company_id, ARRAY['owner', 'manager'])
          AND applications.status IN ('pending', 'under_review', 'rejected', 'approved')
    )
);

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
        'passenger_names', coalesce(bookings.passenger_names, array_fill(bookings.passenger_name, ARRAY[bookings.seat_count])),
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
        'cancelled', bookings.cancelled,
        'reservation_expires_at', bookings.reservation_expires_at,
        'expired_at', bookings.expired_at
    )
    FROM public.bookings AS bookings
    JOIN public.buses AS buses ON buses.id = bookings.bus_id
    JOIN public.companies AS companies ON companies.id = buses.company_id
    WHERE public.has_company_role(buses.company_id, ARRAY['owner', 'manager', 'cashier'])
    ORDER BY bookings.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_company_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_bookings() TO authenticated;

CREATE OR REPLACE FUNCTION public.log_company_report_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.company_activity_log (actor_id, company_id, event_type, record_id, details)
    VALUES (
        NEW.reviewer_id,
        NEW.company_id,
        'passenger_company_report_' || NEW.status,
        NEW.id,
        jsonb_build_object('category', NEW.category, 'review_notes', NEW.review_notes)
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_report_activity_log ON public.company_reports;
CREATE TRIGGER company_report_activity_log
AFTER UPDATE ON public.company_reports
FOR EACH ROW EXECUTE FUNCTION public.log_company_report_activity();
