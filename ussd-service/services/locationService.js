function createLocationService() {
    function listOrigins(trips) {
        return Array.from(new Set(trips.map(function(trip) { return trip.from; })))
            .sort(function(first, second) { return first.localeCompare(second); });
    }

    function listDestinations(trips, origin) {
        return Array.from(new Set(trips.filter(function(trip) {
            return trip.from.toLocaleLowerCase() === origin.toLocaleLowerCase();
        }).map(function(trip) { return trip.to; })))
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
