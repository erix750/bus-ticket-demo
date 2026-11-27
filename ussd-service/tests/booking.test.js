const test = require("node:test");
const assert = require("node:assert/strict");
const { createBookingService } = require("../services/bookingService");

test("booking service sends a distinct passenger name for each seat", async function() {
    let rpcCall;
    const service = createBookingService({
        rpc: async function(name, parameters) {
            rpcCall = { name: name, parameters: parameters };
            return { data: { id: "booking-id", payment_status: "demo-unpaid" }, error: null };
        }
    });
    const result = await service.create({
        sessionId: "AT-session-123",
        trip: { id: "bus-id" },
        passengerName: "Jane Doe",
        passengerNames: ["Jane Doe", "John Doe", "Alex Doe"],
        phone: "+250781234567",
        seats: 3,
        paymentMethod: "MTN Mobile Money"
    });
    assert.equal(rpcCall.name, "ussd_book_bus");
    assert.equal(rpcCall.parameters.p_session_id, "AT-session-123");
    assert.equal(rpcCall.parameters.p_seat_count, 3);
    assert.equal(rpcCall.parameters.p_payment_method, "MTN Mobile Money");
    assert.deepEqual(rpcCall.parameters.p_passenger_names, ["Jane Doe", "John Doe", "Alex Doe"]);
    assert.equal(result.payment_status, "demo-unpaid");
});

test("booking service sends passenger names for segment bookings", async function() {
    let rpcCall;
    const service = createBookingService({
        rpc: async function(name, parameters) {
            rpcCall = { name: name, parameters: parameters };
            return { data: { id: "booking-id" }, error: null };
        }
    });
    await service.create({
        sessionId: "AT-session-456",
        trip: { id: "bus-id", from: "Kigali", to: "Huye" },
        passengerName: "Jane Doe",
        passengerNames: ["Jane Doe", "John Doe", "Alex Doe"],
        phone: "+250781234567",
        seats: 3,
        paymentMethod: "Airtel Money",
        origin: "Muhanga",
        destination: "Huye"
    });
    assert.equal(rpcCall.name, "ussd_book_bus_segment");
    assert.deepEqual(rpcCall.parameters.p_passenger_names, ["Jane Doe", "John Doe", "Alex Doe"]);
});

test("booking service reports database errors instead of claiming success", async function() {
    const service = createBookingService({
        rpc: async function() {
            return { data: null, error: { message: "No seats remain." } };
        }
    });
    await assert.rejects(service.create({
        sessionId: "AT-session-123",
        trip: { id: "bus-id" },
        passengerName: "Jane Doe",
        phone: "+250781234567",
        seats: 1,
        paymentMethod: "Airtel Money"
    }), /No seats remain/);
});
