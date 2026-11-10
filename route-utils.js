(function(root, factory) {
    const routeUtils = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = routeUtils;
    } else {
        root.WaylineRouteUtils = routeUtils;
    }
})(typeof globalThis === "object" ? globalThis : this, function() {
    const knownCities = [
        "Gicumbi",
        "Gakenke",
        "Gatsibo",
        "Gisagara",
        "Huye",
        "Kayonza",
        "Karongi",
        "Kigali",
        "Kirehe",
        "Muhanga",
        "Musanze",
        "Nyamata",
        "Nyamasheke",
        "Ngoma",
        "Nyagatare",
        "Nyamagabe",
        "Nyaruguru",
        "Nyanza",
        "Rubavu",
        "Ruhango",
        "Rulindo",
        "Rusumo",
        "Rutsiro",
        "Rusizi",
        "Burera",
        "Bugesera",
        "Rwamagana"
    ];

    function cleanCity(value) {
        return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
    }

    function canonicalCity(value) {
        const city = cleanCity(value);
        const knownCity = knownCities.find(function(candidate) {
            return candidate.toLocaleLowerCase() === city.toLocaleLowerCase();
        });
        if (knownCity) return knownCity;
        return city.toLocaleLowerCase().replace(/(^|[\s'-])\p{L}/gu, function(match) {
            return match.toLocaleUpperCase();
        });
    }

    function normalizeCity(value) {
        return canonicalCity(value).toLocaleLowerCase();
    }

    function formatRoute(from, to) {
        return canonicalCity(from) + " to " + canonicalCity(to);
    }

    function parseStops(value) {
        return String(value || "")
            .split(/[,\n]/)
            .map(canonicalCity)
            .filter(Boolean);
    }

    return Object.freeze({
        canonicalCity: canonicalCity,
        cities: Object.freeze(knownCities.slice()),
        formatRoute: formatRoute,
        normalizeCity: normalizeCity,
        parseStops: parseStops
    });
});
