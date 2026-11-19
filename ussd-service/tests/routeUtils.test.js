const test = require("node:test");
const assert = require("node:assert/strict");
const routeUtils = require("../../route-utils");
const { createMapService } = require("../services/mapService");
const { createLocationService } = require("../services/locationService");

test("route labels canonicalize known and custom city names consistently", function() {
    assert.equal(routeUtils.formatRoute("  kigali  ", "HUYE"), "Kigali to Huye");
    assert.equal(routeUtils.formatRoute("nyabihu   district", "Kigali"), "Nyabihu District to Kigali");
});

test("route stops are normalized and empty stops are omitted", function() {
    assert.deepEqual(routeUtils.parseStops(" muhanga,  nyanza\nHuye "), [
        "Muhanga",
        "Nyanza",
        "Huye"
    ]);
    assert.deepEqual(routeUtils.parseStops(" , \n"), []);
});

test("route sections include only forward ordered stops", function() {
    assert.deepEqual(
        routeUtils.findRouteSection("Kigali", "Ngoma", "Rwamagana, Kayonza", "Kigali", "Kayonza"),
        ["Kigali", "Rwamagana", "Kayonza"]
    );
    assert.deepEqual(
        routeUtils.findRouteSection("Kigali", "Ngoma", "Rwamagana, Kayonza", "Kayonza", "Rwamagana"),
        []
    );
    assert.deepEqual(
        routeUtils.findRouteSection("Kigali", "Ngoma", "Rwamagana, Kayonza", "Kayonza", "Huye"),
        []
    );
});

test("route segment distances must match every adjacent stop in order", function() {
    assert.deepEqual(
        routeUtils.buildRouteSegments("Kigali", "Huye", "Muhanga, Nyanza", [40, 35, 45]),
        [
            { from: "Kigali", to: "Muhanga", distanceKm: 40 },
            { from: "Muhanga", to: "Nyanza", distanceKm: 35 },
            { from: "Nyanza", to: "Huye", distanceKm: 45 }
        ]
    );
    assert.equal(routeUtils.buildRouteSegments("Kigali", "Huye", "Muhanga, Nyanza", [40, 80]), null);
    assert.equal(routeUtils.buildRouteSegments("Kigali", "Huye", "Muhanga", [0]), null);
});

test("segment fares sum configured leg distances and reject mismatched routes", function() {
    const segments = [
        { from: "Kigali", to: "Rwamagana", distanceKm: 50 },
        { from: "Rwamagana", to: "Kayonza", distanceKm: 30 },
        { from: "Kayonza", to: "Ngoma", distanceKm: 20 }
    ];
    assert.deepEqual(
        routeUtils.calculateSegmentFare(
            "Kigali", "Ngoma", "Rwamagana, Kayonza", segments, "Rwamagana", "Ngoma", "intercity"
        ),
        { from: "Rwamagana", to: "Ngoma", distanceKm: 50, fare: 2079 }
    );
    assert.equal(
        routeUtils.calculateSegmentFare(
            "Kigali", "Ngoma", "Rwamagana, Kayonza", segments, "Kayonza", "Rwamagana", "intercity"
        ),
        null
    );
    assert.equal(
        routeUtils.calculateSegmentFare(
            "Kigali", "Ngoma", "Rwamagana, Kayonza", segments.slice(1), "Kigali", "Ngoma", "intercity"
        ),
        null
    );
});

test("USSD route summary includes intermediate stops, distance, and estimated duration", function() {
    assert.equal(
        createMapService().routeSummary({
            from: "Kigali",
            to: "Huye",
            routeDistanceKm: 120,
            estimatedDurationMinutes: 155,
            intermediateStops: "Muhanga, Nyanza"
        }),
        "Kigali to Huye (via Muhanga, Nyanza, 120 km, about 3h)"
    );
});

test("USSD origins and destinations use only verified forward route legs", function() {
    const trips = [{
        from: "Kigali",
        to: "Ngoma",
        intermediateStops: "Rwamagana, Kayonza",
        routeSegments: [
            { from: "Kigali", to: "Rwamagana", distanceKm: 50 },
            { from: "Rwamagana", to: "Kayonza", distanceKm: 30 },
            { from: "Kayonza", to: "Ngoma", distanceKm: 20 }
        ]
    }];
    const locations = createLocationService();
    assert.deepEqual(locations.listOrigins(trips), ["Kayonza", "Kigali", "Rwamagana"]);
    assert.deepEqual(locations.listDestinations(trips, "Rwamagana"), ["Kayonza", "Ngoma"]);
    assert.deepEqual(locations.listDestinations(trips, "Ngoma"), []);
});
