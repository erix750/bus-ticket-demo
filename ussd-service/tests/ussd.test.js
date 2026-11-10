const test = require("node:test");
const assert = require("node:assert/strict");
const { createUssdController } = require("../controllers/ussdController");
const { createLanguageService } = require("../services/languageService");
const { createLocationService } = require("../services/locationService");
const { createMapService } = require("../services/mapService");
const { createMsisdnService } = require("../services/msisdnService");
const { createPaymentService } = require("../services/paymentService");
const { createSeatService } = require("../services/seatService");
const { createSecurityMiddleware } = require("../middleware/security");
const { parseUssdText } = require("../services/sessionService");
const { createFareService } = require("../services/fareService");

function createMemorySessions() {
    const sessions = new Map();
    return {
        parseUssdText,
        nextInput: function(session, parts) {
            return parts.length > session.inputCursor ? parts[session.inputCursor] : null;
        },
        load: async function(sessionId, phone) {
            return sessions.get(sessionId) || {
                sessionId: sessionId,
                phone: phone,
                inputCursor: 0,
                state: { step: "language", page: 0 }
            };
        },
        save: async function(sessionId, phone, state, inputCursor) {
            sessions.set(sessionId, {
                sessionId: sessionId,
                phone: state.step === "completed" ? null : phone,
                inputCursor: inputCursor,
                state: JSON.parse(JSON.stringify(state))
            });
        }
    };
}

function createTestController() {
    const trip = {
        id: "bus-1",
        from: "Kigali",
        to: "Huye",
        date: "2026-11-09",
        departureTime: "14:00",
        name: "Wayline Coach",
        company: "Wayline",
        fare: 5000,
        availableSeats: 10,
        routeDistanceKm: 120
    };
    const otherCompanyTrip = Object.assign({}, trip, {
        id: "bus-2",
        name: "Kigali Express Coach",
        company: "Kigali Express"
    });
    const trips = [trip, otherCompanyTrip];
    let bookingCount = 0;
    let bookedTripId = "";
    const controller = createUssdController({
        bookingService: {
            create: async function(input) {
                bookingCount += 1;
                bookedTripId = input.trip.id;
                return { id: "0123456789ab-cdef-0123-4567-89abcdef01" };
            }
        },
        fareService: createFareService(),
        languageService: createLanguageService(),
        locationService: createLocationService(),
        mapService: createMapService(),
        msisdnService: createMsisdnService(),
        paymentService: createPaymentService(),
        seatService: createSeatService(),
        sessionService: createMemorySessions(),
        tripService: {
            listUpcoming: async function() { return trips; },
            listForRoute: async function(from, to, date, company) {
                return trips.filter(function(item) {
                    return from === item.from && to === item.to && date === item.date &&
                        (!company || company === item.company);
                });
            },
            getAvailableById: async function(id) {
                return trips.find(function(item) { return id === item.id; }) || null;
            },
            travelDates: function() { return { today: trip.date, tomorrow: "2026-11-10" }; }
        }
    });

    return {
        controller: controller,
        bookingCount: function() { return bookingCount; },
        bookedTripId: function() { return bookedTripId; }
    };
}

function invoke(controller, body) {
    let output = "";
    return controller({ body: body }, {
        status: function() { return this; },
        type: function() { return this; },
        send: function(value) { output = value; return this; }
    }, function(error) {
        throw error;
    }).then(function() {
        return output;
    });
}

test("USSD booking completes in English and repeated final callbacks do not duplicate bookings", async function() {
    const app = createTestController();
    const base = { sessionId: "AT-session-1", serviceCode: "*123#", phoneNumber: "0781234567" };
    let text = "";
    const send = async function(value) {
        text = text ? text + "*" + value : value;
        return invoke(app.controller, Object.assign({}, base, { text: text }));
    };

    assert.match(await invoke(app.controller, Object.assign({}, base, { text: "" })), /^CON Choose language/);
    assert.match(await send("1"), /^CON 1\. Find a bus/);
    assert.match(await send("1"), /^CON Choose departure city/);
    assert.match(await send("1"), /^CON Choose destination/);
    assert.match(await send("1"), /^CON Travel date/);
    const companies = await send("1");
    assert.match(companies, /^CON Choose bus company:/);
    assert.match(companies, /1\. Kigali Express/);
    assert.match(companies, /2\. Wayline/);
    const tripChoices = await send("1");
    assert.match(tripChoices, /^CON Choose bus:/);
    assert.match(tripChoices, /Kigali E/);
    assert.match(await send("1"), /^CON Number of seats/);
    assert.match(await send("1"), /^CON Enter passenger full name/);
    assert.match(await send("Jane Doe"), /^CON Choose intended payment method/);
    assert.match(await send("1"), /^CON Kigali to Huye/);
    const result = await send("1");
    assert.match(result, /^END Booking confirmed\. Ref: 0123456789AB\. NOT PAID/);
    assert.equal(app.bookingCount(), 1);
    assert.equal(app.bookedTripId(), "bus-2");
    assert.equal(await invoke(app.controller, Object.assign({}, base, { text: text })), result);
    assert.equal(app.bookingCount(), 1);
});

test("invalid language selection can be retried without losing the session", async function() {
    const app = createTestController();
    const base = { sessionId: "AT-session-2", serviceCode: "*123#", phoneNumber: "+250781234567" };
    assert.match(await invoke(app.controller, Object.assign({}, base, { text: "" })), /^CON Choose language/);
    assert.match(await invoke(app.controller, Object.assign({}, base, { text: "9" })), /^CON Invalid choice/);
    assert.match(await invoke(app.controller, Object.assign({}, base, { text: "9*1" })), /^CON 1\. Find a bus/);
});

test("all four languages continue into a localized booking menu", async function() {
    const expected = [
        ["1", "Find a bus"],
        ["2", "Shaka imodoka"],
        ["3", "Chercher un bus"],
        ["4", "Tafuta basi"]
    ];
    for (let index = 0; index < expected.length; index += 1) {
        const app = createTestController();
        const body = {
            sessionId: "AT-language-" + index,
            serviceCode: "*200#",
            phoneNumber: "0781234567",
            text: ""
        };
        await invoke(app.controller, body);
        body.text = expected[index][0];
        const result = await invoke(app.controller, body);
        assert.ok(result.includes(expected[index][1]), result);
    }
});

test("unsupported phone formats are not allowed to start a booking", async function() {
    const app = createTestController();
    const result = await invoke(app.controller, {
        sessionId: "AT-session-3",
        serviceCode: "*123#",
        phoneNumber: "+15551234567",
        text: ""
    });
    assert.match(result, /^END This service requires a valid Rwanda mobile number/);
    assert.equal(app.bookingCount(), 0);
});

test("Africa's Talking callback authentication and request validation reject malformed requests", function() {
    const middleware = createSecurityMiddleware({
        callbackToken: "a".repeat(40),
        requestsPerMinute: 20
    });
    const request = {
        body: {
            sessionId: "AT-session",
            serviceCode: "*200#",
            phoneNumber: "0781234567",
            text: ""
        },
        query: {},
        ip: "127.0.0.1",
        get: function(name) {
            return name === "authorization" ? "Bearer " + "a".repeat(40) : "";
        }
    };
    let authenticated = false;
    middleware.authenticate(request, {}, function() { authenticated = true; });
    assert.equal(authenticated, true);

    let valid = false;
    middleware.validateCallback(request, {}, function() { valid = true; });
    assert.equal(valid, true);

    let statusCode = 0;
    const invalidRequest = Object.assign({}, request, {
        body: Object.assign({}, request.body, { serviceCode: "*123#" })
    });
    middleware.validateCallback(invalidRequest, {
        status: function(value) { statusCode = value; return this; },
        type: function() { return this; },
        send: function() {}
    }, function() {
        assert.fail("Malformed service code must not pass validation.");
    });
    assert.equal(statusCode, 400);
});
