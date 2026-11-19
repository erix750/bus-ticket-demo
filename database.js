(function() {
    if (!window.supabase) {
        throw new Error("Supabase JavaScript client failed to load. Check the script order in index.html.");
    }

    const config = window.WaylineConfig || {};
    const supabaseUrl = (config.supabaseUrl || "").trim();
    const supabaseAnonKey = (config.supabaseAnonKey || "").trim();

    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("Missing Supabase configuration. Update config.js with your project URL and anon key.");
    }

    const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
    const passengerAuth = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
            storageKey: "wayline-passenger-lookup-auth"
        }
    });
    try {
        localStorage.removeItem("wayline-booking-tokens");
    } catch (error) {
        console.error("Could not clear saved passenger booking access tokens.", error);
    }

    function throwIfError(result) {
        if (result.error) throw new Error(result.error.message);
        return result.data;
    }

    function normalizeEmail(email) {
        return String(email || "").trim().toLowerCase();
    }

    function isValidEmail(email) {
        const normalizedEmail = normalizeEmail(email);
        const addressParts = normalizedEmail.split("@");
        return normalizedEmail.length <= 254 &&
            addressParts.length === 2 &&
            addressParts[0].length <= 64 &&
            /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9](?:[a-z0-9-]{0,57}[a-z0-9])?)$/.test(normalizedEmail);
    }

    function getPasswordValidationError(password) {
        if (typeof password !== "string" || password.length < 12 || password.length > 128) {
            return "Use a password between 12 and 128 characters.";
        }
        if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) ||
            !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
            return "Include an uppercase letter, a lowercase letter, a number, and a symbol.";
        }
        return "";
    }

    function mapBus(record) {
        const company = Array.isArray(record.companies) ? record.companies[0] : record.companies;
        return {
            id: record.id,
            companyId: record.company_id,
            company: company ? company.name : "",
            name: record.name,
            from: record.from_city,
            to: record.to_city,
            date: record.travel_date,
            departureTime: String(record.departure_time).slice(0, 5),
            totalSeats: record.total_seats,
            availableSeats: record.available_seats,
            fare: Number(record.fare),
            routeDistanceKm: Number(record.route_distance_km) || 0,
            estimatedDurationMinutes: Number(record.estimated_duration_minutes) || 0,
            intermediateStops: record.intermediate_stops || "",
            fareCategory: record.fare_category || "intercity",
            routeSegments: Array.isArray(record.route_segments) ? record.route_segments.map(function(segment) {
                return {
                    from: segment.from,
                    to: segment.to,
                    distanceKm: Number(segment.distanceKm),
                    fare: Number(segment.fare)
                };
            }) : [],
            isActive: record.is_active !== false,
            isCancelled: record.is_cancelled === true,
            logo: company ? company.logo_data : ""
        };
    }

    function mapBooking(record, companyView) {
        return {
            id: record.id,
            busId: record.bus_id,
            name: record.passenger_name,
            phone: record.passenger_phone || "",
            companyId: record.company_id,
            company: record.company_name || "",
            busName: record.bus_name,
            from: record.from_city,
            to: record.to_city,
            date: record.travel_date,
            departureTime: String(record.departure_time).slice(0, 5),
            estimatedDurationMinutes: Number(record.estimated_duration_minutes) || 0,
            intermediateStops: record.intermediate_stops || "",
            seats: record.seat_count,
            baseFare: Number(record.base_fare),
            platformFee: Number(record.platform_fee),
            totalFare: Number(record.total_fare),
            paymentMethod: record.payment_method,
            paymentStatus: record.payment_status,
            cancelled: Boolean(record.cancelled),
            companyView: companyView
        };
    }

    async function loadBuses() {
        const result = await supabase
            .from("buses")
            .select("*, companies(name, logo_data)")
            .order("travel_date")
            .order("departure_time");
        return throwIfError(result).map(mapBus);
    }

    function subscribeToBusChanges(onChange, onStatus) {
        return supabase
            .channel("wayline-bus-availability")
            .on("postgres_changes", {
                event: "*",
                schema: "public",
                table: "buses"
            }, onChange)
            .subscribe(onStatus);
    }

    async function loadBookings() {
        const userResult = await supabase.auth.getSession();
        if (userResult.error) throw new Error(userResult.error.message);
        if (userResult.data.session && userResult.data.session.user.email) {
            const result = await supabase.rpc("get_company_bookings");
            return throwIfError(result).map(function(record) { return mapBooking(record, true); });
        }

        return [];
    }

    async function getCompanyProfile(userId) {
        const result = await supabase
            .from("companies")
            .select("id, name, logo_data, approval_status")
            .eq("id", userId)
            .maybeSingle();
        return throwIfError(result);
    }

    async function updateCompanyProfilePicture(logo) {
        const userResult = await supabase.auth.getUser();
        if (userResult.error) throw new Error(userResult.error.message);
        const user = userResult.data.user;
        if (!user) throw new Error("Sign in with an approved company account before updating its picture.");
        const result = await supabase
            .from("companies")
            .update({ logo_data: logo })
            .eq("id", user.id)
            .select("id")
            .single();
        throwIfError(result);
    }

    async function getCompanyPortalStatus() {
        const result = await supabase.rpc("get_company_portal_status");
        return throwIfError(result);
    }

    function createCompanyDocumentPath(userId, file) {
        const extensionsByType = {
            "application/pdf": "pdf",
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp"
        };
        const extension = extensionsByType[file.type];
        if (!extension || file.size > 10 * 1024 * 1024) {
            throw new Error("Company documents must be PDF, JPG, PNG, or WebP files up to 10 MB.");
        }
        const randomBytes = new Uint8Array(16);
        window.crypto.getRandomValues(randomBytes);
        const fileId = Array.from(randomBytes, function(byte) {
            return byte.toString(16).padStart(2, "0");
        }).join("");
        return userId + "/" + fileId + "." + extension;
    }

    async function submitCompanyApplication(application) {
        const userResult = await supabase.auth.getUser();
        if (userResult.error) throw new Error(userResult.error.message);
        const user = userResult.data.user;
        if (!user) throw new Error("Sign in with your company account before submitting an application.");
        if (!application.businessDocument ||
            (!application.licenseNotApplicable && !application.transportLicense)) {
            throw new Error("Upload the required company documents before submitting the application.");
        }

        const uploadedPaths = [];
        async function uploadDocument(file) {
            if (!file) return null;
            const path = createCompanyDocumentPath(user.id, file);
            const result = await supabase.storage
                .from("company-documents")
                .upload(path, file, { contentType: file.type, upsert: false });
            throwIfError(result);
            uploadedPaths.push(path);
            return path;
        }

        try {
            const businessDocumentPath = await uploadDocument(application.businessDocument);
            const transportLicensePath = application.licenseNotApplicable
                ? null
                : await uploadDocument(application.transportLicense);
            const result = await supabase.rpc("submit_company_application", {
                p_company_name: application.companyName,
                p_representative_name: application.representativeName,
                p_official_email: application.officialEmail,
                p_contact_phone: application.contactPhone,
                p_company_address: application.companyAddress,
                p_company_location: application.companyLocation,
                p_business_registration: application.businessRegistration,
                p_business_document_path: businessDocumentPath,
                p_transport_license_path: transportLicensePath,
                p_license_not_applicable: application.licenseNotApplicable
            });
            return throwIfError(result);
        } catch (error) {
            if (uploadedPaths.length) {
                try {
                    const cleanupResult = await supabase.storage.from("company-documents").remove(uploadedPaths);
                    if (cleanupResult.error) {
                        console.error("Could not remove temporary company application documents.", cleanupResult.error);
                    }
                } catch (cleanupError) {
                    console.error("Could not remove temporary company application documents.", cleanupError);
                }
            }
            throw error;
        }
    }

    async function isWaylineAdmin() {
        const result = await supabase.rpc("is_wayline_admin");
        return throwIfError(result) === true;
    }

    async function getAdminApplications() {
        const result = await supabase
            .from("company_applications")
            .select("id, company_id, company_name, representative_name, official_email, contact_phone, company_address, company_location, business_registration, business_document_path, transport_license_path, license_not_applicable, status, review_notes, submitted_at, updated_at")
            .not("submitted_at", "is", null)
            .order("submitted_at", { ascending: true });
        return throwIfError(result);
    }

    async function getAdminCompanies() {
        const result = await supabase
            .from("companies")
            .select("id, name, approval_status")
            .in("approval_status", ["approved", "suspended"])
            .order("name");
        return throwIfError(result);
    }

    async function getAdminActivityLog() {
        const result = await supabase
            .from("company_activity_log")
            .select("id, actor_id, company_id, event_type, record_id, details, created_at")
            .order("created_at", { ascending: false })
            .limit(100);
        return throwIfError(result);
    }

    async function getCompanyDocumentUrl(path) {
        const result = await supabase.storage
            .from("company-documents")
            .createSignedUrl(path, 60, { download: true });
        return throwIfError(result).signedUrl;
    }

    async function reviewCompanyApplication(applicationId, status, notes) {
        const result = await supabase.rpc("review_company_application", {
            p_application_id: applicationId,
            p_status: status,
            p_review_notes: notes
        });
        return throwIfError(result);
    }

    async function setCompanyAccessStatus(companyId, status, reason) {
        const result = await supabase.rpc("set_company_access_status", {
            p_company_id: companyId,
            p_status: status,
            p_reason: reason
        });
        return throwIfError(result);
    }

    async function createSchedule(bus, logo) {
        const userResult = await supabase.auth.getUser();
        if (userResult.error) throw new Error(userResult.error.message);
        const user = userResult.data.user;
        if (!user) throw new Error("Sign in with a company account before adding schedules.");

        const profileUpdate = { name: bus.company };
        if (logo) profileUpdate.logo_data = logo;
        const profileResult = await supabase
            .from("companies")
            .update(profileUpdate)
            .eq("id", user.id)
            .select("id")
            .single();
        throwIfError(profileResult);

        const schedule = {
            company_id: user.id,
            name: bus.name,
            from_city: bus.from,
            to_city: bus.to,
            travel_date: bus.date,
            departure_time: bus.departureTime,
            total_seats: bus.totalSeats,
            route_distance_km: bus.routeDistanceKm,
            estimated_duration_minutes: bus.estimatedDurationMinutes || null,
            intermediate_stops: bus.intermediateStops || "",
            fare_category: bus.fareCategory
        };
        if (Array.isArray(bus.routeSegments) && bus.routeSegments.length) {
            schedule.route_segments = bus.routeSegments;
        }
        const insertResult = await supabase.from("buses").insert(schedule)
            .select("*, companies(name, logo_data)").single();
        return mapBus(throwIfError(insertResult));
    }

    async function updateSchedule(busId, bus, logo) {
        const userResult = await supabase.auth.getUser();
        if (userResult.error) throw new Error(userResult.error.message);
        const user = userResult.data.user;
        if (!user) throw new Error("Sign in with a company account before updating schedules.");

        const schedule = {
                name: bus.name,
                from_city: bus.from,
                to_city: bus.to,
                travel_date: bus.date,
                departure_time: bus.departureTime,
                total_seats: bus.totalSeats,
                route_distance_km: bus.routeDistanceKm,
                estimated_duration_minutes: bus.estimatedDurationMinutes || null,
                intermediate_stops: bus.intermediateStops || "",
                fare_category: bus.fareCategory
            };
        if (Array.isArray(bus.routeSegments)) schedule.route_segments = bus.routeSegments;
        const result = await supabase
            .from("buses")
            .update(schedule)
            .eq("id", busId)
            .eq("company_id", user.id)
            .select("*, companies(name, logo_data)")
            .single();
        const updatedBus = throwIfError(result);

        const profileUpdate = { name: bus.company };
        if (logo) profileUpdate.logo_data = logo;
        const profileResult = await supabase
            .from("companies")
            .update(profileUpdate)
            .eq("id", user.id)
            .select("id")
            .single();
        throwIfError(profileResult);
        return mapBus(updatedBus);
    }

    async function setScheduleActive(busId, isActive) {
        const result = await supabase
            .from("buses")
            .update({ is_active: isActive })
            .eq("id", busId)
            .eq("is_cancelled", false)
            .select("id")
            .maybeSingle();
        if (!throwIfError(result)) throw new Error("The schedule was not found or you do not have permission to update it.");
    }

    async function cancelSchedule(busId) {
        const result = await supabase.rpc("cancel_bus_trip", { p_bus_id: busId });
        throwIfError(result);
    }

    async function removeSchedule(busId) {
        const result = await supabase
            .from("buses")
            .delete()
            .eq("id", busId)
            .select("id")
            .maybeSingle();
        if (result.error && result.error.code === "23503") {
            throw new Error("This schedule has ticket records and cannot be removed. Hide it instead to keep those records.");
        }
        if (!throwIfError(result)) throw new Error("The schedule was not found or you do not have permission to remove it.");
    }

    async function createBooking(bus, passengerName, passengerPhone, seatCount, paymentMethod, origin, destination) {
        const isFullRoute = !origin || !destination || (
            window.WaylineRouteUtils.normalizeCity(origin) === window.WaylineRouteUtils.normalizeCity(bus.from) &&
            window.WaylineRouteUtils.normalizeCity(destination) === window.WaylineRouteUtils.normalizeCity(bus.to)
        );
        const result = isFullRoute
            ? await supabase.rpc("book_bus", {
                p_bus_id: bus.id,
                p_passenger_name: passengerName,
                p_passenger_phone: passengerPhone,
                p_seat_count: seatCount,
                p_payment_method: paymentMethod
            })
            : await supabase.rpc("book_bus_segment", {
                p_bus_id: bus.id,
                p_origin_city: origin,
                p_destination_city: destination,
                p_passenger_name: passengerName,
                p_passenger_phone: passengerPhone,
                p_seat_count: seatCount,
                p_payment_method: paymentMethod
            });
        const booking = throwIfError(result);
        return Object.assign(mapBooking(booking, false), {
            company: bus.company,
            logo: bus.logo
        });
    }

    async function sendPassengerBookingOtp(phone) {
        const result = await passengerAuth.auth.signInWithOtp({
            phone: phone,
            options: { shouldCreateUser: true }
        });
        throwIfError(result);
    }

    async function verifyPassengerBookingOtp(phone, token) {
        const result = await passengerAuth.auth.verifyOtp({
            phone: phone,
            token: token,
            type: "sms"
        });
        return throwIfError(result);
    }

    async function findPassengerBooking(reference) {
        const result = await passengerAuth.rpc("get_my_booking_by_reference", {
            p_reference: reference
        });
        return throwIfError(result).map(function(record) { return mapBooking(record, false); });
    }

    async function clearPassengerBookingSession() {
        const result = await passengerAuth.auth.signOut({ scope: "local" });
        throwIfError(result);
    }

    async function signIn(email, password) {
        const normalizedEmail = normalizeEmail(email);
        if (!isValidEmail(normalizedEmail)) throw new Error("Enter a valid email address.");
        const result = await supabase.auth.signInWithPassword({ email: normalizedEmail, password: password });
        return throwIfError(result);
    }

    async function sendPasswordRecovery(email) {
        const normalizedEmail = normalizeEmail(email);
        if (!isValidEmail(normalizedEmail)) throw new Error("Enter a valid email address.");
        const siteUrl = (config.siteUrl || "").trim();
        if (!siteUrl) throw new Error("Set the published Wayline URL in config.js before requesting a password reset.");
        const result = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
            redirectTo: siteUrl
        });
        throwIfError(result);
    }

    async function updatePassword(password) {
        const passwordError = getPasswordValidationError(password);
        if (passwordError) throw new Error(passwordError);
        const result = await supabase.auth.updateUser({ password: password });
        return throwIfError(result);
    }

    async function signUp(email, password, companyName) {
        const normalizedEmail = normalizeEmail(email);
        if (!isValidEmail(normalizedEmail)) throw new Error("Enter a valid company email address.");
        const passwordError = getPasswordValidationError(password);
        if (passwordError) throw new Error(passwordError);
        const siteUrl = (config.siteUrl || "").trim();
        if (!siteUrl) throw new Error("Set the published Wayline URL in config.js before creating a company account.");
        const result = await supabase.auth.signUp({
            email: normalizedEmail,
            password: password,
            options: {
                data: { company_name: companyName },
                emailRedirectTo: siteUrl
            }
        });
        return throwIfError(result);
    }

    async function signOut() {
        const result = await supabase.auth.signOut();
        throwIfError(result);
    }

    window.WaylineDatabase = {
        open: function() { return supabase; },
        loadBuses: loadBuses,
        subscribeToBusChanges: subscribeToBusChanges,
        loadBookings: loadBookings,
        getCompanyProfile: getCompanyProfile,
        updateCompanyProfilePicture: updateCompanyProfilePicture,
        getCompanyPortalStatus: getCompanyPortalStatus,
        submitCompanyApplication: submitCompanyApplication,
        isWaylineAdmin: isWaylineAdmin,
        getAdminApplications: getAdminApplications,
        getAdminCompanies: getAdminCompanies,
        getAdminActivityLog: getAdminActivityLog,
        getCompanyDocumentUrl: getCompanyDocumentUrl,
        reviewCompanyApplication: reviewCompanyApplication,
        setCompanyAccessStatus: setCompanyAccessStatus,
        createSchedule: createSchedule,
        updateSchedule: updateSchedule,
        setScheduleActive: setScheduleActive,
        cancelSchedule: cancelSchedule,
        removeSchedule: removeSchedule,
        createBooking: createBooking,
        sendPassengerBookingOtp: sendPassengerBookingOtp,
        verifyPassengerBookingOtp: verifyPassengerBookingOtp,
        findPassengerBooking: findPassengerBooking,
        clearPassengerBookingSession: clearPassengerBookingSession,
        isValidEmail: isValidEmail,
        getPasswordValidationError: getPasswordValidationError,
        signIn: signIn,
        sendPasswordRecovery: sendPasswordRecovery,
        updatePassword: updatePassword,
        signUp: signUp,
        signOut: signOut
    };
})();
