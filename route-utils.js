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

    function routePath(from, to, stops) {
        const path = [canonicalCity(from)].concat(parseStops(stops), [canonicalCity(to)]);
        return path.length >= 2 && path.every(Boolean) ? path : [];
    }

    function findRouteSection(from, to, stops, origin, destination) {
        const path = routePath(from, to, stops);
        const startIndex = path.findIndex(function(city) {
            return normalizeCity(city) === normalizeCity(origin);
        });
        if (startIndex < 0) return [];
        const endIndex = path.findIndex(function(city, index) {
            return index > startIndex && normalizeCity(city) === normalizeCity(destination);
        });
        return endIndex > startIndex ? path.slice(startIndex, endIndex + 1) : [];
    }

    function buildRouteSegments(from, to, stops, distances) {
        const path = routePath(from, to, stops);
        if (!path.length || !Array.isArray(distances) || distances.length !== path.length - 1) return null;
        const segments = distances.map(function(value, index) {
            const distanceKm = Number(value);
            if (!Number.isFinite(distanceKm) || distanceKm < 0.1 || distanceKm > 1000) return null;
            return { from: path[index], to: path[index + 1], distanceKm: distanceKm };
        });
        return segments.every(Boolean) ? segments : null;
    }

    function calculateSegmentFare(from, to, stops, segments, origin, destination, fareCategory) {
        const path = routePath(from, to, stops);
        const rates = { kigali: 59.28, intercity: 41.58 };
        const rate = rates[fareCategory];
        if (!rate || !Array.isArray(segments) || segments.length !== path.length - 1) return null;

        for (let index = 0; index < segments.length; index += 1) {
            const segment = segments[index];
            const distance = Number(segment && segment.distanceKm);
            if (!segment ||
                normalizeCity(segment.from) !== normalizeCity(path[index]) ||
                normalizeCity(segment.to) !== normalizeCity(path[index + 1]) ||
                !Number.isFinite(distance) || distance < 0.1 || distance > 1000) {
                return null;
            }
        }

        const section = findRouteSection(from, to, stops, origin, destination);
        if (section.length < 2) return null;
        const startIndex = path.findIndex(function(city) {
            return normalizeCity(city) === normalizeCity(section[0]);
        });
        const endIndex = startIndex + section.length - 1;
        const distanceKm = segments.slice(startIndex, endIndex).reduce(function(total, segment) {
            return total + Number(segment.distanceKm);
        }, 0);
        if (!Number.isFinite(distanceKm) || distanceKm > 1000) return null;
        return {
            from: section[0],
            to: section[section.length - 1],
            distanceKm: Number(distanceKm.toFixed(2)),
            fare: Math.round(distanceKm * rate)
        };
    }

    return Object.freeze({
        canonicalCity: canonicalCity,
        cities: Object.freeze(knownCities.slice()),
        formatRoute: formatRoute,
        normalizeCity: normalizeCity,
        parseStops: parseStops,
        routePath: routePath,
        findRouteSection: findRouteSection,
        buildRouteSegments: buildRouteSegments,
        calculateSegmentFare: calculateSegmentFare
    });
});
