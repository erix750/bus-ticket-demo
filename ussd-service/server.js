require("dotenv").config();

const express = require("express");
const { createSupabaseClient } = require("./config/supabase");
const { createUssdController } = require("./controllers/ussdController");
const { createSecurityMiddleware } = require("./middleware/security");
const { createBookingService } = require("./services/bookingService");
const { createFareService } = require("./services/fareService");
const { createLanguageService } = require("./services/languageService");
const { createLocalDemoService } = require("./services/localDemoService");
const { createLocationService } = require("./services/locationService");
const { createMapService } = require("./services/mapService");
const { createMsisdnService } = require("./services/msisdnService");
const { createPaymentService } = require("./services/paymentService");
const { createSeatService } = require("./services/seatService");
const { createSessionService } = require("./services/sessionService");
const { createTripService } = require("./services/tripService");
const ussdRoutes = require("./routes/ussd");
const path = require("node:path");

const localDemoMode = process.env.LOCAL_USSD_DEMO !== "false";
const simulatorEnabled = localDemoMode || process.env.USSD_SIMULATOR_ENABLED === "true";
const fareService = createFareService();
const localDemo = localDemoMode ? createLocalDemoService(fareService) : null;
const supabase = localDemo ? localDemo.client : createSupabaseClient();
const services = {
    bookingService: createBookingService(supabase),
    fareService: fareService,
    languageService: createLanguageService(),
    locationService: createLocationService(),
    mapService: createMapService(),
    msisdnService: createMsisdnService(),
    paymentService: createPaymentService(),
    seatService: createSeatService(),
    sessionService: createSessionService(supabase, {
        ttlSeconds: Number(process.env.USSD_SESSION_TTL_SECONDS) || 600
    }),
    tripService: createTripService(supabase)
};

const app = express();
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false, limit: "8kb" }));
app.use(express.json({ limit: "8kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", function(_request, response) {
    response.status(200).type("text/plain").send("ok");
});
if (simulatorEnabled) {
    const security = createSecurityMiddleware({
        callbackToken: require("node:crypto").randomBytes(32).toString("base64url"),
        serviceCode: process.env.USSD_SERVICE_CODE || "*200#",
        requestsPerMinute: Number(process.env.USSD_RATE_LIMIT_PER_MINUTE) || 40
    });
    const simulatorController = createUssdController(services);
    app.get("/simulator", function(_request, response) {
        response.sendFile(require("node:path").join(__dirname, "public", "simulator.html"));
    });
    app.get("/simulator/api/status", async function(_request, response, next) {
        try {
            const trips = localDemo
                ? localDemo.trips()
                : await services.tripService.listUpcoming();
        response.json({
            mode: localDemoMode ? "sample" : "supabase",
            source: localDemo ? localDemo.source : "Live Supabase trip schedules and seat availability.",
            tripCount: trips.length,
            trips: trips.map(function(trip) {
                return {
                    from: trip.from_city || trip.from,
                    to: trip.to_city || trip.to,
                    date: trip.travel_date || trip.date,
                    departureTime: String(trip.departure_time || trip.departureTime).slice(0, 5),
                    bus: trip.name,
                    seats: trip.available_seats === undefined ? trip.availableSeats : trip.available_seats,
                    fare: trip.fare
                };
            }),
            bookingCount: localDemo ? localDemo.bookings().length : null,
            serviceCode: process.env.USSD_SERVICE_CODE || "*200#"
        });
        } catch (error) {
            next(error);
        }
    });
    app.post(
        "/simulator/api/ussd",
        security.rateLimit,
        security.validateCallback,
        simulatorController
    );
    if (!localDemoMode) {
        console.log("USSD simulator is local-only; phone service mode is disabled.");
    }
} else {
    app.use("/ussd", ussdRoutes({
        controller: createUssdController(services),
        security: createSecurityMiddleware({
            callbackToken: process.env.USSD_CALLBACK_TOKEN,
            serviceCode: process.env.USSD_SERVICE_CODE || "*200#",
            requestsPerMinute: Number(process.env.USSD_RATE_LIMIT_PER_MINUTE) || 40
        })
    }));
}
app.use(function(error, _request, response, _next) {
    console.error("USSD service request failed:", error.message);
    if (response.headersSent) return;
    response.status(500).type("text/plain").send("END The service is temporarily unavailable. Please try again later.");
});

const port = Number(process.env.PORT) || 3000;
const host = simulatorEnabled ? "127.0.0.1" : process.env.HOST || "0.0.0.0";
app.listen(port, host, function() {
    console.log("Wayline USSD " + (simulatorEnabled ? "simulator" : "service") +
        " listening on http://" + host + ":" + port +
        (simulatorEnabled ? "/simulator" : "/ussd"));
});
