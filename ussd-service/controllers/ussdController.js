function createUssdController(services) {
    const {
        bookingService,
        fareService,
        languageService,
        locationService,
        mapService,
        msisdnService,
        paymentService,
        seatService,
        sessionService,
        tripService
    } = services;

    function answer(kind, message) {
        return kind + " " + message;
    }

    function translate(state, key, values) {
        return languageService.text(state.language || "en", key, values);
    }

    function pageMessage(state, key, page, labelFor) {
        const lines = [translate(state, key)];
        page.items.forEach(function(item, index) {
            lines.push((index + 1) + ". " + labelFor(item));
        });
        if (page.hasPrevious) lines.push(translate(state, "previousPage"));
        if (page.hasNext) lines.push(translate(state, "nextPage"));
        if (page.pageCount > 1) {
            lines.push(translate(state, "pageNumber", { page: page.page + 1 }));
        }
        return { page: page, message: lines.join("\n") };
    }

    function pagePrompt(state, items, key, labelFor, pageSize) {
        return pageMessage(
            state,
            key,
            locationService.page(items, state.page, pageSize),
            labelFor
        );
    }

    function shortCity(city) {
        return city.length > 20 ? city.slice(0, 17) + "..." : city;
    }

    async function promptFor(state) {
        if (state.step === "language") return languageService.languagePrompt();
        if (state.step === "action") return translate(state, "mainMenu");
        if (state.step === "origin") {
            if (!state.originOptions) {
                state.originOptions = locationService.listOrigins(await tripService.listUpcoming());
            }
            const origins = state.originOptions;
            if (!origins.length) return translate(state, "noOrigins");
            return pagePrompt(state, origins, "originPrompt", shortCity, 4).message;
        }
        if (state.step === "destination") {
            if (!state.destinationOptions) {
                state.destinationOptions = locationService.listDestinations(
                    await tripService.listUpcoming(),
                    state.origin
                );
            }
            const destinations = state.destinationOptions;
            if (!destinations.length) return translate(state, "noDestinations");
            return pagePrompt(state, destinations, "destinationPrompt", shortCity, 4).message;
        }
        if (state.step === "date") return translate(state, "datePrompt");
        if (state.step === "trip") {
            const trips = await tripService.listForRoute(state.origin, state.destination, state.date);
            if (!trips.length) return translate(state, "noTrips");
            const page = locationService.page(trips, state.page, 4);
            if (!state.tripOptions || state.tripPage !== state.page) {
                state.tripOptions = page.items;
                state.tripPage = state.page;
            }
            page.items = state.tripOptions;
            return pageMessage(state, "tripPrompt", page, function(trip) {
                return trip.departureTime + " " + trip.name.slice(0, 8) + " " +
                    fareService.formatRwf(trip.fare);
            }).message;
        }
        if (state.step === "seats") {
            const trip = await tripService.getAvailableById(state.tripId);
            if (!trip) return translate(state, "tripUnavailable");
            return translate(state, "seatsPrompt") + "\n" + seatService.options(trip.availableSeats).map(function(seats) {
                return seats + ". " + seats;
            }).join("\n");
        }
        if (state.step === "name") return translate(state, "namePrompt");
        if (state.step === "payment") return translate(state, "paymentPrompt");
        if (state.step === "confirm") {
            const trip = await tripService.getAvailableById(state.tripId);
            if (!trip) return translate(state, "tripUnavailable");
            return translate(state, "confirmPrompt", {
                route: mapService.routeSummary(trip),
                seats: state.seats,
                total: fareService.formatRwf(fareService.total(trip.fare, state.seats)),
                method: state.paymentMethod
            });
        }
        if (state.step === "completed") {
            if (state.outcome === "cancelled") return translate(state, "cancelled");
            if (state.outcome === "unavailable") return translate(state, "tripUnavailable");
            return translate(state, "booked", { reference: state.reference });
        }
        throw new Error("Invalid stored USSD session step.");
    }

    async function saveAndContinue(session, state, cursor, kind) {
        const message = await promptFor(state);
        await sessionService.save(session.sessionId, session.phone, state, cursor);
        return answer(kind || "CON", message);
    }

    function isValidName(value) {
        const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
        return /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,78}[\p{L}\p{M}]$/u.test(name)
            ? name
            : "";
    }

    function completedState(state, outcome, reference) {
        return {
            step: "completed",
            language: state.language || "en",
            outcome: outcome,
            reference: reference || ""
        };
    }

    async function processCallback(body) {
        const phone = msisdnService.normalize(body.phoneNumber);
        if (!phone) return answer("END", "This service requires a valid Rwanda mobile number.");
        const session = await sessionService.load(body.sessionId, phone);
        if (session.state.step === "completed") {
            return answer("END", await promptFor(session.state));
        }

        const parts = sessionService.parseUssdText(body.text);
        const value = sessionService.nextInput(session, parts);
        if (value === null) {
            const prompt = await promptFor(session.state);
            await sessionService.save(session.sessionId, session.phone, session.state, session.inputCursor);
            return answer("CON", prompt);
        }

        const state = Object.assign({}, session.state);
        const nextCursor = session.inputCursor + 1;
        const invalid = async function() {
            await sessionService.save(session.sessionId, session.phone, state, parts.length);
            return answer("CON", translate(state, "invalidChoice") + "\n" + await promptFor(state));
        };

        if (state.step === "language") {
            const language = languageService.fromChoice(value);
            if (!language) return invalid();
            state.language = language;
            state.step = "action";
            state.page = 0;
            return saveAndContinue(session, state, nextCursor);
        }

        if (state.step === "action") {
            if (value === "0") {
                return saveAndContinue(
                    session,
                    completedState(state, "cancelled"),
                    nextCursor,
                    "END"
                );
            }
            if (value !== "1") return invalid();
            if (!(await tripService.listUpcoming()).length) {
                return answer("END", translate(state, "noTrips"));
            }
            state.step = "origin";
            state.page = 0;
            return saveAndContinue(session, state, nextCursor);
        }

        if (state.step === "origin" || state.step === "destination") {
            const options = state.step === "origin"
                ? (state.originOptions || locationService.listOrigins(await tripService.listUpcoming()))
                : (state.destinationOptions || locationService.listDestinations(
                    await tripService.listUpcoming(),
                    state.origin
                ));
            if (!options.length) return answer("END", translate(state, state.step === "origin" ? "noOrigins" : "noDestinations"));
            const page = locationService.page(options, state.page, 4);
            const choice = locationService.selectPageChoice(value, page);
            if (!choice) return invalid();
            if (choice.direction) {
                state.page += choice.direction === "next" ? 1 : -1;
                return saveAndContinue(session, state, nextCursor);
            }
            if (state.step === "origin") {
                state.origin = choice.item;
                state.step = "destination";
                state.originOptions = null;
                state.destinationOptions = null;
            } else {
                state.destination = choice.item;
                state.step = "date";
                state.destinationOptions = null;
            }
            state.page = 0;
            return saveAndContinue(session, state, nextCursor);
        }

        if (state.step === "date") {
            const dates = tripService.travelDates();
            if (value !== "1" && value !== "2") return invalid();
            state.date = value === "1" ? dates.today : dates.tomorrow;
            state.step = "trip";
            state.page = 0;
            state.tripOptions = null;
            state.tripPage = null;
            const trips = await tripService.listForRoute(state.origin, state.destination, state.date);
            if (!trips.length) return answer("END", translate(state, "noTrips"));
            return saveAndContinue(session, state, nextCursor);
        }

        if (state.step === "trip") {
            const trips = await tripService.listForRoute(state.origin, state.destination, state.date);
            if (!trips.length) return answer("END", translate(state, "noTrips"));
            const page = locationService.page(trips, state.page, 4);
            if (!state.tripOptions || state.tripPage !== state.page) {
                state.tripOptions = page.items;
                state.tripPage = state.page;
            }
            page.items = state.tripOptions;
            const choice = locationService.selectPageChoice(value, page);
            if (!choice) return invalid();
            if (choice.direction) {
                state.page += choice.direction === "next" ? 1 : -1;
                state.tripOptions = null;
                state.tripPage = null;
                return saveAndContinue(session, state, nextCursor);
            }
            state.tripId = choice.item.id;
            state.step = "seats";
            state.page = 0;
            return saveAndContinue(session, state, nextCursor);
        }

        if (state.step === "seats") {
            const trip = await tripService.getAvailableById(state.tripId);
            const seats = Number(value);
            if (!trip) {
                state.step = "trip";
                state.page = 0;
                state.tripOptions = null;
                state.tripPage = null;
                return saveAndContinue(session, state, nextCursor);
            }
            if (!seatService.isAvailable(trip.availableSeats, seats) || seats > 4) return invalid();
            state.seats = seats;
            state.step = "name";
            return saveAndContinue(session, state, nextCursor);
        }

        if (state.step === "name") {
            const name = isValidName(value);
            if (!name) {
                await sessionService.save(session.sessionId, session.phone, state, parts.length);
                return answer("CON", translate(state, "invalidName") + "\n" + translate(state, "namePrompt"));
            }
            state.passengerName = name;
            state.step = "payment";
            return saveAndContinue(session, state, nextCursor);
        }

        if (state.step === "payment") {
            const method = paymentService.fromChoice(value);
            if (!method) return invalid();
            state.paymentMethod = method;
            state.step = "confirm";
            return saveAndContinue(session, state, nextCursor);
        }

        if (state.step === "confirm") {
            if (value === "2") {
                return saveAndContinue(
                    session,
                    completedState(state, "cancelled"),
                    nextCursor,
                    "END"
                );
            }
            if (value !== "1") return invalid();
            await sessionService.save(session.sessionId, session.phone, state, nextCursor);
            const trip = await tripService.getAvailableById(state.tripId);
            if (!trip || !seatService.isAvailable(trip.availableSeats, state.seats)) {
                const completed = completedState(state, "unavailable");
                await sessionService.save(session.sessionId, session.phone, completed, nextCursor);
                return answer("END", translate(completed, "tripUnavailable"));
            }
            const booking = await bookingService.create({
                sessionId: session.sessionId,
                trip: trip,
                passengerName: state.passengerName,
                phone: session.phone,
                seats: state.seats,
                paymentMethod: state.paymentMethod
            });
            const reference = String(booking.id).replace(/-/g, "").slice(0, 12).toUpperCase();
            const completed = completedState(state, "booked", reference);
            await sessionService.save(session.sessionId, session.phone, completed, nextCursor);
            return answer("END", translate(completed, "booked", { reference: reference }));
        }

        throw new Error("Unsupported USSD session step.");
    }

    return async function ussdController(request, response, next) {
        try {
            const result = await processCallback(request.body);
            response.status(200).type("text/plain").send(result);
        } catch (error) {
            next(error);
        }
    };
}

module.exports = { createUssdController };
