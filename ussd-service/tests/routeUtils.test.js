const test = require("node:test");
const assert = require("node:assert/strict");
const routeUtils = require("../../route-utils");
const { createMapService } = require("../services/mapService");

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
