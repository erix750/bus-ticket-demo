const ruraFarePerKm = {
    kigali: 59.28,
    intercity: 41.58
};
let database;
let currentUser = null;
let isPartnerSignUp = false;
let editingBusId = null;
let buses = [];
let bookings = [];
let pendingBooking = null;
let busRefreshTimer;
const routeLocationCache = new Map();
let routeDistanceController = null;
let requestedDistanceRoute = "";
let routeDistanceInputKey = "";

const introReveal = document.getElementById("brandReveal");
const skipIntroButton = document.getElementById("skipIntro");

function hideIntro() {
    if (!introReveal || introReveal.classList.contains("is-hidden")) return;
    introReveal.classList.add("is-hidden");
    document.body.classList.remove("intro-active");
    window.setTimeout(function() {
        introReveal.remove();
    }, 420);
}

if (introReveal) {
    document.body.classList.add("intro-active");
    skipIntroButton?.addEventListener("click", hideIntro);
    const introDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1200 : 2000;
    window.setTimeout(hideIntro, introDuration);
}

const themeToggle = document.getElementById("themeToggle");
const themeToggleIcon = document.getElementById("themeToggleIcon");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const commonCities = [
    "Gicumbi",
    "Huye",
    "Kayonza",
    "Karongi",
    "Kigali",
    "Kirehe",
    "Muhanga",
    "Musanze",
    "Ngoma",
    "Nyagatare",
    "Nyamagabe",
    "Nyanza",
    "Rubavu",
    "Rusizi",
    "Rwamagana"
];

function setColorTheme(theme, persist) {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    themeToggle.setAttribute("aria-pressed", String(isDark));
    themeToggleIcon.replaceChildren();
    if (isDark) {
        themeToggleIcon.textContent = "☾";
    } else {
        const sunIcon = document.createElement("img");
        sunIcon.src = "assets/light-mode-sun.png";
        sunIcon.alt = "";
        themeToggleIcon.appendChild(sunIcon);
    }
    themeToggle.setAttribute("aria-label", isDark ? "Light mode" : "Dark mode");
    themeToggle.title = isDark ? "Turn off dark mode" : "Turn on dark mode";
    themeColorMeta.content = isDark ? "#0d1620" : "#173f70";

    if (persist) {
        try {
            localStorage.setItem("wayline-theme", isDark ? "dark" : "light");
        } catch (error) {
            console.error("Could not save the Wayline color theme preference.", error);
        }
    }
}

let savedTheme = "light";
try {
    if (localStorage.getItem("wayline-theme") === "dark") savedTheme = "dark";
} catch (error) {
    console.error("Could not read the Wayline color theme preference.", error);
}
setColorTheme(savedTheme, false);

themeToggle.addEventListener("click", function() {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setColorTheme(nextTheme, true);
});

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
        fare: Number(bus.fare),
        routeDistanceKm: Number(bus.routeDistanceKm) || 0,
        fareCategory: bus.fareCategory || "intercity",
        isActive: bus.isActive !== false
    };
}

const searchForm = document.getElementById("searchForm");
const busForm = document.getElementById("busForm");
const searchMessage = document.getElementById("searchMessage");
const searchResults = document.getElementById("searchResults");
const busList = document.getElementById("busList");
const companyFilter = document.getElementById("companyFilter");
const passengerNameInput = document.getElementById("passengerName");
const passengerPhoneInput = document.getElementById("passengerPhone");
const managementPanel = document.getElementById("managementPanel");
const partnerLoginScreen = document.getElementById("partnerLoginScreen");
const partnerLoginOpen = document.getElementById("partnerLoginOpen");
const dashboard = document.getElementById("top");
const loginMessage = document.getElementById("loginMessage");
const companyNameField = document.getElementById("companyNameField");
const partnerCompanyName = document.getElementById("partnerCompanyName");
const passwordRecoveryForm = document.getElementById("passwordRecoveryForm");

function showPasswordRecoveryForm() {
    document.getElementById("partnerLoginForm").hidden = true;
    passwordRecoveryForm.hidden = false;
    document.getElementById("passwordRecoveryMessage").textContent = "";
    if (!partnerLoginScreen.open) partnerLoginScreen.showModal();
    document.getElementById("newPartnerPassword").focus();
}

function showPartnerLoginForm() {
    passwordRecoveryForm.hidden = true;
    document.getElementById("partnerLoginForm").hidden = false;
    document.getElementById("passwordRecoveryForm").reset();
}

function setPartnerPreview(active) {
    dashboard.hidden = false;
    managementPanel.hidden = !active;
    partnerLoginOpen.hidden = active;
    document.getElementById("partnerLogout").hidden = !active;
    const companyName = active ? partnerCompanyName.value || currentUser.email : "";
    document.getElementById("dashboardCompanyName").textContent = companyName;
    document.getElementById("dashboardWelcome").textContent = active
        ? "Welcome back, " + companyName
        : "Welcome back";
    if (active && partnerLoginScreen.open) partnerLoginScreen.close();
}

function setPartnerFormMode(signUp) {
    isPartnerSignUp = signUp;
    companyNameField.hidden = !signUp;
    partnerCompanyName.required = signUp;
    document.getElementById("partnerFormTitle").textContent = signUp
        ? "Create a company account"
        : "Company sign in";
    document.getElementById("partnerFormIntro").textContent = signUp
        ? "Use an email inbox you can access. Confirm it before publishing schedules."
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

const partnerEmailInput = document.getElementById("partnerEmail");
partnerEmailInput.addEventListener("input", function() {
    this.setCustomValidity("");
});
partnerEmailInput.addEventListener("invalid", function() {
    if (!isPartnerSignUp) {
        this.setCustomValidity("");
        return;
    }
    this.setCustomValidity(this.validity.valueMissing
        ? "Enter an email address you can access."
        : "This email address is not available. Enter a valid address you can access.");
});

async function refreshAppData() {
    buses = (await window.WaylineDatabase.loadBuses()).map(normalizeBus);
    bookings = await window.WaylineDatabase.loadBookings();
    updateCitySuggestions();
    updateCompanyOptions();
    renderBookings();
    renderBuses();
}

let isRefreshingAvailability = false;

async function refreshBusAvailability(showSuccess) {
    if (isRefreshingAvailability) return;
    isRefreshingAvailability = true;
    const refreshButton = document.getElementById("refreshAvailability");
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";

    try {
        buses = (await window.WaylineDatabase.loadBuses()).map(normalizeBus);
        updateCitySuggestions();
        updateCompanyOptions();
        renderBuses();
        if (document.getElementById("date").value) performSearch();
        if (showSuccess) {
            document.getElementById("availabilityStatus").textContent =
                "Seat availability updated just now.";
        }
    } catch (error) {
        console.error("Could not refresh bus availability.", error);
        document.getElementById("availabilityStatus").textContent =
            "Could not refresh seats. Check your connection and try again.";
    } finally {
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh seats";
        isRefreshingAvailability = false;
    }
}

document.getElementById("refreshAvailability").addEventListener("click", function() {
    refreshBusAvailability(true);
});

document.getElementById("bookJourneyButton").addEventListener("click", function() {
    document.getElementById("searchPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("from").focus({ preventScroll: true });
});

document.querySelectorAll(".route-chip").forEach(function(button) {
    button.addEventListener("click", function() {
        const from = button.dataset.from;
        const to = button.dataset.to;
        document.getElementById("from").value = from;
        document.getElementById("to").value = to;

        const routeCompanies = Array.from(new Set(buses.filter(function(bus) {
            return bus.isActive && bus.availableSeats > 0 && bus.routeDistanceKm > 0 &&
                isTripUpcoming(bus) && normalizedText(bus.from) === normalizedText(from) &&
                normalizedText(bus.to) === normalizedText(to);
        }).map(function(bus) { return bus.company; })));
        companyFilter.value = routeCompanies.length === 1 ? routeCompanies[0] : "";
        document.getElementById("searchResults").replaceChildren();
        searchMessage.textContent = routeCompanies.length
            ? "Route selected. Choose your travel date and passenger details, then search."
            : "Route selected. Choose your travel date and search all available companies.";
        document.getElementById("date").focus();
    });
});

partnerLoginOpen.addEventListener("click", function() {
    loginMessage.textContent = "";
    showPartnerLoginForm();
    setPartnerFormMode(false);
    partnerLoginScreen.showModal();
});

document.getElementById("closePartnerLogin").addEventListener("click", function() {
    partnerLoginScreen.close();
});

async function sendPasswordResetLink(button) {
    const emailInput = document.getElementById("partnerEmail");
    const email = emailInput.value.trim();
    if (!email) {
        loginMessage.textContent = "Enter your account email address first.";
        emailInput.focus();
        return;
    }
    if (!emailInput.validity.valid) {
        emailInput.reportValidity();
        return;
    }

    button.disabled = true;
    loginMessage.textContent = "";
    try {
        await window.WaylineDatabase.sendPasswordRecovery(email);
        loginMessage.textContent = "If an account exists for that email, a password reset link has been sent.";
    } catch (error) {
        loginMessage.textContent = error.message || "Could not send a password reset email. Please try again.";
    } finally {
        button.disabled = false;
    }
}

document.getElementById("forgotPassword").addEventListener("click", function() {
    sendPasswordResetLink(this);
});

document.getElementById("resendPasswordReset").addEventListener("click", function() {
    sendPasswordResetLink(this);
});

passwordRecoveryForm.addEventListener("submit", async function(event) {
    event.preventDefault();
    const password = document.getElementById("newPartnerPassword").value;
    const confirmation = document.getElementById("confirmPartnerPassword").value;
    const message = document.getElementById("passwordRecoveryMessage");
    if (password !== confirmation) {
        message.textContent = "The passwords do not match.";
        document.getElementById("confirmPartnerPassword").focus();
        return;
    }

    const submitButton = document.getElementById("saveNewPassword");
    submitButton.disabled = true;
    message.textContent = "";
    try {
        await window.WaylineDatabase.updatePassword(password);
        await database.auth.signOut();
        showPartnerLoginForm();
        setPartnerFormMode(false);
        loginMessage.textContent = "Password updated. Sign in with your new password.";
    } catch (error) {
        message.textContent = error.message || "Could not update your password. Request a new reset link and try again.";
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById("backToSignIn").addEventListener("click", function() {
    showPartnerLoginForm();
    setPartnerFormMode(false);
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
                loginMessage.textContent = "Check your inbox and confirm your email before signing in. If you can't receive the link, this email isn't available—check the address and try again.";
                return;
            }
            currentUser = result.user;
            partnerCompanyName.value = companyName;
            document.getElementById("company").value = companyName;
            await refreshAppData();
            setPartnerPreview(true);
            managementPanel.scrollIntoView({ behavior: "smooth", block: "start" });
            loginMessage.textContent = "Company account created.";
            return;
        }

        const result = await window.WaylineDatabase.signIn(email, password);
        currentUser = result.user;
        const profile = await window.WaylineDatabase.getCompanyProfile(currentUser.id);
        partnerCompanyName.value = profile.name;
        document.getElementById("company").value = profile.name;
        await refreshAppData();
        setPartnerPreview(true);
        managementPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
        const signUpEmailUnavailable = isPartnerSignUp &&
            /invalid email|email.*invalid|already registered|user already exists|email.*already|already.*email/i.test(error.message || "");
        const invalidSignIn = !isPartnerSignUp &&
            /invalid login credentials|email not confirmed/i.test(error.message || "");
        loginMessage.textContent = signUpEmailUnavailable
            ? "Email not available. Check the address or use an email account you can access."
            : invalidSignIn
                ? "Sign-in failed. Only registered company accounts can sign in. Check your email and password; if you just signed up, verify your email first."
                : error.message || "Could not complete company account sign-in.";
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById("togglePartnerMode").addEventListener("click", function() {
    setPartnerFormMode(!isPartnerSignUp);
});

document.getElementById("partnerLogout").addEventListener("click", async function() {
    const button = document.getElementById("partnerLogout");
    button.disabled = true;
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
    database.auth.onAuthStateChange(function(event) {
        if (event === "PASSWORD_RECOVERY") showPasswordRecoveryForm();
    });
    const sessionResult = await database.auth.getSession();
    if (sessionResult.error) throw new Error(sessionResult.error.message);
    currentUser = sessionResult.data.session ? sessionResult.data.session.user : null;
    if (currentUser) {
        const profile = await window.WaylineDatabase.getCompanyProfile(currentUser.id);
        partnerCompanyName.value = profile.name;
        document.getElementById("company").value = profile.name;
        setPartnerPreview(true);
    } else {
        setPartnerPreview(false);
    }
    await refreshAppData();
    window.WaylineDatabase.subscribeToBusChanges(function() {
        window.clearTimeout(busRefreshTimer);
        busRefreshTimer = window.setTimeout(function() {
            refreshBusAvailability(false);
        }, 200);
    }, function(status, error) {
        if (status === "SUBSCRIBED") {
            document.getElementById("availabilityStatus").textContent = "Live seat updates connected.";
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            console.error("Live bus availability could not connect.", error);
            document.getElementById("availabilityStatus").textContent =
                "Live updates are disconnected. Seats will refresh automatically every 30 seconds.";
        }
    });
    window.setInterval(function() {
        refreshBusAvailability(false);
    }, 30000);
    window.addEventListener("focus", function() {
        refreshBusAvailability(false);
    });
    document.addEventListener("visibilitychange", function() {
        if (document.visibilityState === "visible") refreshBusAvailability(false);
    });
}

function getRwandaDateTime() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Kigali",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date()).reduce(function(result, part) {
        result[part.type] = part.value;
        return result;
    }, {});
    return {
        date: parts.year + "-" + parts.month + "-" + parts.day,
        time: parts.hour + ":" + parts.minute
    };
}

function isTripUpcoming(bus) {
    const now = getRwandaDateTime();
    return bus.date > now.date || (bus.date === now.date && bus.departureTime > now.time);
}

const today = getRwandaDateTime().date;
document.getElementById("date").min = today;
document.getElementById("busDate").min = today;
const routeDistanceInput = document.getElementById("routeDistance");
const routeDistanceStatus = document.getElementById("routeDistanceStatus");
const calculateRouteDistanceButton = document.getElementById("calculateRouteDistance");
document.getElementById("fareCategory").addEventListener("change", updateCalculatedFare);

function normalizedText(value) {
    return value.trim().toLocaleLowerCase();
}

function normalizeRwandaPhoneNumber(value) {
    let phone = value.trim().replace(/[\s()-]/g, "");
    if (/^0[0-9]{9}$/.test(phone)) {
        phone = "+250" + phone.slice(1);
    } else if (/^250[0-9]{9}$/.test(phone)) {
        phone = "+" + phone;
    }
    return /^\+2507[0-9]{8}$/.test(phone) ? phone : "";
}

function formatBookingReference(bookingId) {
    return String(bookingId).replace(/-/g, "").slice(0, 12).toUpperCase();
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
    return "RWF " + new Intl.NumberFormat("en-RW", {
        maximumFractionDigits: 0
    }).format(Number(amount) || 0);
}

function calculateFare(routeDistanceKm, fareCategory) {
    const rate = ruraFarePerKm[fareCategory];
    if (!Number.isFinite(routeDistanceKm) || routeDistanceKm <= 0 || !rate) return 0;
    return Math.round(routeDistanceKm * rate);
}

function updateCalculatedFare() {
    const distance = Number(routeDistanceInput.value);
    const category = document.getElementById("fareCategory").value;
    const rate = ruraFarePerKm[category];
    const fare = calculateFare(distance, category);
    document.getElementById("calculatedFare").textContent = fare
        ? "Calculated fare: " + formatFare(fare) + " per passenger (" + distance +
            " km × RWF " + rate + "/km, rounded to the nearest RWF)."
        : "Calculate or enter the route distance to calculate the RWF fare.";
}

function getRouteKey() {
    return normalizedText(document.getElementById("busFrom").value) + "|" +
        normalizedText(document.getElementById("busTo").value);
}

function invalidateRouteDistance() {
    const routeKey = getRouteKey();
    if (routeDistanceController && requestedDistanceRoute !== routeKey) {
        cancelRouteDistanceLookup();
        routeDistanceStatus.textContent = "The route changed. Calculate the new distance or enter it manually.";
    }

    if (routeDistanceInput.value && routeDistanceInputKey !== routeKey) {
        routeDistanceInput.value = "";
        routeDistanceInputKey = "";
        updateCalculatedFare();
        routeDistanceStatus.textContent = "The route changed. Calculate the new distance or enter it manually.";
    }
}

function cancelRouteDistanceLookup() {
    if (!routeDistanceController) return;
    routeDistanceController.abort();
    routeDistanceController = null;
    requestedDistanceRoute = "";
    calculateRouteDistanceButton.disabled = false;
    calculateRouteDistanceButton.textContent = "Calculate road distance";
}

async function fetchDistanceData(url, signal) {
    const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: signal
    });
    if (!response.ok) {
        throw new Error("The distance service returned HTTP " + response.status + ".");
    }
    return response.json();
}

async function geocodeRwandanCity(city, signal) {
    const key = normalizedText(city);
    if (routeLocationCache.has(key)) return routeLocationCache.get(key);

    const query = encodeURIComponent(city + ", Rwanda");
    const url = "https://photon.komoot.io/api/?q=" + query + "&limit=5&lang=en";
    const data = await fetchDistanceData(url, signal);
    if (!data || !Array.isArray(data.features)) {
        throw new Error("The city lookup service returned an unexpected response.");
    }
    const feature = data.features.find(function(item) {
        return item.properties && item.properties.countrycode === "RW" &&
            item.geometry && Array.isArray(item.geometry.coordinates) &&
            item.geometry.coordinates.length >= 2 &&
            item.geometry.coordinates.every(Number.isFinite);
    });
    if (!feature) {
        throw new Error("Could not find \"" + city + "\" in Rwanda. Check the city name and try again.");
    }

    const coordinates = feature.geometry.coordinates.slice(0, 2);
    routeLocationCache.set(key, coordinates);
    return coordinates;
}

async function calculateRouteDistance() {
    const from = document.getElementById("busFrom").value.trim();
    const to = document.getElementById("busTo").value.trim();
    if (!from || !to) {
        routeDistanceStatus.textContent = "Enter both route cities before calculating the distance.";
        return;
    }
    if (normalizedText(from) === normalizedText(to)) {
        routeDistanceStatus.textContent = "Choose two different cities before calculating the distance.";
        return;
    }

    if (routeDistanceController) routeDistanceController.abort();
    const controller = new AbortController();
    routeDistanceController = controller;
    requestedDistanceRoute = getRouteKey();
    const routeKey = requestedDistanceRoute;
    let timedOut = false;
    const timeoutId = window.setTimeout(function() {
        timedOut = true;
        controller.abort();
    }, 20000);

    calculateRouteDistanceButton.disabled = true;
    calculateRouteDistanceButton.textContent = "Calculating...";
    routeDistanceStatus.textContent = "Finding the cities and calculating the road distance...";

    try {
        const fromCoordinates = await geocodeRwandanCity(from, controller.signal);
        const toCoordinates = await geocodeRwandanCity(to, controller.signal);
        const coordinates = fromCoordinates.join(",") + ";" + toCoordinates.join(",");
        const url = "https://router.project-osrm.org/route/v1/driving/" + coordinates +
            "?overview=false&steps=false";
        const data = await fetchDistanceData(url, controller.signal);
        if (data.code !== "Ok" || !data.routes || !data.routes.length ||
            !Number.isFinite(data.routes[0].distance) || data.routes[0].distance <= 0) {
            throw new Error("No drivable route was found between those cities.");
        }

        const distanceKm = Math.round(data.routes[0].distance / 100) / 10;
        if (distanceKm < 0.1 || distanceKm > 1000) {
            throw new Error("The estimated distance must be between 0.1 and 1,000 km. Verify the route and enter it manually.");
        }
        if (controller.signal.aborted || getRouteKey() !== routeKey) return;

        routeDistanceInput.value = distanceKm.toFixed(1);
        routeDistanceInputKey = routeKey;
        updateCalculatedFare();
        routeDistanceStatus.textContent =
            "Estimated road distance: " + distanceKm.toFixed(1) +
            " km from city center to city center. Check the actual bus route before saving.";
    } catch (error) {
        if (!controller.signal.aborted || timedOut) {
            routeDistanceStatus.textContent = timedOut
                ? "The road-distance request timed out. Check your connection and try again."
                : error.message || "Could not calculate the road distance. Enter it manually and try again.";
            console.error("Could not calculate the bus route distance.", error);
        }
    } finally {
        window.clearTimeout(timeoutId);
        if (routeDistanceController === controller) {
            routeDistanceController = null;
            requestedDistanceRoute = "";
            calculateRouteDistanceButton.disabled = false;
            calculateRouteDistanceButton.textContent = "Calculate road distance";
        }
    }
}

routeDistanceInput.addEventListener("input", function() {
    cancelRouteDistanceLookup();
    routeDistanceInputKey = routeDistanceInput.value ? getRouteKey() : "";
    routeDistanceStatus.textContent = routeDistanceInput.value
        ? "Using the manually entered distance."
        : "Enter the departure and destination cities to estimate the driving distance. You can edit the result.";
    updateCalculatedFare();
});
document.getElementById("busFrom").addEventListener("input", invalidateRouteDistance);
document.getElementById("busTo").addEventListener("input", invalidateRouteDistance);
calculateRouteDistanceButton.addEventListener("click", calculateRouteDistance);

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
        return bus.isActive && bus.availableSeats > 0 && bus.routeDistanceKm > 0 &&
            bus.company.trim() && bus.from && bus.to && isTripUpcoming(bus);
    }).map(function(bus) { return bus.company.trim(); })));
    companyFilter.replaceChildren(new Option(
        companies.length ? "All bus companies" : "No buses available yet",
        ""
    ));

    companies.sort(function(first, second) { return first.localeCompare(second); });
    companies.forEach(function(company) {
        companyFilter.appendChild(new Option(company, company));
    });
    if (companies.includes(selectedCompany)) companyFilter.value = selectedCompany;
}

function updateCitySuggestions() {
    const cities = new Map();
    commonCities.forEach(function(city) {
        cities.set(normalizedText(city), city);
    });
    buses.forEach(function(bus) {
        [bus.from, bus.to].forEach(function(city) {
            const trimmedCity = city.trim();
            if (trimmedCity) cities.set(normalizedText(trimmedCity), trimmedCity);
        });
    });

    document.getElementById("citySuggestions").replaceChildren(
        ...Array.from(cities.values())
            .sort(function(first, second) { return first.localeCompare(second); })
            .map(function(city) {
                const option = document.createElement("option");
                option.value = city;
                return option;
            })
    );
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
                bus.routeDistanceKm + " km | " + formatFare(bus.fare) + " per passenger"
        );
        const baseFare = bus.fare * requestedSeats;
        const total = baseFare;
        const priceBreakdown = makeElement(
            "p",
            "result-total",
            formatFare(bus.fare) + " x " + requestedSeats + " passengers = " + formatFare(total) + " total"
        );
        const bookButton = makeElement(
            "button",
            "button button-primary result-book-button",
            "Select trip and add passenger details | " + formatFare(total)
        );
        bookButton.type = "button";
        bookButton.addEventListener("click", function() {
            openDemoCheckout(bus.id, requestedSeats, baseFare, total);
        });

        result.append(heading, route, details, priceBreakdown, bookButton);
        searchResults.appendChild(result);
    });
}

function openDemoCheckout(busId, seatCount, baseFare, totalFare) {
    const bus = buses.find(function(item) { return item.id === busId; });

    if (!bus || !bus.isActive || bus.availableSeats < seatCount) {
        searchMessage.textContent = "Those places are no longer available. Search again for current availability.";
        performSearch();
        return;
    }

    passengerNameInput.value = "";
    passengerNameInput.setCustomValidity("");
    passengerPhoneInput.value = "";
    passengerPhoneInput.setCustomValidity("");
    document.getElementById("paymentMethod").value = "";
    pendingBooking = {
        busId: busId,
        seatCount: seatCount,
        baseFare: baseFare,
        totalFare: totalFare
    };
    document.getElementById("checkoutRoute").textContent =
        bus.company + " | " + bus.from + " to " + bus.to +
        " | " + formatDate(bus.date) + " at " + bus.departureTime +
        " | " + seatCount + (seatCount === 1 ? " passenger" : " passengers");
    document.getElementById("checkoutFare").textContent = formatFare(baseFare);
    document.getElementById("checkoutTotal").textContent = formatFare(totalFare);
    document.getElementById("checkoutDialog").showModal();
    passengerNameInput.focus();
}

function performSearch() {
    const from = document.getElementById("from").value.trim();
    const to = document.getElementById("to").value.trim();
    const date = document.getElementById("date").value;
    const company = companyFilter.value;
    const requestedSeats = Number(document.getElementById("seatCount").value);

    searchResults.replaceChildren();
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
        return bus.isActive && bus.availableSeats > 0 && bus.routeDistanceKm > 0 &&
            (!company || bus.company === company) && bus.from && bus.to && bus.date === date && isTripUpcoming(bus) &&
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

async function bookTrip(busId, seatCount, baseFare, totalFare, passengerName, passengerPhone, paymentMethod) {
    const bus = buses.find(function(item) { return item.id === busId; });
    const normalizedPhone = normalizeRwandaPhoneNumber(passengerPhone);

    if (!passengerName) {
        document.getElementById("passengerName").focus();
        return false;
    }
    if (!normalizedPhone) {
        passengerPhoneInput.setCustomValidity("Enter a valid Rwanda mobile number, such as 078 123 4567.");
        document.getElementById("passengerPhone").reportValidity();
        document.getElementById("passengerPhone").focus();
        return false;
    }
    if (!bus || !bus.isActive || bus.availableSeats < seatCount) {
        searchMessage.textContent = "Those seats are no longer available. Search again for current availability.";
        await refreshAppData();
        performSearch();
        return false;
    }

    const booking = await window.WaylineDatabase.createBooking(
        bus,
        passengerName,
        normalizedPhone,
        seatCount,
        paymentMethod
    );
    try {
        await refreshAppData();
        searchMessage.textContent = "Reservation saved. Payment has not been collected.";
        performSearch();
    } catch (error) {
        console.error("Reservation was saved, but availability could not be refreshed.", error);
        booking.refreshWarning =
            "Your reservation was saved, but seat availability could not refresh. Refresh the search before choosing another trip.";
    }
    return booking;
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
    passengerNameInput.value = "";
    passengerPhoneInput.value = "";
    document.getElementById("paymentMethod").value = "";
});

passengerNameInput.addEventListener("input", function() {
    passengerNameInput.setCustomValidity("");
});
passengerPhoneInput.addEventListener("input", function() {
    passengerPhoneInput.setCustomValidity("");
});

document.getElementById("confirmBooking").addEventListener("click", async function(event) {
    if (!pendingBooking) return;
    const paymentMethod = document.getElementById("paymentMethod");
    passengerNameInput.setCustomValidity("");
    passengerPhoneInput.setCustomValidity("");
    if (!passengerNameInput.value.trim()) {
        passengerNameInput.setCustomValidity("Enter the passenger's name.");
    }
    if (!passengerNameInput.reportValidity() || !passengerPhoneInput.reportValidity()) return;
    if (!paymentMethod.value) {
        paymentMethod.reportValidity();
        return;
    }
    const confirmButton = event.currentTarget;
    confirmButton.disabled = true;
    try {
        const booking = await bookTrip(
            pendingBooking.busId,
            pendingBooking.seatCount,
            pendingBooking.baseFare,
            pendingBooking.totalFare,
            passengerNameInput.value.trim(),
            passengerPhoneInput.value.trim(),
            paymentMethod.value
        );
        if (booking) {
            const bookingStatus = window.WaylineBookingStatus.describe(booking);
            document.getElementById("checkoutDialog").close();
            document.getElementById("bookingConfirmationRoute").textContent =
                booking.from + " to " + booking.to;
            document.getElementById("bookingConfirmationTravel").textContent =
                formatDate(booking.date) +
                (booking.departureTime ? " at " + booking.departureTime : "");
            document.getElementById("bookingConfirmationPassenger").textContent = booking.name;
            document.getElementById("bookingConfirmationCompany").textContent =
                booking.company || "Company not recorded";
            document.getElementById("bookingConfirmationAmount").textContent =
                formatFare(booking.totalFare);
            const bookingStatusBadge = document.getElementById("bookingConfirmationBookingStatus");
            bookingStatusBadge.className = "status-badge " + bookingStatus.className;
            bookingStatusBadge.textContent = bookingStatus.bookingLabel;
            document.getElementById("bookingConfirmationPaymentStatus").textContent =
                bookingStatus.paymentLabel + " · " + (booking.paymentMethod || "No method selected");
            document.getElementById("bookingConfirmationMessage").textContent =
                bookingStatus.description;
            document.getElementById("bookingConfirmationNextStep").textContent =
                booking.refreshWarning
                    ? bookingStatus.nextStep + " " + booking.refreshWarning
                    : bookingStatus.nextStep;
            document.getElementById("bookingConfirmationReference").textContent =
                formatBookingReference(booking.id);
            document.getElementById("bookingConfirmationDialog").showModal();
        }
    } catch (error) {
        document.getElementById("searchMessage").textContent = error.message || "Could not save the booking. Please try again.";
    } finally {
        confirmButton.disabled = false;
    }
});

function closeBookingConfirmation() {
    document.getElementById("bookingConfirmationDialog").close();
}

document.getElementById("closeBookingConfirmation").addEventListener("click", function() {
    closeBookingConfirmation();
});
document.getElementById("closeBookingConfirmationDone").addEventListener("click", function() {
    closeBookingConfirmation();
});

function renderBookings() {
    const companyBookingList = document.getElementById("companyBookingList");
    companyBookingList.replaceChildren();
    const activeCount = bookings.filter(function(booking) { return !booking.cancelled; }).length;
    document.getElementById("companyBookingCount").textContent = String(activeCount);
    document.getElementById("dashboardBookingCount").textContent = String(currentUser ? bookings.length : 0);

    if (!currentUser || bookings.length === 0) {
        if (currentUser) addEmptyMessage(companyBookingList, "No bookings have been made for your schedules yet.");
        return;
    }

    bookings.forEach(function(booking) {
        const card = makeElement("article", "record-card booking-card" + (booking.cancelled ? " is-cancelled" : ""));
        const top = makeElement("div", "record-topline");
        const route = makeElement("h3", "", booking.from + " to " + booking.to);
        top.appendChild(route);
        const bookingStatus = window.WaylineBookingStatus.describe(booking);
        top.appendChild(makeElement(
            "span",
            "status-badge " + bookingStatus.className,
            bookingStatus.bookingLabel
        ));

        const reference = makeElement("p", "ticket-reference", "TICKET REF  " + formatBookingReference(booking.id));
        const details = makeElement(
            "p",
            "record-details",
            booking.name + (booking.phone ? " | " + booking.phone : "") +
                " | " + (booking.company || "Company not recorded") +
                (booking.busName ? " | " + booking.busName : "") +
                "\n" + formatDate(booking.date) +
                (booking.departureTime ? " at " + booking.departureTime : "") +
                " | " + booking.seats + (booking.seats === 1 ? " passenger" : " passengers") +
                "\nPayment method: " + (booking.paymentMethod || "Not selected") +
                (booking.totalFare > 0 ? "\nFare " + formatFare(booking.baseFare) +
                    (booking.platformFee > 0 ? " | Service fee " + formatFare(booking.platformFee) : "") +
                    " | Total " + formatFare(booking.totalFare) : "") +
                "\nPayment: " + bookingStatus.paymentLabel +
                "\n" + bookingStatus.description
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

            card.appendChild(actions);
        }
        companyBookingList.appendChild(card);
    });
}

function resetScheduleEditor() {
    editingBusId = null;
    busForm.reset();
    cancelRouteDistanceLookup();
    routeDistanceInputKey = "";
    routeDistanceStatus.textContent =
        "Enter the departure and destination cities to estimate the driving distance. You can edit the result.";
    busForm.querySelector('button[type="submit"]').textContent = "Add bus schedule";
    document.getElementById("cancelBusEdit").hidden = true;
    updateCalculatedFare();
}

function editSchedule(bus) {
    if (!currentUser || bus.companyId !== currentUser.id) return;
    editingBusId = bus.id;
    document.getElementById("company").value = bus.company;
    document.getElementById("busName").value = bus.name;
    document.getElementById("busFrom").value = bus.from;
    document.getElementById("busTo").value = bus.to;
    document.getElementById("busDate").value = bus.date;
    document.getElementById("departureTime").value = bus.departureTime;
    document.getElementById("seatNumber").value = bus.totalSeats;
    routeDistanceInput.value = bus.routeDistanceKm;
    routeDistanceInputKey = getRouteKey();
    document.getElementById("fareCategory").value = bus.fareCategory;
    routeDistanceStatus.textContent = "Editing this schedule. Confirm the route distance before saving.";
    busForm.querySelector('button[type="submit"]').textContent = "Save schedule";
    document.getElementById("cancelBusEdit").hidden = false;
    updateCalculatedFare();
    busForm.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("busName").focus({ preventScroll: true });
}

document.getElementById("cancelBusEdit").addEventListener("click", function() {
    resetScheduleEditor();
    document.getElementById("busMessage").textContent = "Schedule edit cancelled.";
});

document.querySelectorAll(".dashboard-nav a").forEach(function(link) {
    link.addEventListener("click", function() {
        document.querySelectorAll(".dashboard-nav a").forEach(function(item) {
            item.classList.toggle("is-active", item === link);
        });
    });
});

function renderBuses() {
    busList.replaceChildren();
    const manageableBuses = currentUser
        ? buses.filter(function(bus) { return bus.companyId === currentUser.id; })
        : buses;
    document.getElementById("busCount").textContent =
        manageableBuses.length + (manageableBuses.length === 1 ? " schedule" : " schedules");
    document.getElementById("dashboardScheduleCount").textContent = String(manageableBuses.length);
    document.getElementById("dashboardActiveCount").textContent = String(
        manageableBuses.filter(function(bus) {
            return bus.isActive && bus.availableSeats > 0 && isTripUpcoming(bus);
        }).length
    );
    document.getElementById("dashboardSeatCount").textContent = String(
        manageableBuses.filter(function(bus) {
            return bus.isActive && isTripUpcoming(bus);
        })
            .reduce(function(total, bus) { return total + bus.availableSeats; }, 0)
    );

    if (manageableBuses.length === 0) {
        addEmptyMessage(busList, "No schedules yet. Add a bus above to make it bookable.");
        return;
    }

    manageableBuses.forEach(function(bus) {
        const card = makeElement("article", "record-card schedule-card");
        const top = makeElement("div", "record-topline");
        top.appendChild(makeElement("h3", "", bus.name));
        const availabilityText = !bus.isActive
            ? "Hidden from passengers"
            : !isTripUpcoming(bus)
                ? "Departed — removed from passenger search"
                : bus.availableSeats === 0
                    ? "Full — unavailable to passengers"
                    : bus.availableSeats + " / " + bus.totalSeats + " seats";
        top.appendChild(makeElement("span", "availability", availabilityText));

        const company = makeElement("div", "company-brand record-company-brand");
        const logo = makeCompanyLogo(bus, "company-logo");
        if (logo) company.appendChild(logo);
        company.appendChild(makeElement("p", "record-company", bus.company || "Company not set"));
        const scheduleText = bus.from && bus.to && bus.date && bus.departureTime
            ? bus.routeDistanceKm > 0
                ? bus.from + " to " + bus.to + "\n" + formatDate(bus.date) + " at " + bus.departureTime +
                    " | " + bus.routeDistanceKm + " km | " + formatFare(bus.fare) + " per passenger"
                : bus.from + " to " + bus.to + "\n" + formatDate(bus.date) +
                    " | Add a new schedule with route distance to apply RURA fares."
            : "Older bus record: add a new schedule to make this bus bookable.";
        const details = makeElement("p", "record-details", scheduleText);
        card.append(top, company, details);

        if (!currentUser) {
            const signInMessage = makeElement("p", "muted-label", "Sign in to manage schedules.");
            card.appendChild(signInMessage);
        } else {
            const actions = makeElement("div", "record-actions");
            const editButton = makeElement("button", "button button-text", "Edit schedule");
            editButton.type = "button";
            editButton.addEventListener("click", function() {
                editSchedule(bus);
            });
            const visibilityButton = makeElement(
                "button",
                "button button-text",
                bus.isActive ? "Hide schedule" : "Show schedule"
            );
            visibilityButton.type = "button";
            visibilityButton.addEventListener("click", function() {
                setScheduleActive(bus.id, !bus.isActive);
            });
            const removeButton = makeElement("button", "button button-danger", "Remove schedule");
            removeButton.type = "button";
            removeButton.addEventListener("click", function() {
                removeSchedule(bus.id);
            });
            actions.append(editButton, visibilityButton, removeButton);
            card.appendChild(actions);
        }
        busList.appendChild(card);
    });
}

async function setScheduleActive(busId, isActive) {
    const bus = buses.find(function(item) { return item.id === busId; });
    if (!currentUser || !bus || bus.companyId !== currentUser.id) return;

    try {
        await window.WaylineDatabase.setScheduleActive(busId, isActive);
        await refreshAppData();
    } catch (error) {
        document.getElementById("busMessage").textContent =
            error.message || "Could not update the schedule. Please try again.";
        return;
    }

    document.getElementById("busMessage").textContent = isActive
        ? "Schedule is visible to passengers again."
        : "Schedule hidden from passengers. Its records and bookings are kept.";
    if (document.getElementById("date").value) performSearch();
}

async function removeSchedule(busId) {
    const bus = buses.find(function(item) { return item.id === busId; });
    if (!currentUser || !bus || bus.companyId !== currentUser.id) return;
    if (!window.confirm("Permanently remove " + bus.name + "? Schedules with ticket records cannot be removed.")) return;

    try {
        await window.WaylineDatabase.removeSchedule(busId);
        await refreshAppData();
        document.getElementById("busMessage").textContent = "Schedule permanently removed.";
        if (document.getElementById("date").value) performSearch();
    } catch (error) {
        document.getElementById("busMessage").textContent =
            error.message || "Could not remove the schedule. Please try again.";
    }
}

searchForm.addEventListener("submit", function(event) {
    event.preventDefault();
    searchMessage.textContent = "";
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
    const routeDistanceKm = Number(document.getElementById("routeDistance").value);
    const fareCategory = document.getElementById("fareCategory").value;
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
    const rwandaNow = getRwandaDateTime();
    if (date < rwandaNow.date || (date === rwandaNow.date && departureTime <= rwandaNow.time)) {
        busMessage.textContent = "A bus departure must be in the future in Rwanda time.";
        return;
    }
    if (!Number.isInteger(totalSeats) || totalSeats < 1 || totalSeats > 100 ||
        !Number.isFinite(routeDistanceKm) || routeDistanceKm < 0.1 || routeDistanceKm > 1000 ||
        !ruraFarePerKm[fareCategory]) {
        busMessage.textContent = "Enter 1 to 100 seats, a route distance from 0.1 to 1,000 km, and a RURA fare area.";
        return;
    }
    const editingBus = editingBusId
        ? buses.find(function(item) { return item.id === editingBusId; })
        : null;
    if (editingBus && totalSeats < editingBus.totalSeats - editingBus.availableSeats) {
        busMessage.textContent = "Total seats cannot be lower than the " +
            (editingBus.totalSeats - editingBus.availableSeats) + " seats already reserved.";
        return;
    }
    const hasBookings = editingBus && bookings.some(function(booking) {
        return booking.busId === editingBus.id;
    });
    if (hasBookings && (
        name !== editingBus.name ||
        from !== editingBus.from ||
        to !== editingBus.to ||
        date !== editingBus.date ||
        departureTime !== editingBus.departureTime
    )) {
        busMessage.textContent =
            "This schedule has booking records, so its bus name, route, date, and departure time cannot be changed. Hide it and add a new schedule instead.";
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
        routeDistanceKm: routeDistanceKm,
        fareCategory: fareCategory
    };
    try {
        if (editingBusId) {
            await window.WaylineDatabase.updateSchedule(editingBusId, bus, logo);
        } else {
            const savedBus = await window.WaylineDatabase.createSchedule(bus, logo);
            buses.unshift(savedBus);
        }
        partnerCompanyName.value = company;
        document.getElementById("dashboardCompanyName").textContent = company;
        document.getElementById("dashboardWelcome").textContent = "Welcome back, " + company;
        await refreshAppData();
    } catch (error) {
        busMessage.textContent = error.message ||
            (editingBusId ? "Could not update this schedule. Please try again." : "Could not save this schedule. Please try again.");
        return;
    }

    const wasEditing = Boolean(editingBusId);
    resetScheduleEditor();
    busMessage.textContent = wasEditing
        ? "Schedule updated. The fare is recalculated using the selected RURA tariff."
        : "Bus schedule added. The fare is calculated automatically using the RURA tariff.";
    updateCompanyOptions();
    if (document.getElementById("date").value) performSearch();
});

const recoveryError = new URLSearchParams(window.location.hash.slice(1));
if (recoveryError.get("error_code") === "otp_expired") {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    showPartnerLoginForm();
    setPartnerFormMode(false);
    loginMessage.textContent =
        "This email link has expired or was already used. Request a fresh confirmation or password-reset email, then open the newest link once. Use Create a company account for email confirmation or Forgot your password for a reset.";
    partnerLoginScreen.showModal();
}

initializeApp().catch(function(error) {
    setPartnerPreview(false);
    searchMessage.textContent =
        "Could not connect to the shared booking database. Check your internet connection and reload the page.";
    console.error(error);
});