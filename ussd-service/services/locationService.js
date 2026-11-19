const routeUtils = require("../../route-utils");

function createLocationService() {
    function pathForTrip(trip) {
        const path = routeUtils.routePath(trip.from, trip.to, trip.intermediateStops);
        const segments = trip.routeSegments || [];
        if (!path.length || segments.length !== path.length - 1) return [trip.from, trip.to];
        const validSegments = segments.every(function(segment, index) {
            return routeUtils.normalizeCity(segment.from) === routeUtils.normalizeCity(path[index]) &&
                routeUtils.normalizeCity(segment.to) === routeUtils.normalizeCity(path[index + 1]) &&
                Number.isFinite(segment.distanceKm) && segment.distanceKm >= 0.1;
        });
        return validSegments ? path : [trip.from, trip.to];
    }

    function listOrigins(trips) {
        const origins = [];
        trips.forEach(function(trip) {
            pathForTrip(trip).slice(0, -1).forEach(function(city) { origins.push(city); });
        });
        return Array.from(new Set(origins))
            .sort(function(first, second) { return first.localeCompare(second); });
    }

    function listDestinations(trips, origin) {
        const destinations = [];
        trips.forEach(function(trip) {
            const path = pathForTrip(trip);
            const originIndex = path.findIndex(function(city) {
                return routeUtils.normalizeCity(city) === routeUtils.normalizeCity(origin);
            });
            if (originIndex >= 0) destinations.push.apply(destinations, path.slice(originIndex + 1));
        });
        return Array.from(new Set(destinations))
            .sort(function(first, second) { return first.localeCompare(second); });
    }

    function page(items, pageNumber, pageSize) {
        const size = pageSize || 7;
        const pageCount = Math.max(1, Math.ceil(items.length / size));
        const currentPage = Math.min(Math.max(0, pageNumber || 0), pageCount - 1);
        return {
            items: items.slice(currentPage * size, (currentPage + 1) * size),
            page: currentPage,
            pageCount: pageCount,
            hasPrevious: currentPage > 0,
            hasNext: currentPage + 1 < pageCount
        };
    }

    function selectPageChoice(value, pageData) {
        if (value === "0" && pageData.hasPrevious) return { direction: "previous" };
        if (value === "9" && pageData.hasNext) return { direction: "next" };
        const index = Number(value) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= pageData.items.length) return null;
        return { item: pageData.items[index] };
    }

    return { listOrigins, listDestinations, page, selectPageChoice };
}

module.exports = { createLocationService };
