function createFareService() {
    const ratesPerKm = {
        kigali: 59.28,
        intercity: 41.58
    };

    function calculate(distanceKm, fareCategory) {
        const distance = Number(distanceKm);
        const rate = ratesPerKm[fareCategory];
        if (!Number.isFinite(distance) || distance <= 0 || !rate) {
            throw new Error("Enter a valid route distance and fare category.");
        }
        return Math.round(distance * rate);
    }

    function formatRwf(amount) {
        const value = Number(amount);
        if (!Number.isFinite(value) || value < 0) throw new Error("Invalid trip fare.");
        return "RWF " + new Intl.NumberFormat("en-RW", {
            maximumFractionDigits: 0
        }).format(value);
    }

    function total(farePerSeat, seats) {
        if (!Number.isFinite(Number(farePerSeat)) || !Number.isInteger(seats) || seats < 1) {
            throw new Error("Invalid fare calculation.");
        }
        return Number(farePerSeat) * seats;
    }

    return { calculate, formatRwf, total, ratesPerKm };
}

module.exports = { createFareService };
