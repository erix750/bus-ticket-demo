function createMapService() {
    function routeSummary(trip) {
        const distance = Number(trip.routeDistanceKm);
        const from = trip.from.length > 18 ? trip.from.slice(0, 15) + "..." : trip.from;
        const to = trip.to.length > 18 ? trip.to.slice(0, 15) + "..." : trip.to;
        return Number.isFinite(distance) && distance > 0
            ? from + " to " + to + " (" + distance + " km)"
            : from + " to " + to;
    }

    return { routeSummary };
}

module.exports = { createMapService };
