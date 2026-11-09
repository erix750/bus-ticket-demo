const test = require("node:test");
const assert = require("node:assert/strict");
const { createBookingService } = require("../services/bookingService");

test("booking service calls the idempotent USSD RPC with validated flow details", async function() {
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
        phone: "+250781234567",
        seats: 2,
        paymentMethod: "MTN Mobile Money"
    });
    assert.equal(rpcCall.name, "ussd_book_bus");
    assert.equal(rpcCall.parameters.p_session_id, "AT-session-123");
    assert.equal(rpcCall.parameters.p_seat_count, 2);
    assert.equal(rpcCall.parameters.p_payment_method, "MTN Mobile Money");
    assert.equal(result.payment_status, "demo-unpaid");
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
