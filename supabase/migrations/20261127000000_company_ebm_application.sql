ALTER TABLE public.company_applications
    ADD COLUMN IF NOT EXISTS vat_registered boolean,
    ADD COLUMN IF NOT EXISTS ticket_tax_category text,
    ADD COLUMN IF NOT EXISTS ebm_device_identifier text,
    ADD COLUMN IF NOT EXISTS rra_registered_business_name text,
    ADD COLUMN IF NOT EXISTS ebm_registration_certificate_path text,
    ADD COLUMN IF NOT EXISTS ebm_owner_confirmed_at timestamptz,
    ADD COLUMN IF NOT EXISTS ebm_credentials_secret_id uuid,
    ADD COLUMN IF NOT EXISTS ebm_status text NOT NULL DEFAULT 'not_submitted',
    ADD COLUMN IF NOT EXISTS ebm_tin_checked boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ebm_device_checked boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ebm_business_name_checked boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ebm_reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS ebm_reviewer_name text,
    ADD COLUMN IF NOT EXISTS ebm_reviewed_at timestamptz,
    ADD COLUMN IF NOT EXISTS ebm_review_notes text,
    ADD COLUMN IF NOT EXISTS ebm_reapproval_required boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS application_draft_step smallint NOT NULL DEFAULT 2;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.company_applications'::regclass
          AND conname = 'company_applications_ebm_status_check'
    ) THEN
        ALTER TABLE public.company_applications
            ADD CONSTRAINT company_applications_ebm_status_check
            CHECK (ebm_status IN ('not_submitted', 'pending', 'approved', 'rejected'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.company_applications'::regclass
          AND conname = 'company_applications_draft_step_check'
    ) THEN
        ALTER TABLE public.company_applications
            ADD CONSTRAINT company_applications_draft_step_check
            CHECK (application_draft_step BETWEEN 2 AND 5);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_application_draft()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    active_company_id uuid;
    active_role text;
    application public.company_applications%rowtype;
BEGIN
    IF (SELECT auth.uid()) IS NULL OR NOT public.is_verified_company_email() THEN
        RAISE EXCEPTION 'Sign in and confirm your company account email before accessing application details.';
    END IF;
    SELECT staff.company_id, staff.role
      INTO active_company_id, active_role
      FROM public.company_staff AS staff
     WHERE staff.user_id = (SELECT auth.uid())
       AND staff.role IN ('owner', 'manager')
     ORDER BY CASE staff.role WHEN 'owner' THEN 0 ELSE 1 END
     LIMIT 1;
    IF active_company_id IS NULL THEN
        RAISE EXCEPTION 'Only company owners and managers can access application details.';
    END IF;
    SELECT * INTO application
      FROM public.company_applications AS applications
     WHERE applications.company_id = active_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The company application was not found.';
    END IF;
    IF application.submitted_at IS NOT NULL
       AND coalesce((auth.jwt() ->> 'aal') = 'aal2', false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Two-step verification is required to access submitted RRA/EBM information.';
    END IF;

    RETURN jsonb_build_object(
        'company_id', application.company_id,
        'company_name', application.company_name,
        'representative_name', application.representative_name,
        'official_email', application.official_email,
        'contact_phone', application.contact_phone,
        'company_address', application.company_address,
        'company_location', application.company_location,
        'business_registration', application.rdb_registration_number,
        'rdb_registration_number', application.rdb_registration_number,
        'tin', application.tin,
        'transport_license_number', application.transport_license_number,
        'transport_license_type', application.transport_license_type,
        'transport_license_issue_date', application.transport_license_issue_date,
        'transport_license_expiry_date', application.transport_license_expiry_date,
        'allowed_routes_areas', application.allowed_routes_areas,
        'business_document_path', application.business_document_path,
        'transport_license_path', application.transport_license_path,
        'representative_id_document_path', application.representative_id_document_path,
        'vat_registered', application.vat_registered,
        'ticket_tax_category', application.ticket_tax_category,
        'ebm_device_identifier', application.ebm_device_identifier,
        'rra_registered_business_name', application.rra_registered_business_name,
        'ebm_registration_certificate_path', application.ebm_registration_certificate_path,
        'ebm_owner_confirmed_at', application.ebm_owner_confirmed_at,
        'ebm_credentials_configured', application.ebm_credentials_secret_id IS NOT NULL,
        'ebm_status', application.ebm_status,
        'ebm_reapproval_required', application.ebm_reapproval_required,
        'ebm_review_notes', application.ebm_review_notes,
        'application_draft_step', application.application_draft_step,
        'submitted_at', application.submitted_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_application_draft() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_application_draft() TO authenticated;

CREATE OR REPLACE FUNCTION public.save_company_application_draft(
    p_application jsonb,
    p_next_step smallint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    active_company_id uuid := (SELECT auth.uid());
    application public.company_applications%rowtype;
    certificate_path text := nullif(pg_catalog.btrim(p_application ->> 'ebm_registration_certificate_path'), '');
    credential_value text := coalesce(p_application ->> 'ebm_credentials', '');
    secret_id uuid;
BEGIN
    IF active_company_id IS NULL OR NOT public.is_verified_company_email()
       OR NOT public.has_company_role(active_company_id, ARRAY['owner']) THEN
        RAISE EXCEPTION 'A confirmed company owner must sign in to save application progress.';
    END IF;
    SELECT * INTO application
      FROM public.company_applications AS applications
     WHERE applications.company_id = active_company_id
     FOR UPDATE;
    IF NOT FOUND OR application.submitted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Application progress can only be saved before submission.';
    END IF;
    IF p_next_step NOT BETWEEN 3 AND 5
       OR p_next_step <> application.application_draft_step + 1 THEN
        RAISE EXCEPTION 'Complete application steps in order before continuing.';
    END IF;
    IF char_length(credential_value) > 10000 THEN
        RAISE EXCEPTION 'EBM credentials must be 10,000 characters or fewer.';
    END IF;

    IF p_next_step >= 3 AND (
        char_length(pg_catalog.btrim(coalesce(p_application ->> 'company_name', ''))) NOT BETWEEN 2 AND 80
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'representative_name', ''))) NOT BETWEEN 2 AND 100
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'official_email', ''))) NOT BETWEEN 5 AND 254
        OR NOT public.is_valid_company_email(pg_catalog.lower(pg_catalog.btrim(coalesce(p_application ->> 'official_email', ''))))
        OR pg_catalog.lower(pg_catalog.btrim(coalesce(p_application ->> 'official_email', '')))
            <> (SELECT pg_catalog.lower(users.email) FROM auth.users AS users WHERE users.id = active_company_id)
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'contact_phone', ''))) NOT BETWEEN 7 AND 24
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'company_address', ''))) NOT BETWEEN 3 AND 240
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'company_location', ''))) NOT BETWEEN 2 AND 120
    ) THEN
        RAISE EXCEPTION 'Complete every required company detail using the confirmed account email.';
    END IF;
    IF p_next_step >= 4 AND (
        char_length(pg_catalog.btrim(coalesce(p_application ->> 'rdb_registration_number', ''))) NOT BETWEEN 2 AND 80
        OR coalesce(pg_catalog.btrim(p_application ->> 'tin'), '') !~ '^[0-9]{9}$'
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'transport_license_number', ''))) NOT BETWEEN 2 AND 100
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'transport_license_type', ''))) NOT BETWEEN 2 AND 80
        OR nullif(p_application ->> 'transport_license_issue_date', '') IS NULL
        OR (p_application ->> 'transport_license_issue_date')::date > current_date
        OR nullif(p_application ->> 'transport_license_expiry_date', '') IS NULL
        OR (p_application ->> 'transport_license_expiry_date')::date <= current_date
        OR (p_application ->> 'transport_license_expiry_date')::date
            < (p_application ->> 'transport_license_issue_date')::date
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'allowed_routes_areas', ''))) NOT BETWEEN 2 AND 1000
    ) THEN
        RAISE EXCEPTION 'Complete valid registration and transport licence details before continuing.';
    END IF;
    IF p_next_step = 5 AND (
        coalesce(p_application ->> 'vat_registered', '') NOT IN ('true', 'false')
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'ticket_tax_category', ''))) NOT BETWEEN 2 AND 120
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'ebm_device_identifier', ''))) NOT BETWEEN 2 AND 160
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'rra_registered_business_name', ''))) NOT BETWEEN 2 AND 160
        OR coalesce(p_application ->> 'ebm_owner_confirmation', 'false') <> 'true'
        OR certificate_path IS NULL
        OR pg_catalog.split_part(certificate_path, '/', 1) <> active_company_id::text
        OR NOT EXISTS (
            SELECT 1 FROM storage.objects AS objects
            WHERE objects.bucket_id = 'company-documents'
              AND objects.name = certificate_path
        )
    ) THEN
        RAISE EXCEPTION 'Complete all RRA/EBM fields, confirm ownership, and upload the private registration certificate.';
    END IF;

    IF credential_value <> '' THEN
        secret_id := application.ebm_credentials_secret_id;
        IF secret_id IS NULL THEN
            secret_id := vault.create_secret(
                credential_value,
                'company-ebm-' || active_company_id::text,
                'Company-provided EBM credentials'
            );
        ELSE
            PERFORM vault.update_secret(
                secret_id,
                credential_value,
                'company-ebm-' || active_company_id::text,
                'Company-provided EBM credentials'
            );
        END IF;
    ELSE
        secret_id := application.ebm_credentials_secret_id;
    END IF;

    UPDATE public.company_applications
       SET company_name = coalesce(nullif(pg_catalog.btrim(p_application ->> 'company_name'), ''), company_name),
           representative_name = coalesce(nullif(pg_catalog.btrim(p_application ->> 'representative_name'), ''), representative_name),
           official_email = coalesce(nullif(pg_catalog.lower(pg_catalog.btrim(p_application ->> 'official_email')), ''), official_email),
           contact_phone = coalesce(nullif(pg_catalog.btrim(p_application ->> 'contact_phone'), ''), contact_phone),
           company_address = coalesce(nullif(pg_catalog.btrim(p_application ->> 'company_address'), ''), company_address),
           company_location = coalesce(nullif(pg_catalog.btrim(p_application ->> 'company_location'), ''), company_location),
           business_registration = coalesce(nullif(pg_catalog.btrim(p_application ->> 'rdb_registration_number'), ''), business_registration),
           rdb_registration_number = coalesce(nullif(pg_catalog.btrim(p_application ->> 'rdb_registration_number'), ''), rdb_registration_number),
           tin = coalesce(nullif(pg_catalog.btrim(p_application ->> 'tin'), ''), tin),
           transport_license_number = coalesce(nullif(pg_catalog.btrim(p_application ->> 'transport_license_number'), ''), transport_license_number),
           transport_license_type = coalesce(nullif(pg_catalog.btrim(p_application ->> 'transport_license_type'), ''), transport_license_type),
           transport_license_issue_date = coalesce(nullif(p_application ->> 'transport_license_issue_date', '')::date, transport_license_issue_date),
           transport_license_expiry_date = coalesce(nullif(p_application ->> 'transport_license_expiry_date', '')::date, transport_license_expiry_date),
           allowed_routes_areas = coalesce(nullif(pg_catalog.btrim(p_application ->> 'allowed_routes_areas'), ''), allowed_routes_areas),
           vat_registered = coalesce(nullif(p_application ->> 'vat_registered', '')::boolean, vat_registered),
           ticket_tax_category = coalesce(nullif(pg_catalog.btrim(p_application ->> 'ticket_tax_category'), ''), ticket_tax_category),
           ebm_device_identifier = coalesce(nullif(pg_catalog.btrim(p_application ->> 'ebm_device_identifier'), ''), ebm_device_identifier),
           rra_registered_business_name = coalesce(nullif(pg_catalog.btrim(p_application ->> 'rra_registered_business_name'), ''), rra_registered_business_name),
           ebm_registration_certificate_path = coalesce(certificate_path, ebm_registration_certificate_path),
           ebm_owner_confirmed_at = CASE WHEN p_application ->> 'ebm_owner_confirmation' = 'true'
               THEN coalesce(ebm_owner_confirmed_at, now()) ELSE ebm_owner_confirmed_at END,
           ebm_credentials_secret_id = secret_id,
           application_draft_step = p_next_step,
           updated_at = now()
     WHERE id = application.id;
    UPDATE public.companies
       SET name = coalesce(nullif(pg_catalog.btrim(p_application ->> 'company_name'), ''), name)
     WHERE id = active_company_id;

    RETURN public.get_company_application_draft();
END;
$$;

REVOKE ALL ON FUNCTION public.save_company_application_draft(jsonb, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_company_application_draft(jsonb, smallint) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_company_application_with_ebm(p_application jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    active_company_id uuid := (SELECT auth.uid());
    application public.company_applications%rowtype;
    clean_company_name text := pg_catalog.btrim(coalesce(p_application ->> 'company_name', ''));
    clean_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_application ->> 'official_email', '')));
    document_path text;
    credential_value text := coalesce(p_application ->> 'ebm_credentials', '');
    secret_id uuid;
BEGIN
    IF active_company_id IS NULL OR NOT public.is_verified_company_email()
       OR NOT public.has_company_role(active_company_id, ARRAY['owner']) THEN
        RAISE EXCEPTION 'A confirmed company owner must sign in to submit an application.';
    END IF;
    SELECT * INTO application
      FROM public.company_applications AS applications
     WHERE applications.company_id = active_company_id
     FOR UPDATE;
    IF NOT FOUND OR application.submitted_at IS NOT NULL
       OR application.application_draft_step <> 5 THEN
        RAISE EXCEPTION 'Complete each application step and save the draft before submitting.';
    END IF;
    IF char_length(clean_company_name) NOT BETWEEN 2 AND 80
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'representative_name', ''))) NOT BETWEEN 2 AND 100
        OR char_length(clean_email) NOT BETWEEN 5 AND 254
        OR NOT public.is_valid_company_email(clean_email)
        OR clean_email <> (SELECT pg_catalog.lower(users.email) FROM auth.users AS users WHERE users.id = active_company_id)
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'contact_phone', ''))) NOT BETWEEN 7 AND 24
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'company_address', ''))) NOT BETWEEN 3 AND 240
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'company_location', ''))) NOT BETWEEN 2 AND 120
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'rdb_registration_number', ''))) NOT BETWEEN 2 AND 80
        OR coalesce(pg_catalog.btrim(p_application ->> 'tin'), '') !~ '^[0-9]{9}$'
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'transport_license_number', ''))) NOT BETWEEN 2 AND 100
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'transport_license_type', ''))) NOT BETWEEN 2 AND 80
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'allowed_routes_areas', ''))) NOT BETWEEN 2 AND 1000
        OR coalesce(p_application ->> 'vat_registered', '') NOT IN ('true', 'false')
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'ticket_tax_category', ''))) NOT BETWEEN 2 AND 120
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'ebm_device_identifier', ''))) NOT BETWEEN 2 AND 160
        OR char_length(pg_catalog.btrim(coalesce(p_application ->> 'rra_registered_business_name', ''))) NOT BETWEEN 2 AND 160
        OR coalesce(p_application ->> 'ebm_owner_confirmation', 'false') <> 'true'
        OR char_length(credential_value) > 10000 THEN
        RAISE EXCEPTION 'Complete all required company, licence, and RRA/EBM information.';
    END IF;
    IF nullif(p_application ->> 'transport_license_issue_date', '') IS NULL
        OR (p_application ->> 'transport_license_issue_date')::date > current_date
        OR nullif(p_application ->> 'transport_license_expiry_date', '') IS NULL
        OR (p_application ->> 'transport_license_expiry_date')::date <= current_date
        OR (p_application ->> 'transport_license_expiry_date')::date
            < (p_application ->> 'transport_license_issue_date')::date THEN
        RAISE EXCEPTION 'Enter a valid issue date and a future transport licence expiry date.';
    END IF;
    IF application.ebm_registration_certificate_path IS NULL
       OR application.ebm_registration_certificate_path <> p_application ->> 'ebm_registration_certificate_path'
       OR pg_catalog.split_part(application.ebm_registration_certificate_path, '/', 1) <> active_company_id::text
       OR NOT EXISTS (
           SELECT 1 FROM storage.objects AS objects
           WHERE objects.bucket_id = 'company-documents'
             AND objects.name = application.ebm_registration_certificate_path
       ) THEN
        RAISE EXCEPTION 'Upload and save the company's RRA/EBM registration certificate before submitting.';
    END IF;
    FOREACH document_path IN ARRAY ARRAY[
        p_application ->> 'business_document_path',
        p_application ->> 'transport_license_path',
        p_application ->> 'representative_id_document_path'
    ] LOOP
        IF document_path IS NULL
            OR pg_catalog.split_part(document_path, '/', 1) <> active_company_id::text
            OR NOT EXISTS (
                SELECT 1 FROM storage.objects AS objects
                WHERE objects.bucket_id = 'company-documents'
                  AND objects.name = document_path
            ) THEN
            RAISE EXCEPTION 'Upload all required company documents to private storage.';
        END IF;
    END LOOP;

    IF credential_value <> '' THEN
        secret_id := application.ebm_credentials_secret_id;
        IF secret_id IS NULL THEN
            secret_id := vault.create_secret(
                credential_value,
                'company-ebm-' || active_company_id::text,
                'Company-provided EBM credentials'
            );
        ELSE
            PERFORM vault.update_secret(
                secret_id,
                credential_value,
                'company-ebm-' || active_company_id::text,
                'Company-provided EBM credentials'
            );
        END IF;
    ELSE
        secret_id := application.ebm_credentials_secret_id;
    END IF;

    UPDATE public.company_applications
       SET company_name = clean_company_name,
           representative_name = pg_catalog.btrim(p_application ->> 'representative_name'),
           official_email = clean_email,
           contact_phone = pg_catalog.btrim(p_application ->> 'contact_phone'),
           company_address = pg_catalog.btrim(p_application ->> 'company_address'),
           company_location = pg_catalog.btrim(p_application ->> 'company_location'),
           business_registration = pg_catalog.btrim(p_application ->> 'rdb_registration_number'),
           rdb_registration_number = pg_catalog.btrim(p_application ->> 'rdb_registration_number'),
           tin = pg_catalog.btrim(p_application ->> 'tin'),
           transport_license_number = pg_catalog.btrim(p_application ->> 'transport_license_number'),
           transport_license_type = pg_catalog.btrim(p_application ->> 'transport_license_type'),
           transport_license_issue_date = (p_application ->> 'transport_license_issue_date')::date,
           transport_license_expiry_date = (p_application ->> 'transport_license_expiry_date')::date,
           allowed_routes_areas = pg_catalog.btrim(p_application ->> 'allowed_routes_areas'),
           business_document_path = p_application ->> 'business_document_path',
           transport_license_path = p_application ->> 'transport_license_path',
           representative_id_document_path = p_application ->> 'representative_id_document_path',
           vat_registered = (p_application ->> 'vat_registered')::boolean,
           ticket_tax_category = pg_catalog.btrim(p_application ->> 'ticket_tax_category'),
           ebm_device_identifier = pg_catalog.btrim(p_application ->> 'ebm_device_identifier'),
           rra_registered_business_name = pg_catalog.btrim(p_application ->> 'rra_registered_business_name'),
           ebm_owner_confirmed_at = coalesce(ebm_owner_confirmed_at, now()),
           ebm_credentials_secret_id = secret_id,
           ebm_status = 'pending',
           ebm_tin_checked = false,
           ebm_device_checked = false,
           ebm_business_name_checked = false,
           ebm_reviewer_id = NULL,
           ebm_reviewer_name = NULL,
           ebm_reviewed_at = NULL,
           ebm_review_notes = NULL,
           ebm_reapproval_required = false,
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
           updated_at = now()
     WHERE id = application.id;
    UPDATE public.companies
       SET name = clean_company_name,
           approval_status = 'pending'
     WHERE id = active_company_id;

    INSERT INTO public.company_activity_log (actor_id, company_id, event_type, record_id, details)
    VALUES (
        active_company_id,
        active_company_id,
        'company_application_submitted',
        application.id,
        jsonb_build_object('ebm_status', 'pending', 'submitted_at', now())
    );
    RETURN public.get_company_portal_status();
END;
$$;

REVOKE ALL ON FUNCTION public.submit_company_application_with_ebm(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_company_application_with_ebm(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_company_application(
    text, text, text, text, text, text, text, text, text, text, date, date, text, text, text, text
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_company_ebm_information(
    p_tin text,
    p_vat_registered boolean,
    p_ticket_tax_category text,
    p_ebm_device_identifier text,
    p_rra_registered_business_name text,
    p_ebm_registration_certificate_path text,
    p_owner_confirmation boolean,
    p_ebm_credentials text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    target_company_id uuid;
    application public.company_applications%rowtype;
    secret_id uuid;
    reviewer_name text;
BEGIN
    SELECT staff.company_id INTO target_company_id
      FROM public.company_staff AS staff
     WHERE staff.user_id = (SELECT auth.uid())
       AND staff.role IN ('owner', 'manager')
     ORDER BY CASE staff.role WHEN 'owner' THEN 0 ELSE 1 END
     LIMIT 1;
    IF target_company_id IS NULL
       OR coalesce((auth.jwt() ->> 'aal'), '') <> 'aal2'
       OR NOT public.is_verified_company_email() THEN
        RAISE EXCEPTION 'A confirmed company owner or manager with two-step authentication is required.';
    END IF;
    IF coalesce(p_tin, '') !~ '^[0-9]{9}$'
       OR p_vat_registered IS NULL
       OR char_length(pg_catalog.btrim(coalesce(p_ticket_tax_category, ''))) NOT BETWEEN 2 AND 120
       OR char_length(pg_catalog.btrim(coalesce(p_ebm_device_identifier, ''))) NOT BETWEEN 2 AND 160
       OR char_length(pg_catalog.btrim(coalesce(p_rra_registered_business_name, ''))) NOT BETWEEN 2 AND 160
       OR p_owner_confirmation IS NOT TRUE
       OR char_length(coalesce(p_ebm_credentials, '')) > 10000 THEN
        RAISE EXCEPTION 'Complete every required RRA/EBM field and confirm authorization.';
    END IF;
    SELECT * INTO application
      FROM public.company_applications AS applications
     WHERE applications.company_id = target_company_id
       AND applications.submitted_at IS NOT NULL
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submit the company application before requesting an RRA/EBM change.';
    END IF;
    IF p_ebm_registration_certificate_path IS NULL
       OR pg_catalog.split_part(p_ebm_registration_certificate_path, '/', 1) <> target_company_id::text
       OR NOT EXISTS (
           SELECT 1 FROM storage.objects AS objects
           WHERE objects.bucket_id = 'company-documents'
             AND objects.name = p_ebm_registration_certificate_path
       ) THEN
        RAISE EXCEPTION 'Upload the RRA/EBM registration certificate to private storage.';
    END IF;
    IF coalesce(p_ebm_credentials, '') <> '' THEN
        secret_id := application.ebm_credentials_secret_id;
        IF secret_id IS NULL THEN
            secret_id := vault.create_secret(
                p_ebm_credentials,
                'company-ebm-' || target_company_id::text,
                'Company-provided EBM credentials'
            );
        ELSE
            PERFORM vault.update_secret(
                secret_id,
                p_ebm_credentials,
                'company-ebm-' || target_company_id::text,
                'Company-provided EBM credentials'
            );
        END IF;
    ELSE
        secret_id := application.ebm_credentials_secret_id;
    END IF;
    reviewer_name := coalesce(
        nullif(pg_catalog.btrim(auth.jwt() ->> 'email'), ''),
        (SELECT auth.uid())::text
    );

    UPDATE public.company_applications
       SET tin = pg_catalog.btrim(p_tin),
           vat_registered = p_vat_registered,
           ticket_tax_category = pg_catalog.btrim(p_ticket_tax_category),
           ebm_device_identifier = pg_catalog.btrim(p_ebm_device_identifier),
           rra_registered_business_name = pg_catalog.btrim(p_rra_registered_business_name),
           ebm_registration_certificate_path = p_ebm_registration_certificate_path,
           ebm_owner_confirmed_at = now(),
           ebm_credentials_secret_id = secret_id,
           ebm_status = 'pending',
           ebm_tin_checked = false,
           ebm_device_checked = false,
           ebm_business_name_checked = false,
           ebm_reviewer_id = NULL,
           ebm_reviewer_name = NULL,
           ebm_reviewed_at = NULL,
           ebm_review_notes = NULL,
           ebm_reapproval_required = application.status = 'approved',
           status = CASE WHEN application.status = 'approved' THEN 'under_review' ELSE application.status END,
           review_notes = CASE WHEN application.status = 'approved'
               THEN 'RRA/EBM information changed and requires Wayline review.'
               ELSE review_notes END,
           updated_at = now()
     WHERE id = application.id;
    UPDATE public.companies
       SET approval_status = CASE WHEN approval_status = 'approved' THEN 'under_review' ELSE approval_status END
     WHERE id = target_company_id;
    INSERT INTO public.company_activity_log (actor_id, company_id, event_type, record_id, details)
    VALUES (
        (SELECT auth.uid()),
        target_company_id,
        'company_ebm_information_submitted',
        application.id,
        jsonb_build_object(
            'ebm_status', 'pending',
            'reviewer_name', reviewer_name,
            'submitted_at', now()
        )
    );
    RETURN public.get_company_portal_status();
END;
$$;

REVOKE ALL ON FUNCTION public.submit_company_ebm_information(text, boolean, text, text, text, text, boolean, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_company_ebm_information(text, boolean, text, text, text, text, boolean, text)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.review_company_ebm_information(
    p_application_id uuid,
    p_tin_checked boolean,
    p_device_checked boolean,
    p_business_name_checked boolean,
    p_status text,
    p_review_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    application public.company_applications%rowtype;
    reviewer_name text;
    clean_note text := pg_catalog.btrim(coalesce(p_review_note, ''));
BEGIN
    IF NOT public.is_wayline_admin()
       OR p_status NOT IN ('pending', 'approved', 'rejected')
       OR char_length(clean_note) > 2000
       OR (p_status = 'rejected' AND char_length(clean_note) < 3) THEN
        RAISE EXCEPTION 'Only a Wayline administrator can save a valid EBM review.';
    END IF;
    SELECT * INTO application
      FROM public.company_applications AS applications
     WHERE applications.id = p_application_id
       AND applications.submitted_at IS NOT NULL
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The submitted company application was not found.';
    END IF;
    IF application.company_id = (SELECT auth.uid()) THEN
        RAISE EXCEPTION 'Administrators cannot review their own company EBM information.';
    END IF;
    IF p_status = 'approved' AND (
        p_tin_checked IS NOT TRUE
        OR p_device_checked IS NOT TRUE
        OR p_business_name_checked IS NOT TRUE
        OR coalesce(application.tin, '') !~ '^[0-9]{9}$'
        OR application.vat_registered IS NULL
        OR nullif(pg_catalog.btrim(application.ticket_tax_category), '') IS NULL
        OR nullif(pg_catalog.btrim(application.ebm_device_identifier), '') IS NULL
        OR nullif(pg_catalog.btrim(application.rra_registered_business_name), '') IS NULL
        OR application.ebm_owner_confirmed_at IS NULL
        OR application.ebm_registration_certificate_path IS NULL
        OR NOT EXISTS (
            SELECT 1 FROM storage.objects AS objects
            WHERE objects.bucket_id = 'company-documents'
              AND objects.name = application.ebm_registration_certificate_path
        )
    ) THEN
        RAISE EXCEPTION 'Complete the EBM review checklist and verify the submitted company information before approval.';
    END IF;
    reviewer_name := coalesce(
        nullif(pg_catalog.btrim(auth.jwt() ->> 'email'), ''),
        (SELECT auth.uid())::text
    );
    UPDATE public.company_applications
       SET ebm_tin_checked = coalesce(p_tin_checked, false),
           ebm_device_checked = coalesce(p_device_checked, false),
           ebm_business_name_checked = coalesce(p_business_name_checked, false),
           ebm_status = p_status,
           ebm_reviewer_id = (SELECT auth.uid()),
           ebm_reviewer_name = reviewer_name,
           ebm_reviewed_at = now(),
           ebm_review_notes = nullif(clean_note, ''),
           updated_at = now()
     WHERE id = application.id;
    INSERT INTO public.company_activity_log (actor_id, company_id, event_type, record_id, details)
    VALUES (
        (SELECT auth.uid()),
        application.company_id,
        'company_ebm_review_saved',
        application.id,
        jsonb_build_object(
            'status', p_status,
            'tin_checked', coalesce(p_tin_checked, false),
            'device_checked', coalesce(p_device_checked, false),
            'business_name_checked', coalesce(p_business_name_checked, false),
            'reviewer_name', reviewer_name,
            'reviewed_at', now(),
            'review_note', nullif(clean_note, '')
        )
    );
    RETURN jsonb_build_object(
        'application_id', application.id,
        'status', p_status,
        'reviewer_name', reviewer_name,
        'reviewed_at', now()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.review_company_ebm_information(uuid, boolean, boolean, boolean, text, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_company_ebm_information(uuid, boolean, boolean, boolean, text, text)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.get_company_ebm_credentials(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    secret_id uuid;
    credential_value text;
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'EBM credentials are available only to server-side functions.';
    END IF;
    SELECT applications.ebm_credentials_secret_id
      INTO secret_id
      FROM public.company_applications AS applications
     WHERE applications.company_id = p_company_id
       AND applications.ebm_status = 'approved';
    IF secret_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT secrets.decrypted_secret
      INTO credential_value
      FROM vault.decrypted_secrets AS secrets
     WHERE secrets.id = secret_id;
    RETURN credential_value;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_ebm_credentials(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_ebm_credentials(uuid) TO service_role;

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
          AND applications.ebm_status = 'approved'
          AND NOT applications.ebm_reapproval_required
          AND applications.vat_registered IS NOT NULL
          AND nullif(pg_catalog.btrim(applications.ticket_tax_category), '') IS NOT NULL
          AND nullif(pg_catalog.btrim(applications.ebm_device_identifier), '') IS NOT NULL
          AND nullif(pg_catalog.btrim(applications.rra_registered_business_name), '') IS NOT NULL
          AND applications.ebm_owner_confirmed_at IS NOT NULL
          AND applications.ebm_registration_certificate_path IS NOT NULL
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
          AND EXISTS (
              SELECT 1 FROM storage.objects AS objects
              WHERE objects.bucket_id = 'company-documents'
                AND objects.name = applications.ebm_registration_certificate_path
          )
    );
$$;

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
        OR NEW.ebm_status <> 'approved'
        OR NEW.ebm_reapproval_required
        OR NOT NEW.ebm_tin_checked
        OR NOT NEW.ebm_device_checked
        OR NOT NEW.ebm_business_name_checked
        OR NEW.vat_registered IS NULL
        OR nullif(pg_catalog.btrim(NEW.ticket_tax_category), '') IS NULL
        OR nullif(pg_catalog.btrim(NEW.ebm_device_identifier), '') IS NULL
        OR nullif(pg_catalog.btrim(NEW.rra_registered_business_name), '') IS NULL
        OR NEW.ebm_owner_confirmed_at IS NULL
        OR NEW.ebm_registration_certificate_path IS NULL
        OR NOT EXISTS (
            SELECT 1 FROM storage.objects
            WHERE bucket_id = 'company-documents'
              AND name = NEW.ebm_registration_certificate_path
        )
    ) THEN
        RAISE EXCEPTION 'Complete the company and EBM verification checklists and provide current documents before approval.';
    END IF;
    IF NEW.status = 'approved' THEN
        NEW.ebm_reapproval_required := false;
    END IF;
    RETURN NEW;
END;
$$;
