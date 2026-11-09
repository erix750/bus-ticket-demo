function createTripService(supabase) {
    function rwandaDateTime(now) {
        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Africa/Kigali",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        }).formatToParts(now || new Date()).reduce(function(result, part) {
            result[part.type] = part.value;
            return result;
        }, {});
        return {
            date: parts.year + "-" + parts.month + "-" + parts.day,
            time: parts.hour + ":" + parts.minute
        };
    }

    function mapTrip(record) {
        const company = Array.isArray(record.companies) ? record.companies[0] : record.companies;
        return {
            id: record.id,
            from: record.from_city,
            to: record.to_city,
            date: record.travel_date,
            departureTime: String(record.departure_time).slice(0, 5),
            name: record.name,
            company: company && company.name ? company.name : "",
            availableSeats: Number(record.available_seats),
            fare: Number(record.fare),
            routeDistanceKm: Number(record.route_distance_km) || 0
        };
    }

    function isUpcoming(trip, now) {
        return trip.date > now.date || (trip.date === now.date && trip.departureTime > now.time);
    }

    async function listUpcoming() {
        const now = rwandaDateTime();
        const result = await supabase
            .from("buses")
            .select("id, from_city, to_city, travel_date, departure_time, name, available_seats, fare, route_distance_km, companies(name)")
            .eq("is_active", true)
            .gt("available_seats", 0)
            .gte("travel_date", now.date)
            .order("travel_date")
            .order("departure_time")
            .limit(1000);
        if (result.error) throw new Error(result.error.message);
        return result.data.map(mapTrip).filter(function(trip) {
            return isUpcoming(trip, now) && trip.from && trip.to &&
                trip.routeDistanceKm > 0 && trip.fare > 0;
        });
    }

    async function listForRoute(origin, destination, date) {
        return (await listUpcoming()).filter(function(trip) {
            return trip.from.toLocaleLowerCase() === origin.toLocaleLowerCase() &&
                trip.to.toLocaleLowerCase() === destination.toLocaleLowerCase() &&
                trip.date === date;
        });
    }

    async function getAvailableById(id) {
        const now = rwandaDateTime();
        const result = await supabase
            .from("buses")
            .select("id, from_city, to_city, travel_date, departure_time, name, available_seats, fare, route_distance_km, companies(name)")
            .eq("id", id)
            .eq("is_active", true)
            .gt("available_seats", 0)
            .maybeSingle();
        if (result.error) throw new Error(result.error.message);
        if (!result.data) return null;
        const trip = mapTrip(result.data);
        return isUpcoming(trip, now) && trip.routeDistanceKm > 0 && trip.fare > 0
            ? trip
            : null;
    }

    function travelDates() {
        const now = rwandaDateTime();
        const date = new Date(now.date + "T12:00:00Z");
        date.setUTCDate(date.getUTCDate() + 1);
        return {
            today: now.date,
            tomorrow: date.toISOString().slice(0, 10)
        };
    }

    return { listUpcoming, listForRoute, getAvailableById, travelDates };
}

module.exports = { createTripService };
