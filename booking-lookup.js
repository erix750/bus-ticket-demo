(function() {
    const startForm = document.getElementById("bookingLookupStartForm");
    const verifyForm = document.getElementById("bookingLookupVerifyForm");
    const message = document.getElementById("bookingLookupMessage");
    const resultsContainer = document.getElementById("bookingLookupResult");
    const phoneInput = document.getElementById("bookingLookupPhone");
    const referenceInput = document.getElementById("bookingLookupReference");
    const codeInput = document.getElementById("bookingLookupCode");
    let pendingLookup = null;

    function normalizeRwandaPhoneNumber(value) {
        let phone = value.trim().replace(/[\s()-]/g, "");
        if (/^0[0-9]{9}$/.test(phone)) {
            phone = "+250" + phone.slice(1);
        } else if (/^250[0-9]{9}$/.test(phone)) {
            phone = "+" + phone;
        }
        return /^\+2507[0-9]{8}$/.test(phone) ? phone : "";
    }

    function formatJourneyTiming(booking) {
        const duration = Number(booking.estimatedDurationMinutes);
        if (!Number.isInteger(duration) || duration < 1 || !booking.date || !booking.departureTime) {
            return "\nArrival and duration not provided by operator";
        }
        const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(booking.date);
        const timeParts = /^(\d{2}):(\d{2})$/.exec(booking.departureTime);
        if (!dateParts || !timeParts) return "\nArrival and duration not provided by operator";

        const arrival = new Date(Date.UTC(
            Number(dateParts[1]),
            Number(dateParts[2]) - 1,
            Number(dateParts[3]),
            Number(timeParts[1]),
            Number(timeParts[2]) + duration
        ));
        return "\nAbout " + formatDuration(duration) + " | Estimated arrival " +
            (arrival.toISOString().slice(0, 10) === booking.date
                ? arrival.toISOString().slice(11, 16)
                : formatDate(arrival.toISOString().slice(0, 10)) + " at " +
                    arrival.toISOString().slice(11, 16));
    }

    function formatDuration(minutes) {
        const duration = Number(minutes);
        if (!Number.isInteger(duration) || duration < 1) return "Duration not provided";
        const hours = Math.floor(duration / 60);
        const remainingMinutes = duration % 60;
        if (!hours) return remainingMinutes + " min";
        return hours + " hr" + (hours === 1 ? "" : "s") +
            (remainingMinutes ? " " + remainingMinutes + " min" : "");
    }

    function makeElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function formatDate(date) {
        if (!date) return "Date not set";
        return new Date(date + "T12:00:00").toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    function formatBookingReference(bookingId) {
        return String(bookingId).replace(/-/g, "").slice(0, 12).toUpperCase();
    }

    function formatFare(amount) {
        return "RWF " + new Intl.NumberFormat("en-RW", {
            maximumFractionDigits: 0
        }).format(Number(amount) || 0);
    }

    function showBookings(bookings) {
        resultsContainer.replaceChildren();
        bookings.forEach(function(booking) {
            const card = makeElement("article", "record-card booking-card" + (booking.cancelled ? " is-cancelled" : ""));
            const top = makeElement("div", "record-topline");
            top.appendChild(makeElement(
                "h2",
                "",
                window.WaylineRouteUtils.formatRoute(booking.from, booking.to)
            ));
            const bookingStatus = window.WaylineBookingStatus.describe(booking);
            top.appendChild(makeElement(
                "span",
                "status-badge " + bookingStatus.className,
                bookingStatus.bookingLabel
            ));

            const reference = makeElement(
                "p",
                "ticket-reference",
                "BOOKING REF  " + formatBookingReference(booking.id)
            );
            const details = makeElement(
                "p",
                "record-details",
                "Passenger: " + (booking.name || "Name not recorded") +
                    "\nCompany: " + (booking.company || "Company not recorded") +
                    (booking.busName ? " | " + booking.busName : "") +
                    "\nDeparture: " + formatDate(booking.date) +
                    (booking.departureTime ? " at " + booking.departureTime : "") +
                    formatJourneyTiming(booking) +
                    (window.WaylineRouteUtils.parseStops(booking.intermediateStops).length
                        ? "\nVia " + window.WaylineRouteUtils.parseStops(booking.intermediateStops).join(" · ")
                        : "") +
                    " | " + booking.seats + (booking.seats === 1 ? " passenger" : " passengers") +
                    "\nTotal amount due: " + formatFare(booking.totalFare) +
                    "\nIntended payment method: " + (booking.paymentMethod || "Not selected") +
                    "\nPayment status: " + bookingStatus.paymentLabel +
                    "\n" + bookingStatus.description +
                    "\nNext step: " + bookingStatus.nextStep
            );
            const actions = makeElement("div", "record-actions");
            const copyButton = makeElement("button", "button button-secondary", "Copy reference");
            copyButton.type = "button";
            copyButton.addEventListener("click", async function() {
                const bookingReference = formatBookingReference(booking.id);
                try {
                    if (navigator.clipboard && window.isSecureContext) {
                        await navigator.clipboard.writeText(bookingReference);
                    } else {
                        const temporaryInput = document.createElement("textarea");
                        temporaryInput.value = bookingReference;
                        temporaryInput.setAttribute("readonly", "");
                        temporaryInput.style.position = "fixed";
                        temporaryInput.style.opacity = "0";
                        document.body.appendChild(temporaryInput);
                        temporaryInput.select();
                        const copied = document.execCommand("copy");
                        temporaryInput.remove();
                        if (!copied) throw new Error("Clipboard access is unavailable.");
                    }
                    copyButton.textContent = "Reference copied";
                } catch (error) {
                    copyButton.textContent = "Select reference to copy";
                    const range = document.createRange();
                    range.selectNodeContents(reference);
                    const selection = window.getSelection();
                    if (selection) {
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                    console.error("Could not copy the passenger booking reference.", error);
                }
            });
            actions.appendChild(copyButton);
            card.append(top, reference, details);

            if (!booking.cancelled) {
                const printButton = makeElement("button", "button button-print", "Print booking details");
                printButton.type = "button";
                printButton.addEventListener("click", function() {
                    card.classList.add("is-printing");
                    document.body.classList.add("printing-ticket");
                    window.print();
                    card.classList.remove("is-printing");
                    document.body.classList.remove("printing-ticket");
                });
                actions.appendChild(printButton);
            }
            card.appendChild(actions);

            resultsContainer.appendChild(card);
        });
        resultsContainer.hidden = false;
    }

    phoneInput.addEventListener("input", function() {
        phoneInput.setCustomValidity("");
    });

    referenceInput.addEventListener("input", function() {
        referenceInput.setCustomValidity("");
    });

    startForm.addEventListener("submit", async function(event) {
        event.preventDefault();
        message.textContent = "";
        resultsContainer.replaceChildren();
        resultsContainer.hidden = true;

        const phone = normalizeRwandaPhoneNumber(phoneInput.value);
        phoneInput.setCustomValidity(phone
            ? ""
            : "Enter a valid Rwanda mobile number, such as 078 123 4567.");
        const reference = referenceInput.value.replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
        referenceInput.setCustomValidity(/^[A-F0-9]{8,32}$/.test(reference)
            ? ""
            : "Enter the booking reference shown in your confirmation.");
        if (!startForm.reportValidity()) return;

        const button = document.getElementById("sendBookingOtp");
        button.disabled = true;
        try {
            await window.WaylineDatabase.sendPassengerBookingOtp(phone);
            pendingLookup = { reference: reference, phone: phone };
            startForm.hidden = true;
            verifyForm.hidden = false;
            codeInput.value = "";
            document.getElementById("bookingOtpHint").textContent =
                "Enter the 6-digit code sent to " + phone.slice(0, 5) + "••••••" + phone.slice(-2) + ".";
            message.textContent = "If SMS delivery is available, your verification code should arrive shortly.";
            codeInput.focus();
        } catch (error) {
            message.textContent = error.message || "Could not send a verification code. Check the phone number and try again.";
        } finally {
            button.disabled = false;
        }
    });

    document.getElementById("resendBookingOtp").addEventListener("click", async function(event) {
        if (!pendingLookup) return;
        const button = event.currentTarget;
        button.disabled = true;
        message.textContent = "";
        try {
            await window.WaylineDatabase.sendPassengerBookingOtp(pendingLookup.phone);
            message.textContent = "A new verification code was requested. Wait a moment for SMS delivery.";
        } catch (error) {
            message.textContent = error.message || "Could not send another code. Please wait and try again.";
        } finally {
            button.disabled = false;
        }
    });

    document.getElementById("changeBookingPhone").addEventListener("click", function() {
        pendingLookup = null;
        codeInput.value = "";
        message.textContent = "";
        verifyForm.hidden = true;
        startForm.hidden = false;
        phoneInput.focus();
    });

    verifyForm.addEventListener("submit", async function(event) {
        event.preventDefault();
        message.textContent = "";
        if (!pendingLookup || !verifyForm.reportValidity()) return;

        const button = document.getElementById("verifyBookingOtp");
        button.disabled = true;
        let bookings = [];
        let lookupError = null;
        let phoneVerified = false;
        try {
            const verification = await window.WaylineDatabase.verifyPassengerBookingOtp(
                pendingLookup.phone,
                codeInput.value.trim()
            );
            if (!verification.user || verification.user.phone !== pendingLookup.phone) {
                throw new Error("The verified phone number did not match. Request a new code and try again.");
            }
            phoneVerified = true;
            bookings = await window.WaylineDatabase.findPassengerBooking(pendingLookup.reference);
        } catch (error) {
            lookupError = error;
        }

        try {
            await window.WaylineDatabase.clearPassengerBookingSession();
        } catch (error) {
            console.error("Could not clear the temporary passenger verification session.", error);
            if (!lookupError) {
                lookupError = new Error("Your phone was verified, but the temporary session could not be cleared. Please reload this page.");
            }
        } finally {
            button.disabled = false;
        }

        if (lookupError) {
            message.textContent = lookupError.message ||
                (phoneVerified ? "Could not retrieve this booking." : "That code could not be verified. Check it and try again.");
            if (phoneVerified) {
                pendingLookup = null;
                verifyForm.hidden = true;
                startForm.hidden = false;
            } else {
                codeInput.value = "";
            }
            return;
        }

        pendingLookup = null;
        verifyForm.hidden = true;
        startForm.hidden = false;
        codeInput.value = "";
        phoneInput.value = "";
        referenceInput.value = "";
        if (bookings.length === 0) {
            message.textContent =
                "We couldn’t find a booking for that reference and verified phone number. Check both and try again.";
            return;
        }

        message.textContent = bookings.length === 1
            ? "Booking found. Keep the reference available when contacting the bus company."
            : bookings.length + " bookings match that reference and verified phone number.";
        showBookings(bookings);
    });
})();
