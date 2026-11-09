function createMsisdnService() {
    function normalize(value) {
        const compact = String(value || "").trim().replace(/[\s()-]/g, "");
        let phone = compact;
        if (/^0[0-9]{9}$/.test(phone)) phone = "+250" + phone.slice(1);
        else if (/^250[0-9]{9}$/.test(phone)) phone = "+" + phone;
        return /^\+2507[0-9]{8}$/.test(phone) ? phone : "";
    }

    return { normalize };
}

module.exports = { createMsisdnService };
