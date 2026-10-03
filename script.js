const databaseName = "wayline-bus-booking";
const platformFeePerPassenger = 10;
let database;
let buses = [];
let bookings = [];
let pendingBooking = null;

function readLegacyRecords(key) {
    try {
        const records = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(records) ? records : [];
    } catch {
        return [];
    }
}

function createId() {
    return window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function openDatabase() {
    return new Promise(function(resolve, reject) {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = function() {
            const storeDatabase = request.result;
            if (!storeDatabase.objectStoreNames.contains("buses")) {
                storeDatabase.createObjectStore("buses", { keyPath: "id" });
            }
            if (!storeDatabase.objectStoreNames.contains("bookings")) {
                storeDatabase.createObjectStore("bookings", { keyPath: "id" });
            }
        };
        request.onsuccess = function() { resolve(request.result); };
        request.onerror = function() { reject(request.error); };
    });
}

function readStoreRecords(storeName) {
    return new Promise(function(resolve, reject) {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = function() { resolve(request.result); };
        request.onerror = function() { reject(request.error); };
    });
}

function saveAllRecords() {
    return new Promise(function(resolve, reject) {
        const transaction = database.transaction(["buses", "bookings"], "readwrite");
        const busStore = transaction.objectStore("buses");
        const bookingStore = transaction.objectStore("bookings");
        busStore.clear();
        bookingStore.clear();
        buses.forEach(function(bus) { busStore.put(bus); });
        bookings.forEach(function(booking) { bookingStore.put(booking); });
        transaction.oncomplete = function() { resolve(); };
        transaction.onerror = function() { reject(transaction.error); };
        transaction.onabort = function() { reject(transaction.error); };
    });
}

function normalizeBus(bus) {
    const oldSeatCount = Number(bus.totalSeats ?? bus.seats) || 0;
    return {
        id: bus.id || createId(),
        company: bus.company || "",
        name: bus.name || "Unlabeled bus",
        from: bus.from || "",
        to: bus.to || "",
        date: bus.date || "",
        departureTime: bus.departureTime || "",
        totalSeats: oldSeatCount,
        availableSeats: Number(bus.availableSeats ?? bus.seats) || 0,
        fare: Number(bus.fare) || 0
    };
}

function normalizeBooking(booking) {
    return {
        id: booking.id || createId(),
        busId: booking.busId || "",
        name: booking.name || "Passenger",
        company: booking.company || "",
        busName: booking.busName || "",
        from: booking.from || "",
        to: booking.to || "",
        date: booking.date || "",
        departureTime: booking.departureTime || "",
        seats: Math.max(1, Number(booking.seats) || 1),
        baseFare: Number(booking.baseFare ?? booking.totalFare) || 0,
        platformFee: Number(booking.platformFee) || 0,
        totalFare: Number(booking.totalFare) || 0,
        paymentStatus: "demo-unpaid",
        cancelled: Boolean(booking.cancelled)
    };
}

const searchForm = document.getElementById("searchForm");
const busForm = document.getElementById("busForm");
const searchMessage = document.getElementById("searchMessage");
const searchResults = document.getElementById("searchResults");
const bookingList = document.getElementById("bookingList");
const busList = document.getElementById("busList");
const companyFilter = document.getElementById("companyFilter");
const managementPanel = document.getElementById("managementPanel");
const partnerLoginScreen = document.getElementById("partnerLoginScreen");
const dashboard = document.getElementById("top");
const loginMessage = document.getElementById("loginMessage");

function setPartnerPreview(active) {
    partnerLoginScreen.hidden = active;
    dashboard.hidden = !active;
    managementPanel.hidden = !active;
    document.getElementById("partnerLoginOpen").hidden = true;
    document.getElementById("partnerLogout").hidden = !active;
    managementPanel.open = active;
}

function showPassengerDashboard() {
    partnerLoginScreen.hidden = true;
    dashboard.hidden = false;
    managementPanel.hidden = true;
    managementPanel.open = false;
    document.getElementById("partnerLoginOpen").hidden = false;
    document.getElementById("partnerLogout").hidden = true;
}

document.getElementById("partnerLoginOpen").addEventListener("click", function() {
    loginMessage.textContent = "";
    setPartnerPreview(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
});

document.getElementById("partnerLoginForm").addEventListener("submit", function(event) {
    event.preventDefault();
    loginMessage.textContent = "Password sign-in is not connected yet. Use demo access to preview partner tools.";
});

document.getElementById("demoPartnerAccess").addEventListener("click", function() {
    sessionStorage.setItem("wayline-partner-demo", "true");
    setPartnerPreview(true);
    managementPanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("continueAsPassenger").addEventListener("click", showPassengerDashboard);

document.getElementById("partnerLogout").addEventListener("click", function() {
    sessionStorage.removeItem("wayline-partner-demo");
    setPartnerPreview(false);
});

setPartnerPreview(sessionStorage.getItem("wayline-partner-demo") === "true");

async function initializeApp() {
    database = await openDatabase();
    const storedBuses = await readStoreRecords("buses");
    const storedBookings = await readStoreRecords("bookings");

    if (!storedBuses.length && !storedBookings.length) {
        buses = readLegacyRecords("bus-booking-system-buses").map(normalizeBus);
        bookings = readLegacyRecords("bus-booking-system-bookings").map(normalizeBooking);
        if (buses.length || bookings.length) await saveAllRecords();
    } else {
        buses = storedBuses.map(normalizeBus);
        bookings = storedBookings.map(normalizeBooking);
    }

    updateCompanyOptions();
    renderBookings();
    renderBuses();
}

function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
}

const today = localDateString(new Date());
document.getElementById("date").min = today;
document.getElementById("busDate").min = today;

function normalizedText(value) {
    return value.trim().toLocaleLowerCase();
}

function formatDate(date) {
    if (!date) return "Date not set";
    return new Date(date + "T12:00:00").toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

function formatFare(amount) {
    return new Intl.NumberFormat("en-RW", {
        style: "currency",
        currency: "RWF",
        maximumFractionDigits: 0
    }).format(Number(amount) || 0);
}

function makeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function addEmptyMessage(container, text) {
    container.appendChild(makeElement("p", "empty-state", text));
}

function updateCompanyOptions() {
    const selectedCompany = companyFilter.value;
    const companies = Array.from(new Set(buses.filter(function(bus) {
        return bus.company.trim() && bus.from && bus.to && bus.date >= today;
    }).map(function(bus) { return bus.company.trim(); })));
    companyFilter.replaceChildren(new Option("Choose a company", ""));

    companies.sort(function(first, second) { return first.localeCompare(second); });
    companies.forEach(function(company) {
        companyFilter.appendChild(new Option(company, company));
    });
    if (companies.includes(selectedCompany)) companyFilter.value = selectedCompany;
}

function renderSearchResults(matchingBuses, requestedSeats) {
    searchResults.replaceChildren();

    matchingBuses.forEach(function(bus) {
        const result = makeElement("article", "result-card");
        const heading = makeElement("div", "result-heading");
        const operator = makeElement("div", "result-operator");
        operator.appendChild(makeElement("h3", "", bus.company));
        operator.appendChild(makeElement("p", "muted-label", bus.name));
        heading.appendChild(operator);
        heading.appendChild(makeElement("span", "availability", bus.availableSeats + " seats left"));

        const route = makeElement("p", "result-route", bus.from + " to " + bus.to);
        const details = makeElement(
            "p",
            "result-details",
            formatDate(bus.date) + " | " + bus.departureTime + " | " +
                formatFare(bus.fare) + " per passenger | " + formatFare(platformFeePerPassenger) + " service fee per passenger"
        );
        const baseFare = bus.fare * requestedSeats;
        const platformFee = platformFeePerPassenger * requestedSeats;
        const total = baseFare + platformFee;
        const priceBreakdown = makeElement(
            "p",
            "result-total",
            formatFare(bus.fare) + " x " + requestedSeats + " passengers + " +
                formatFare(platformFee) + " service fee = " + formatFare(total) + " total"
        );
        const bookButton = makeElement(
            "button",
            "button button-primary result-book-button",
            "Review trip | " + formatFare(total)
        );
        bookButton.type = "button";
        bookButton.addEventListener("click", function() {
            openDemoCheckout(bus.id, requestedSeats, baseFare, platformFee, total);
        });

        result.append(heading, route, details, priceBreakdown, bookButton);
        searchResults.appendChild(result);
    });
}

function openDemoCheckout(busId, seatCount, baseFare, platformFee, totalFare) {
    const passengerName = document.getElementById("passengerName").value.trim();
    const bus = buses.find(function(item) { return item.id === busId; });

    if (!passengerName) {
        searchMessage.textContent = "Enter the passenger name before continuing.";
        document.getElementById("passengerName").focus();
        return;
    }
    if (!bus || bus.availableSeats < seatCount) {
        searchMessage.textContent = "Those places are no longer available. Search again for current availability.";
        performSearch();
        return;
    }

    pendingBooking = {
        busId: busId,
        seatCount: seatCount,
        baseFare: baseFare,
        platformFee: platformFee,
        totalFare: totalFare
    };
    document.getElementById("checkoutRoute").textContent =
        passengerName + " | " + bus.company + " | " + bus.from + " to " + bus.to +
        " | " + formatDate(bus.date) + " at " + bus.departureTime +
        " | " + seatCount + (seatCount === 1 ? " passenger" : " passengers");
    document.getElementById("checkoutFare").textContent = formatFare(baseFare);
    document.getElementById("checkoutFee").textContent = formatFare(platformFee);
    document.getElementById("checkoutTotal").textContent = formatFare(totalFare);
    document.getElementById("checkoutDialog").showModal();
}

function performSearch() {
    const from = document.getElementById("from").value.trim();
    const to = document.getElementById("to").value.trim();
    const date = document.getElementById("date").value;
    const company = companyFilter.value;
    const requestedSeats = Number(document.getElementById("seatCount").value);

    searchResults.replaceChildren();
    if (!company) {
        searchMessage.textContent = "Choose a bus company.";
        return;
    }
    if (!from || !to) {
        searchMessage.textContent = "Enter both a departure city and destination.";
        return;
    }
    if (normalizedText(from) === normalizedText(to)) {
        searchMessage.textContent = "Choose two different cities for your journey.";
        return;
    }
    if (!Number.isInteger(requestedSeats) || requestedSeats < 1 || requestedSeats > 20) {
        searchMessage.textContent = "Choose between 1 and 20 passengers.";
        return;
    }

    const matches = buses.filter(function(bus) {
        return bus.company === company && bus.from && bus.to && bus.date === date && bus.date >= today &&
            normalizedText(bus.from) === normalizedText(from) &&
            normalizedText(bus.to) === normalizedText(to) &&
            bus.availableSeats >= requestedSeats;
    });

    if (matches.length === 0) {
        searchMessage.textContent = "No scheduled buses have enough available seats for this trip.";
        return;
    }

    matches.sort(function(first, second) {
        return first.departureTime.localeCompare(second.departureTime);
    });
    searchMessage.textContent = matches.length + (matches.length === 1 ? " bus found." : " buses found.");
    renderSearchResults(matches, requestedSeats);
}

async function bookTrip(busId, seatCount, baseFare, platformFee, totalFare) {
    const bus = buses.find(function(item) { return item.id === busId; });
    const passengerName = document.getElementById("passengerName").value.trim();

    if (!passengerName) {
        searchMessage.textContent = "Enter the passenger name before booking.";
        document.getElementById("passengerName").focus();
        return false;
    }
    if (!bus || bus.availableSeats < seatCount) {
        searchMessage.textContent = "Those seats are no longer available. Search again for current availability.";
        performSearch();
        return false;
    }

    const booking = {
        id: createId(),
        busId: bus.id,
        name: passengerName,
        company: bus.company,
        busName: bus.name,
        from: bus.from,
        to: bus.to,
        date: bus.date,
        departureTime: bus.departureTime,
        seats: seatCount,
        baseFare: baseFare,
        platformFee: platformFee,
        totalFare: totalFare,
        paymentStatus: "demo-unpaid",
        cancelled: false
    };

    bus.availableSeats -= seatCount;
    bookings.unshift(booking);
    try {
        await saveAllRecords();
    } catch {
        bookings.shift();
        bus.availableSeats += seatCount;
        searchMessage.textContent = "Could not save this booking in the browser database. Try again.";
        return false;
    }

    document.getElementById("bookingMessage").textContent = "Unpaid demo booking saved. Reference: " + booking.id.slice(0, 8).toUpperCase() + ".";
    searchMessage.textContent = "Test booking saved. No money was collected.";
    renderBookings();
    renderBuses();
    performSearch();
    return true;
}

document.getElementById("closeCheckout").addEventListener("click", function() {
    pendingBooking = null;
    document.getElementById("checkoutDialog").close();
});

document.getElementById("cancelCheckout").addEventListener("click", function() {
    pendingBooking = null;
    document.getElementById("checkoutDialog").close();
});

document.getElementById("checkoutDialog").addEventListener("close", function() {
    pendingBooking = null;
});

document.getElementById("confirmDemoBooking").addEventListener("click", async function(event) {
    if (!pendingBooking) return;
    const confirmButton = event.currentTarget;
    confirmButton.disabled = true;
    try {
        const saved = await bookTrip(
            pendingBooking.busId,
            pendingBooking.seatCount,
            pendingBooking.baseFare,
            pendingBooking.platformFee,
            pendingBooking.totalFare
        );
        if (saved) document.getElementById("checkoutDialog").close();
    } catch {
        document.getElementById("searchMessage").textContent = "Could not save the demo booking. Please try again.";
    } finally {
        confirmButton.disabled = false;
    }
});

function renderBookings() {
    bookingList.replaceChildren();
    const activeCount = bookings.filter(function(booking) { return !booking.cancelled; }).length;
    document.getElementById("bookingCount").textContent = String(activeCount);

    if (bookings.length === 0) {
        addEmptyMessage(bookingList, "Your bookings will appear here.");
        return;
    }

    bookings.forEach(function(booking) {
        const card = makeElement("article", "record-card booking-card" + (booking.cancelled ? " is-cancelled" : ""));
        const top = makeElement("div", "record-topline");
        const route = makeElement("h3", "", booking.from + " to " + booking.to);
        top.appendChild(route);
        const status = booking.cancelled ? "Cancelled" : "Demo / unpaid";
        top.appendChild(makeElement("span", "status-badge" + (booking.cancelled ? " status-cancelled" : " status-demo"), status));

        const reference = makeElement("p", "ticket-reference", "TICKET REF  " + booking.id.slice(0, 8).toUpperCase());
        const details = makeElement(
            "p",
            "record-details",
            booking.name + " | " + (booking.company || "Company not recorded") +
                (booking.busName ? " | " + booking.busName : "") +
                "\n" + formatDate(booking.date) +
                (booking.departureTime ? " at " + booking.departureTime : "") +
                " | " + booking.seats + (booking.seats === 1 ? " passenger" : " passengers") +
                (booking.totalFare > 0 ? "\nFare " + formatFare(booking.baseFare) +
                    " | Service fee " + formatFare(booking.platformFee) +
                    " | Total " + formatFare(booking.totalFare) : "")
        );
        card.append(top, reference, details);

        if (!booking.cancelled) {
            const actions = makeElement("div", "record-actions");
            const printButton = makeElement("button", "button button-print", "Print demo record");
            printButton.type = "button";
            printButton.addEventListener("click", function() {
                card.classList.add("is-printing");
                document.body.classList.add("printing-ticket");
                window.print();
                card.classList.remove("is-printing");
                document.body.classList.remove("printing-ticket");
            });
            actions.appendChild(printButton);

            if (booking.busId) {
                const cancelButton = makeElement("button", "button button-danger", "Cancel booking");
                cancelButton.type = "button";
                cancelButton.addEventListener("click", function() { cancelBooking(booking.id); });
                actions.appendChild(cancelButton);
            }
            card.appendChild(actions);
        }
        bookingList.appendChild(card);
    });
}

function renderBuses() {
    busList.replaceChildren();
    document.getElementById("busCount").textContent = buses.length + (buses.length === 1 ? " schedule" : " schedules");

    if (buses.length === 0) {
        addEmptyMessage(busList, "No schedules yet. Add a bus above to make it bookable.");
        return;
    }

    buses.forEach(function(bus) {
        const activeBookings = bookings.filter(function(booking) {
            return booking.busId === bus.id && !booking.cancelled;
        }).length;
        const card = makeElement("article", "record-card schedule-card");
        const top = makeElement("div", "record-topline");
        top.appendChild(makeElement("h3", "", bus.name));
        top.appendChild(makeElement("span", "availability", bus.availableSeats + " / " + bus.totalSeats + " seats"));

        const company = makeElement("p", "record-company", bus.company || "Company not set");
        const scheduleText = bus.from && bus.to && bus.date && bus.departureTime
            ? bus.from + " to " + bus.to + "\n" + formatDate(bus.date) + " at " + bus.departureTime + " | " + formatFare(bus.fare) + " per passenger"
            : "Older bus record: add a new schedule to make this bus bookable.";
        const details = makeElement("p", "record-details", scheduleText);
        card.append(top, company, details);

        const removeButton = makeElement("button", "button button-text", activeBookings ? "Has active bookings" : "Remove schedule");
        removeButton.type = "button";
        removeButton.disabled = activeBookings > 0;
        removeButton.addEventListener("click", function() { removeBus(bus.id); });
        card.appendChild(removeButton);
        busList.appendChild(card);
    });
}

async function cancelBooking(bookingId) {
    const booking = bookings.find(function(item) { return item.id === bookingId; });
    if (!booking || booking.cancelled) return;

    booking.cancelled = true;
    const bus = buses.find(function(item) { return item.id === booking.busId; });
    if (bus) bus.availableSeats = Math.min(bus.totalSeats, bus.availableSeats + booking.seats);

    try {
        await saveAllRecords();
    } catch {
        booking.cancelled = false;
        if (bus) bus.availableSeats = Math.max(0, bus.availableSeats - booking.seats);
        document.getElementById("bookingMessage").textContent = "Could not save the cancellation. Please try again.";
        return;
    }

    document.getElementById("bookingMessage").textContent = "Booking cancelled. Reserved seats are available again.";
    renderBookings();
    renderBuses();
    if (document.getElementById("date").value) performSearch();
}

async function removeBus(busId) {
    const hasActiveBookings = bookings.some(function(booking) {
        return booking.busId === busId && !booking.cancelled;
    });
    if (hasActiveBookings) return;

    const index = buses.findIndex(function(bus) { return bus.id === busId; });
    if (index < 0) return;
    const removedBus = buses.splice(index, 1)[0];

    try {
        await saveAllRecords();
    } catch {
        buses.splice(index, 0, removedBus);
        document.getElementById("busMessage").textContent = "Could not update the browser database. Please try again.";
        return;
    }

    document.getElementById("busMessage").textContent = "Schedule removed.";
    updateCompanyOptions();
    renderBuses();
    if (document.getElementById("date").value) performSearch();
}

searchForm.addEventListener("submit", function(event) {
    event.preventDefault();
    searchMessage.textContent = "";
    if (!document.getElementById("passengerName").value.trim()) {
        searchMessage.textContent = "Enter the passenger name before searching.";
        document.getElementById("passengerName").focus();
        return;
    }
    performSearch();
});

busForm.addEventListener("submit", async function(event) {
    event.preventDefault();
    const company = document.getElementById("company").value.trim();
    const name = document.getElementById("busName").value.trim();
    const from = document.getElementById("busFrom").value.trim();
    const to = document.getElementById("busTo").value.trim();
    const date = document.getElementById("busDate").value;
    const departureTime = document.getElementById("departureTime").value;
    const totalSeats = Number(document.getElementById("seatNumber").value);
    const fare = Number(document.getElementById("fare").value);
    const busMessage = document.getElementById("busMessage");

    if (!company || !name || !from || !to || !date || !departureTime) {
        busMessage.textContent = "Complete every schedule field with a value.";
        return;
    }
    if (normalizedText(from) === normalizedText(to)) {
        busMessage.textContent = "Choose two different cities for the bus route.";
        return;
    }
    if (date < today) {
        busMessage.textContent = "A bus schedule cannot be in the past.";
        return;
    }
    if (!Number.isInteger(totalSeats) || totalSeats < 1 || totalSeats > 100 || !Number.isFinite(fare) || fare < 0) {
        busMessage.textContent = "Enter 1 to 100 seats and a valid fare of zero or more.";
        return;
    }

    const bus = {
        id: createId(),
        company: company,
        name: name,
        from: from,
        to: to,
        date: date,
        departureTime: departureTime,
        totalSeats: totalSeats,
        availableSeats: totalSeats,
        fare: fare
    };
    buses.unshift(bus);
    try {
        await saveAllRecords();
    } catch {
        buses.shift();
        busMessage.textContent = "Could not save this schedule in the browser database. Try again.";
        return;
    }

    busForm.reset();
    busMessage.textContent = "Bus schedule added and ready for booking.";
    updateCompanyOptions();
    renderBuses();
    if (document.getElementById("date").value) performSearch();
});

initializeApp().catch(function(error) {
    document.getElementById("bookingMessage").textContent = "The browser database could not be opened. Run this page from a local web server, then reload.";
    console.error(error);
});