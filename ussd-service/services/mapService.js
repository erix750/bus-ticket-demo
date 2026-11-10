const routeUtils = require("../../route-utils");

function createMapService() {
    function routeSummary(trip) {
        const distance = Number(trip.routeDistanceKm);
        const from = trip.from.length > 18 ? trip.from.slice(0, 15) + "..." : trip.from;
        const to = trip.to.length > 18 ? trip.to.slice(0, 15) + "..." : trip.to;
        const route = routeUtils.formatRoute(from, to);
        const stops = routeUtils.parseStops(trip.intermediateStops)
            .slice(0, 2)
            .map(function(stop) {
                return stop.length > 18 ? stop.slice(0, 15) + "..." : stop;
            });
        const details = [];
        if (stops.length) details.push("via " + stops.slice(0, 2).join(", "));
        if (Number.isFinite(distance) && distance > 0) details.push(distance + " km");
        if (Number.isFinite(trip.estimatedDurationMinutes) && trip.estimatedDurationMinutes > 0) {
            details.push("about " + Math.ceil(trip.estimatedDurationMinutes / 60) + "h");
        }
        return details.length ? route + " (" + details.join(", ") + ")" : route;
    }

    return { routeSummary };
}

module.exports = { createMapService };
