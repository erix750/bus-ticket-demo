const platformFeePerPassenger = 10;
let database;
let currentUser = null;
let isPartnerSignUp = false;
let buses = [];
let bookings = [];
let pendingBooking = null;

function normalizeBus(bus) {
    return {
        id: bus.id,
        companyId: bus.companyId,
        company: bus.company,
        name: bus.name,
        from: bus.from,
        to: bus.to,
        date: bus.date,
        departureTime: bus.departureTime,
        logo: bus.logo || "",
        totalSeats: Number(bus.totalSeats),
        availableSeats: Number(bus.availableSeats),
        fare: Number(bus.fare)
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
const companyNameField = document.getElementById("companyNameField");
const partnerCompanyName = document.getElementById("partnerCompanyName");

function setPartnerPreview(active) {
    partnerLoginScreen.hidden = active;
    dashboard.hidden = !active;
    managementPanel.hidden = !active;
    document.getElementById("partnerLoginOpen").hidden = true;
    document.getElementById("partnerLogout").hidden = !active;
    managementPanel.open = active;
}

function setPartnerFormMode(signUp) {
    isPartnerSignUp = signUp;
    companyNameField.hidden = !signUp;
    partnerCompanyName.required = signUp;
    document.getElementById("partnerFormTitle").textContent = signUp
        ? "Create a company account"
        : "Partner sign in";
    document.getElementById("partnerFormIntro").textContent = signUp
        ? "Register your bus company to publish schedules."
        : "Access your company schedules and bookings.";
    document.getElementById("partnerSubmitButton").textContent = signUp
        ? "Create account"
        : "Sign in";
    document.getElementById("togglePartnerMode").textContent = signUp
        ? "Already have an account? Sign in"
        : "Create a company account";
    document.getElementById("partnerPassword").autocomplete = signUp ? "new-password" : "current-password";
    document.getElementById("partnerPassword").placeholder = "At least 6 characters";
    loginMessage.textContent = "";
}

async function refreshAppData() {
    buses = (await window.WaylineDatabase.loadBuses()).map(normalizeBus);
    bookings = await window.WaylineDatabase.loadBookings();
    updateCompanyOptions();
    renderBookings();
    renderBuses();
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

document.getElementById("partnerLoginForm").addEventListener("submit", async function(event) {
    event.preventDefault();
    const submitButton = document.getElementById("partnerSubmitButton");
    submitButton.disabled = true;
    loginMessage.textContent = "";
    try {
        const email = document.getElementById("partnerEmail").value.trim();
        const password = document.getElementById("partnerPassword").value;
        if (isPartnerSignUp) {
            const companyName = partnerCompanyName.value.trim();
            if (companyName.length < 2) {
                loginMessage.textContent = "Enter a company name with at least 2 characters.";
                partnerCompanyName.focus();
                return;
            }
            const result = await window.WaylineDatabase.signUp(email, password, companyName);
            if (!result.session) {
                loginMessage.textContent = "Account created. Check your email to verify the address, then sign in.";
                return;
            }
            currentUser = result.user;
            partnerCompanyName.value = companyName;
            document.getElementById("company").value = companyName;
            sessionStorage.removeItem("wayline-partner-demo");
            await refreshAppData();
            setPartnerPreview(true);
            managementPanel.scrollIntoView({ behavior: "smooth", block: "start" });
            loginMessage.textContent = "Company account created.";
            return;
        }

        const result = await window.WaylineDatabase.signIn(email, password);
        currentUser = result.user;
        sessionStorage.removeItem("wayline-partner-demo");
        const profile = await window.WaylineDatabase.getCompanyProfile(currentUser.id);
        partnerCompanyName.value = profile.name;
        document.getElementById("company").value = profile.name;
        await refreshAppData();
        setPartnerPreview(true);
        managementPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
        loginMessage.textContent = error.message || "Could not complete company account sign-in.";
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById("togglePartnerMode").addEventListener("click", function() {
    setPartnerFormMode(!isPartnerSignUp);
});

document.getElementById("demoPartnerAccess").addEventListener("click", function() {
    sessionStorage.setItem("wayline-partner-demo", "true");
    currentUser = null;
    setPartnerPreview(true);
    managementPanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("continueAsPassenger").addEventListener("click", showPassengerDashboard);

document.getElementById("partnerLogout").addEventListener("click", async function() {
    const button = document.getElementById("partnerLogout");
    button.disabled = true;
    sessionStorage.removeItem("wayline-partner-demo");
    try {
        if (currentUser) await window.WaylineDatabase.signOut();
        currentUser = null;
        await refreshAppData();
        setPartnerPreview(false);
    } catch (error) {
        loginMessage.textContent = error.message || "Could not sign out.";
    } finally {
        button.disabled = false;
    }
});

async function initializeApp() {
    database = await window.WaylineDatabase.open();
    const sessionResult = await database.auth.getSession();
    if (sessionResult.error) throw new Error(sessionResult.error.message);
    currentUser = sessionResult.data.session ? sessionResult.data.session.user : null;
    if (currentUser) {
        const profile = await window.WaylineDatabase.getCompanyProfile(currentUser.id);
        partnerCompanyName.value = profile.name;
        document.getElementById("company").value = profile.name;
        setPartnerPreview(true);
    } else {
        setPartnerPreview(sessionStorage.getItem("wayline-partner-demo") === "true");
    }
    await refreshAppData();
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

function makeCompanyLogo(bus, className) {
    if (!bus.logo) return null;
    const logo = document.createElement("img");
    logo.className = className;
    logo.src = bus.logo;
    logo.alt = bus.company + " logo";
    return logo;
}

function resizeCompanyLogo(file) {
    return new Promise(function(resolve, reject) {
        const reader = new FileReader();
        reader.onerror = function() { reject(new Error("The selected image could not be read.")); };
        reader.onload = function() {
            const image = new Image();
            image.onerror = function() { reject(new Error("The selected file is not a valid image.")); };
            image.onload = function() {
                const maxDimension = 256;
                const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                const context = canvas.getContext("2d");
                if (!context) {
                    reject(new Error("Image resizing is not supported by this browser."));
                    return;
                }
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/webp", 0.82));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
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
        const brand = makeElement("div", "company-brand");
        const logo = makeCompanyLogo(bus, "company-logo");
        if (logo) brand.appendChild(logo);
        operator.appendChild(makeElement("h3", "", bus.company));
        operator.appendChild(makeElement("p", "muted-label", bus.name));
        brand.appendChild(operator);
        heading.appendChild(brand);
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

async function bookTrip(busId, seatCount, baseFare, platformFee, totalFare, paymentMethod) {
    const bus = buses.find(function(item) { return item.id === busId; });
    const passengerName = document.getElementById("passengerName").value.trim();

    if (!passengerName) {
        searchMessage.textContent = "Enter the passenger name before booking.";
        document.getElementById("passengerName").focus();
        return false;
    }
    if (!bus || bus.availableSeats < seatCount) {
        searchMessage.textContent = "Those seats are no longer available. Search again for current availability.";
        await refreshAppData();
        performSearch();
        return false;
    }

    const booking = await window.WaylineDatabase.createBooking(bus, passengerName, seatCount, paymentMethod);
    bookings.unshift(booking);
    await refreshAppData();
    document.getElementById("bookingMessage").textContent =
        "Unpaid booking saved. Reference: " + booking.id.slice(0, 8).toUpperCase() + ". No payment was collected.";
    searchMessage.textContent = "Booking confirmed. Payment has not been collected.";
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
    const paymentMethod = document.getElementById("paymentMethod");
    if (!paymentMethod.value) {
        paymentMethod.reportValidity();
        return;
    }
    const confirmButton = event.currentTarget;
    confirmButton.disabled = true;
    try {
        const saved = await bookTrip(
            pendingBooking.busId,
            pendingBooking.seatCount,
            pendingBooking.baseFare,
            pendingBooking.platformFee,
            pendingBooking.totalFare,
            paymentMethod.value
        );
        if (saved) document.getElementById("checkoutDialog").close();
    } catch (error) {
        document.getElementById("searchMessage").textContent = error.message || "Could not save the booking. Please try again.";
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
        const status = booking.cancelled ? "Cancelled" : "Unpaid";
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
                "\nPayment method: " + (booking.paymentMethod || "Not selected") +
                (booking.totalFare > 0 ? "\nFare " + formatFare(booking.baseFare) +
                    " | Service fee " + formatFare(booking.platformFee) +
                    " | Total " + formatFare(booking.totalFare) : "")
        );
        card.append(top, reference, details);

        if (!booking.cancelled) {
            const actions = makeElement("div", "record-actions");
            const printButton = makeElement("button", "button button-print", "Print booking record");
            printButton.type = "button";
            printButton.addEventListener("click", function() {
                card.classList.add("is-printing");
                document.body.classList.add("printing-ticket");
                window.print();
                card.classList.remove("is-printing");
                document.body.classList.remove("printing-ticket");
            });
            actions.appendChild(printButton);

            if (booking.busId && !booking.companyView) {
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
    const manageableBuses = currentUser
        ? buses.filter(function(bus) { return bus.companyId === currentUser.id; })
        : buses;
    document.getElementById("busCount").textContent =
        manageableBuses.length + (manageableBuses.length === 1 ? " schedule" : " schedules");

    if (manageableBuses.length === 0) {
        addEmptyMessage(busList, "No schedules yet. Add a bus above to make it bookable.");
        return;
    }

    manageableBuses.forEach(function(bus) {
        const hasBookings = bookings.some(function(booking) {
            return booking.busId === bus.id;
        });
        const card = makeElement("article", "record-card schedule-card");
        const top = makeElement("div", "record-topline");
        top.appendChild(makeElement("h3", "", bus.name));
        top.appendChild(makeElement("span", "availability", bus.availableSeats + " / " + bus.totalSeats + " seats"));

        const company = makeElement("div", "company-brand record-company-brand");
        const logo = makeCompanyLogo(bus, "company-logo");
        if (logo) company.appendChild(logo);
        company.appendChild(makeElement("p", "record-company", bus.company || "Company not set"));
        const scheduleText = bus.from && bus.to && bus.date && bus.departureTime
            ? bus.from + " to " + bus.to + "\n" + formatDate(bus.date) + " at " + bus.departureTime + " | " + formatFare(bus.fare) + " per passenger"
            : "Older bus record: add a new schedule to make this bus bookable.";
        const details = makeElement("p", "record-details", scheduleText);
        card.append(top, company, details);

        const removeButton = makeElement(
            "button",
            "button button-text",
            !currentUser ? "Sign in to manage schedules" : (hasBookings ? "Has bookings" : "Remove schedule")
        );
        removeButton.type = "button";
        removeButton.disabled = !currentUser || hasBookings;
        removeButton.addEventListener("click", function() { removeBus(bus.id); });
        card.appendChild(removeButton);
        busList.appendChild(card);
    });
}

async function cancelBooking(bookingId) {
    const booking = bookings.find(function(item) { return item.id === bookingId; });
    if (!booking || booking.cancelled) return;

    try {
        await window.WaylineDatabase.cancelBooking(bookingId);
        await refreshAppData();
    } catch (error) {
        document.getElementById("bookingMessage").textContent =
            error.message || "Could not save the cancellation. Please try again.";
        return;
    }

    document.getElementById("bookingMessage").textContent = "Booking cancelled. Reserved seats are available again.";
    if (document.getElementById("date").value) performSearch();
}

async function removeBus(busId) {
    const hasBookings = bookings.some(function(booking) {
        return booking.busId === busId;
    });
    if (hasBookings || !currentUser) return;

    const bus = buses.find(function(item) { return item.id === busId; });
    if (!bus || bus.companyId !== currentUser.id) return;

    try {
        await window.WaylineDatabase.deleteSchedule(busId);
        await refreshAppData();
    } catch (error) {
        document.getElementById("busMessage").textContent =
            error.message || "Could not remove the schedule. Please try again.";
        return;
    }

    document.getElementById("busMessage").textContent = "Schedule removed.";
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
    if (!currentUser) {
        document.getElementById("busMessage").textContent =
            "Create and verify a company account, then sign in to publish schedules.";
        return;
    }
    const company = document.getElementById("company").value.trim();
    const name = document.getElementById("busName").value.trim();
    const from = document.getElementById("busFrom").value.trim();
    const to = document.getElementById("busTo").value.trim();
    const date = document.getElementById("busDate").value;
    const departureTime = document.getElementById("departureTime").value;
    const totalSeats = Number(document.getElementById("seatNumber").value);
    const fare = Number(document.getElementById("fare").value);
    const logoFile = document.getElementById("companyLogo").files[0];
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
    if (logoFile && !["image/png", "image/jpeg", "image/webp"].includes(logoFile.type)) {
        busMessage.textContent = "Choose a PNG, JPG, or WebP image for the company logo.";
        return;
    }
    if (logoFile && logoFile.size > 2 * 1024 * 1024) {
        busMessage.textContent = "The company image must be 2 MB or smaller.";
        return;
    }

    let logo = "";
    if (logoFile) {
        try {
            logo = await resizeCompanyLogo(logoFile);
        } catch (error) {
            busMessage.textContent = error.message;
            return;
        }
    }

    const bus = {
        company: company,
        name: name,
        from: from,
        to: to,
        date: date,
        departureTime: departureTime,
        totalSeats: totalSeats,
        fare: fare
    };
    try {
        const savedBus = await window.WaylineDatabase.createSchedule(bus, logo);
        buses.unshift(savedBus);
        await refreshAppData();
    } catch (error) {
        busMessage.textContent = error.message || "Could not save this schedule. Please try again.";
        return;
    }

    busForm.reset();
    busMessage.textContent = "Bus schedule added and ready for booking.";
    updateCompanyOptions();
    if (document.getElementById("date").value) performSearch();
});

initializeApp().catch(function(error) {
    document.getElementById("bookingMessage").textContent =
        "Could not connect to the shared booking database. Check your internet connection and reload the page.";
    console.error(error);
});