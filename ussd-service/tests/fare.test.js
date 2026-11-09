const test = require("node:test");
const assert = require("node:assert/strict");
const { createFareService } = require("../services/fareService");
const { createSeatService } = require("../services/seatService");

test("fare service formats the stored fare and multiplies by seat count", function() {
    const fares = createFareService();
    assert.match(fares.formatRwf(12500), /12,500/);
    assert.equal(fares.total(12500, 2), 25000);
    assert.equal(fares.calculate(10, "kigali"), 593);
    assert.equal(fares.calculate(10, "intercity"), 416);
});

test("fare service rejects invalid values", function() {
    const fares = createFareService();
    assert.throws(function() { fares.formatRwf(-1); }, /Invalid trip fare/);
    assert.throws(function() { fares.total(1000, 0); }, /Invalid fare calculation/);
});

test("seat choices never exceed remaining seats or the USSD limit", function() {
    const seats = createSeatService();
    assert.deepEqual(seats.options(2), [1, 2]);
    assert.deepEqual(seats.options(20), [1, 2, 3, 4]);
    assert.equal(seats.isAvailable(2, 3), false);
    assert.equal(seats.isAvailable(2, 2), true);
});
