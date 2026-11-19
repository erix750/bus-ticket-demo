const routeUtils = require("../../route-utils");

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
            from: routeUtils.canonicalCity(record.from_city),
            to: routeUtils.canonicalCity(record.to_city),
            date: record.travel_date,
            departureTime: String(record.departure_time).slice(0, 5),
            name: record.name,
            company: company && company.name ? company.name : "",
            availableSeats: Number(record.available_seats),
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
            isCancelled: record.is_cancelled === true,
            companyApproved: Boolean(company && company.approval_status === "approved")
        };
    }

    function isUpcoming(trip, now) {
        return trip.date > now.date || (trip.date === now.date && trip.departureTime > now.time);
    }

    function selectTrips(now, id, includeSegments) {
        const columns = [
            "id", "from_city", "to_city", "travel_date", "departure_time", "name",
            "available_seats", "fare", "route_distance_km", "fare_category",
            "estimated_duration_minutes", "intermediate_stops", "is_cancelled",
            "companies(name, approval_status)"
        ];
        if (includeSegments) columns.splice(columns.indexOf("companies(name, approval_status)"), 0, "route_segments");
        let query = supabase
            .from("buses")
            .select(columns.join(", "))
            .eq("is_active", true)
            .eq("is_cancelled", false)
            .gt("available_seats", 0)
            .gte("travel_date", now.date);
        if (id) return query.eq("id", id).maybeSingle();
        return query.order("travel_date").order("departure_time").limit(1000);
    }

    async function fetchTrips(now, id) {
        let result = await selectTrips(now, id, true);
        if (result.error && (result.error.code === "42703" || /route_segments/i.test(result.error.message || ""))) {
            result = await selectTrips(now, id, false);
        }
        if (result.error) throw new Error(result.error.message);
        return result.data;
    }

    function withRouteSection(trip, origin, destination) {
        let fareDetails = null;
        if (trip.routeSegments.length) {
            fareDetails = routeUtils.calculateSegmentFare(
                trip.from,
                trip.to,
                trip.intermediateStops,
                trip.routeSegments,
                origin,
                destination,
                trip.fareCategory
            );
        } else if (routeUtils.normalizeCity(trip.from) === routeUtils.normalizeCity(origin) &&
            routeUtils.normalizeCity(trip.to) === routeUtils.normalizeCity(destination)) {
            fareDetails = {
                from: trip.from,
                to: trip.to,
                distanceKm: trip.routeDistanceKm,
                fare: trip.fare
            };
        }
        if (!fareDetails) return null;
        const section = routeUtils.findRouteSection(
            trip.from,
            trip.to,
            trip.intermediateStops,
            fareDetails.from,
            fareDetails.to
        );
        return Object.assign({}, trip, {
            selectedFrom: fareDetails.from,
            selectedTo: fareDetails.to,
            selectedDistanceKm: fareDetails.distanceKm,
            selectedFare: fareDetails.fare,
            selectedStops: section.slice(1, -1)
        });
    }

    async function listUpcoming() {
        const now = rwandaDateTime();
        const records = await fetchTrips(now);
        return records.map(mapTrip).filter(function(trip) {
            return trip.companyApproved && !trip.isCancelled && isUpcoming(trip, now) && trip.from && trip.to &&
                trip.routeDistanceKm > 0 && trip.fare > 0;
        });
    }

    async function listForRoute(origin, destination, date, company) {
        return (await listUpcoming()).filter(function(trip) {
            return trip.date === date &&
                (!company || trip.company.toLocaleLowerCase() === company.toLocaleLowerCase());
        }).map(function(trip) {
            return withRouteSection(trip, origin, destination);
        }).filter(Boolean);
    }

    async function getAvailableById(id, origin, destination) {
        const now = rwandaDateTime();
        const record = await fetchTrips(now, id);
        if (!record) return null;
        const trip = mapTrip(record);
        if (!trip.companyApproved || trip.isCancelled || !isUpcoming(trip, now) ||
            trip.routeDistanceKm <= 0 || trip.fare <= 0) return null;
        return origin && destination ? withRouteSection(trip, origin, destination) : trip;
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
