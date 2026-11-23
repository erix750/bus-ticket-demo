const test = require("node:test");
const assert = require("node:assert/strict");

const loadModule = function() {
    return import("../supabase/functions/send-booking-sms/message.mjs");
};

const booking = {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    from_city: "Kigali",
    to_city: "Musanze",
    travel_date: "2026-11-25",
    departure_time: "07:30:00",
    seat_count: 2,
    total_fare: "6000.00",
    passenger_phone: "+250781234567",
    cancelled: false,
    confirmation_sms_sent_at: null
};

test("confirmation SMS contains the reference, route, time, seats and fare", async function() {
    const { buildConfirmationMessage } = await loadModule();
    const message = buildConfirmationMessage(booking, "https://example.org/app/");
    assert.match(message, /A1B2C3D4E5F6/);
    assert.match(message, /Kigali to Musanze/);
    assert.match(message, /25 Nov 2026 07:30/);
    assert.match(message, /2 seats/);
    assert.match(message, /RWF 6,000/);
    assert.match(message, /https:\/\/example\.org\/app\/booking\.html/);
    assert.ok(message.length <= 320, "message should fit two SMS segments");
});

test("confirmation SMS strips accents so it stays a plain GSM message", async function() {
    const { buildConfirmationMessage } = await loadModule();
    const message = buildConfirmationMessage(Object.assign({}, booking, { to_city: "Gisenyi Ruhengeri é" }), "");
    assert.doesNotMatch(message, /[^\x20-\x7E]/);
});

test("only new, active bookings with a Rwanda mobile number are texted", async function() {
    const { shouldSendConfirmation } = await loadModule();
    assert.equal(shouldSendConfirmation(booking), true);
    assert.equal(shouldSendConfirmation(Object.assign({}, booking, { cancelled: true })), false);
    assert.equal(shouldSendConfirmation(Object.assign({}, booking, { confirmation_sms_sent_at: "2026-11-23T00:00:00Z" })), false);
    assert.equal(shouldSendConfirmation(Object.assign({}, booking, { passenger_phone: "0781234567" })), false);
    assert.equal(shouldSendConfirmation(null), false);
});
