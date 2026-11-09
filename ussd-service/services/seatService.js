function createSeatService() {
    function options(availableSeats) {
        const count = Number(availableSeats);
        if (!Number.isInteger(count) || count < 1) return [];
        return Array.from({ length: Math.min(count, 4) }, function(_value, index) {
            return index + 1;
        });
    }

    function isAvailable(availableSeats, requestedSeats) {
        return Number.isInteger(requestedSeats) &&
            requestedSeats > 0 &&
            requestedSeats <= Number(availableSeats);
    }

    return { options, isAvailable };
}

module.exports = { createSeatService };
