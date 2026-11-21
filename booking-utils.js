(function(root, factory) {
    const bookingUtils = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = bookingUtils;
    } else {
        root.WaylineBookingUtils = bookingUtils;
    }
})(typeof globalThis === "object" ? globalThis : this, function() {
    function normalizeRwandaPhoneNumber(value) {
        let phone = value.trim().replace(/[\s()-]/g, "");
        if (/^0[0-9]{9}$/.test(phone)) {
            phone = "+250" + phone.slice(1);
        } else if (/^250[0-9]{9}$/.test(phone)) {
            phone = "+" + phone;
        }
        return /^\+2507[0-9]{8}$/.test(phone) ? phone : "";
    }

    function validatePassengerNames(names, seatCount) {
        return Array.isArray(names) &&
            names.length === seatCount &&
            names.every(function(name) {
                return typeof name === "string" && name.trim().length >= 1 && name.trim().length <= 80;
            });
    }

    return Object.freeze({
        normalizeRwandaPhoneNumber: normalizeRwandaPhoneNumber,
        validatePassengerNames: validatePassengerNames
    });
});
