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
            .select("id, name, logo_data")
            .eq("id", userId)
            .single();
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

        const insertResult = await supabase.from("buses").insert({
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
        }).select("*, companies(name, logo_data)").single();
        return mapBus(throwIfError(insertResult));
    }

    async function updateSchedule(busId, bus, logo) {
        const userResult = await supabase.auth.getUser();
        if (userResult.error) throw new Error(userResult.error.message);
        const user = userResult.data.user;
        if (!user) throw new Error("Sign in with a company account before updating schedules.");

        const result = await supabase
            .from("buses")
            .update({
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
            })
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

    async function createBooking(bus, passengerName, passengerPhone, seatCount, paymentMethod) {
        const result = await supabase.rpc("book_bus", {
            p_bus_id: bus.id,
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
        const result = await supabase.auth.signInWithPassword({ email: email, password: password });
        return throwIfError(result);
    }

    async function sendPasswordRecovery(email) {
        const siteUrl = (config.siteUrl || "").trim();
        if (!siteUrl) throw new Error("Set the published Wayline URL in config.js before requesting a password reset.");
        const result = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: siteUrl
        });
        throwIfError(result);
    }

    async function updatePassword(password) {
        const result = await supabase.auth.updateUser({ password: password });
        return throwIfError(result);
    }

    async function signUp(email, password, companyName) {
        const siteUrl = (config.siteUrl || "").trim();
        if (!siteUrl) throw new Error("Set the published Wayline URL in config.js before creating a company account.");
        const result = await supabase.auth.signUp({
            email: email,
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
        signIn: signIn,
        sendPasswordRecovery: sendPasswordRecovery,
        updatePassword: updatePassword,
        signUp: signUp,
        signOut: signOut
    };
})();
