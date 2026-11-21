"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateFare, formatRoute } = require("../route-utils");

test("calculates and rounds fares for both RURA fare categories", function() {
    assert.equal(calculateFare(10, "kigali"), 593);
    assert.equal(calculateFare(10, "intercity"), 416);
    assert.equal(calculateFare(2.5, "kigali"), 148);
});

test("returns zero for invalid fare distances or categories", function() {
    assert.equal(calculateFare(0, "kigali"), 0);
    assert.equal(calculateFare(-1, "intercity"), 0);
    assert.equal(calculateFare(Number.NaN, "kigali"), 0);
    assert.equal(calculateFare(Number.POSITIVE_INFINITY, "kigali"), 0);
    assert.equal(calculateFare(10, "unknown"), 0);
});

test("formats known city names canonically and trims route input", function() {
    assert.equal(formatRoute("  kIGALI  ", "HUYE"), "Kigali to Huye");
});

test("formats and title-cases route names not in the known-city list", function() {
    assert.equal(formatRoute(" new city ", "lake-view"), "New City to Lake-View");
});
