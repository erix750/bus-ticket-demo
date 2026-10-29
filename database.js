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
    const bookingTokensKey = "wayline-booking-tokens";

    function throwIfError(result) {
        if (result.error) throw new Error(result.error.message);
        return result.data;
    }

    function readBookingTokens() {
        const stored = localStorage.getItem(bookingTokensKey);
        if (!stored) return [];
        const tokens = JSON.parse(stored);
        if (!Array.isArray(tokens)) throw new Error("Saved booking access data is invalid.");
        return tokens.filter(function(item) {
            return item && typeof item.id === "string" && typeof item.token === "string";
        });
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
            fareCategory: record.fare_category || "intercity",
            isActive: record.is_active !== false,
            logo: company ? company.logo_data : ""
        };
    }

    function mapBooking(record, companyView) {
        return {
            id: record.id,
            busId: record.bus_id,
            name: record.passenger_name,
            companyId: record.company_id,
            company: record.company_name || "",
            busName: record.bus_name,
            from: record.from_city,
            to: record.to_city,
            date: record.travel_date,
            departureTime: String(record.departure_time).slice(0, 5),
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
            .gte("travel_date", new Date().toISOString().slice(0, 10))
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
        if (userResult.data.session) {
            const result = await supabase.rpc("get_company_bookings");
            return throwIfError(result).map(function(record) { return mapBooking(record, true); });
        }

        const tokens = readBookingTokens();
        if (!tokens.length) return [];
        const result = await supabase.rpc("get_my_bookings", {
            p_cancel_tokens: tokens.map(function(item) { return item.token; })
        });
        return throwIfError(result).map(function(record) { return mapBooking(record, false); });
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
            fare_category: bus.fareCategory
        }).select("*, companies(name, logo_data)").single();
        return mapBus(throwIfError(insertResult));
    }

    async function setScheduleActive(busId, isActive) {
        const result = await supabase
            .from("buses")
            .update({ is_active: isActive })
            .eq("id", busId)
            .select("id")
            .maybeSingle();
        if (!throwIfError(result)) throw new Error("The schedule was not found or you do not have permission to update it.");
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

    async function createBooking(bus, passengerName, seatCount, paymentMethod) {
        const result = await supabase.rpc("book_bus", {
            p_bus_id: bus.id,
            p_passenger_name: passengerName,
            p_seat_count: seatCount,
            p_payment_method: paymentMethod
        });
        const booking = throwIfError(result);
        const tokens = readBookingTokens().filter(function(item) { return item.id !== booking.id; });
        tokens.unshift({ id: booking.id, token: booking.cancel_token });
        try {
            localStorage.setItem(bookingTokensKey, JSON.stringify(tokens));
        } catch {
            const rollback = await supabase.rpc("cancel_my_booking", {
                p_booking_id: booking.id,
                p_cancel_token: booking.cancel_token
            });
            if (rollback.error || !rollback.data) {
                throw new Error("The booking was saved but could not be stored in this browser. Contact the bus company with reference " +
                    booking.id.slice(0, 8).toUpperCase() + ".");
            }
            throw new Error("This browser could not store booking details, so the seat reservation was cancelled. Check browser storage and try again.");
        }
        return Object.assign(mapBooking(booking, false), {
            company: bus.company,
            logo: bus.logo
        });
    }

    async function cancelBooking(bookingId) {
        const token = readBookingTokens().find(function(item) { return item.id === bookingId; });
        if (!token) throw new Error("This booking can only be cancelled from the browser where it was made.");
        const result = await supabase.rpc("cancel_my_booking", {
            p_booking_id: bookingId,
            p_cancel_token: token.token
        });
        if (!throwIfError(result)) throw new Error("This booking is already cancelled or can no longer be cancelled.");
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
        const result = await supabase.auth.signUp({
            email: email,
            password: password,
            options: { data: { company_name: companyName } }
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
        setScheduleActive: setScheduleActive,
        removeSchedule: removeSchedule,
        createBooking: createBooking,
        cancelBooking: cancelBooking,
        signIn: signIn,
        sendPasswordRecovery: sendPasswordRecovery,
        updatePassword: updatePassword,
        signUp: signUp,
        signOut: signOut
    };
})();
