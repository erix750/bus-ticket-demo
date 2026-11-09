const test = require("node:test");
const assert = require("node:assert/strict");
const { createFareService } = require("../services/fareService");
const { createLocalDemoService } = require("../services/localDemoService");
const { createTripService } = require("../services/tripService");

test("local prototype supplies future, priced trips with route distances", async function() {
    const fares = createFareService();
    const demo = createLocalDemoService(fares);
    const trips = await createTripService(demo.client).listUpcoming();
    assert.ok(trips.length > 0);
    assert.ok(trips.every(function(trip) {
        return trip.availableSeats > 0 && trip.routeDistanceKm > 0 &&
            trip.fare === fares.calculate(trip.routeDistanceKm, "intercity");
    }));
    assert.ok(trips.some(function(trip) {
        return trip.from === "Kigali" && trip.to === "Huye";
    }));
});

test("local prototype books a seat, reduces availability, and is idempotent by USSD session", async function() {
    const demo = createLocalDemoService(createFareService());
    const trip = (await createTripService(demo.client).listUpcoming())[0];
    const originalSeats = trip.availableSeats;
    const parameters = {
        p_session_id: "AT-local-session",
        p_bus_id: trip.id,
        p_passenger_name: "Test Passenger",
        p_passenger_phone: "+250781234567",
        p_seat_count: 2,
        p_payment_method: "MTN Mobile Money"
    };

    const first = await demo.client.rpc("ussd_book_bus", parameters);
    const repeated = await demo.client.rpc("ussd_book_bus", parameters);
    const refreshedTrip = await createTripService(demo.client).getAvailableById(trip.id);

    assert.equal(first.error, null);
    assert.equal(first.data.id, repeated.data.id);
    assert.equal(first.data.payment_status, "demo-unpaid");
    assert.equal(refreshedTrip.availableSeats, originalSeats - 2);
    assert.equal(demo.bookings().length, 1);
});

test("local prototype rejects overselling and invalid caller data", async function() {
    const demo = createLocalDemoService(createFareService());
    const trip = (await createTripService(demo.client).listUpcoming())[0];
    const result = await demo.client.rpc("ussd_book_bus", {
        p_session_id: "AT-invalid-session",
        p_bus_id: trip.id,
        p_passenger_name: "Test Passenger",
        p_passenger_phone: "+250781234567",
        p_seat_count: trip.availableSeats + 1,
        p_payment_method: "Airtel Money"
    });
    assert.match(result.error.message, /no longer available/i);
    assert.equal(demo.bookings().length, 0);
});
