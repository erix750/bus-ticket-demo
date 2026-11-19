const routeUtils = require("../../route-utils");

function createMapService() {
    function routeSummary(trip) {
        const selectedFrom = trip.selectedFrom || trip.from;
        const selectedTo = trip.selectedTo || trip.to;
        const selectedDistance = Number(trip.selectedDistanceKm);
        const distance = selectedDistance > 0 ? selectedDistance : Number(trip.routeDistanceKm);
        const from = selectedFrom.length > 18 ? selectedFrom.slice(0, 15) + "..." : selectedFrom;
        const to = selectedTo.length > 18 ? selectedTo.slice(0, 15) + "..." : selectedTo;
        const route = routeUtils.formatRoute(from, to);
        const stops = (Array.isArray(trip.selectedStops)
            ? trip.selectedStops
            : routeUtils.parseStops(trip.intermediateStops))
            .slice(0, 2)
            .map(function(stop) {
                return stop.length > 18 ? stop.slice(0, 15) + "..." : stop;
            });
        const details = [];
        if (stops.length) details.push("via " + stops.slice(0, 2).join(", "));
        if (Number.isFinite(distance) && distance > 0) details.push(distance + " km");
        const isFullRoute = routeUtils.normalizeCity(selectedFrom) === routeUtils.normalizeCity(trip.from) &&
            routeUtils.normalizeCity(selectedTo) === routeUtils.normalizeCity(trip.to);
        if (isFullRoute && Number.isFinite(trip.estimatedDurationMinutes) && trip.estimatedDurationMinutes > 0) {
            details.push("about " + Math.ceil(trip.estimatedDurationMinutes / 60) + "h");
        }
        return details.length ? route + " (" + details.join(", ") + ")" : route;
    }

    return { routeSummary };
}

module.exports = { createMapService };
