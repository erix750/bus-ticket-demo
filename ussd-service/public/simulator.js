(function() {
    const code = document.getElementById("shortCode");
    const phoneCode = document.getElementById("phoneCode");
    const status = document.getElementById("status");
    const dataSource = document.getElementById("dataSource");
    const tripInventory = document.getElementById("tripInventory");
    const bookingCount = document.getElementById("bookingCount");
    const callerPhone = document.getElementById("callerPhone");
    const phoneNumber = document.getElementById("phoneNumber");
    const screenLabel = document.getElementById("screenLabel");
    const message = document.getElementById("ussdMessage");
    const startForm = document.getElementById("startForm");
    const inputForm = document.getElementById("inputForm");
    const input = document.getElementById("ussdInput");
    const sendButton = document.getElementById("sendInput");
    const newSessionButton = document.getElementById("newSession");
    const keypad = document.querySelectorAll(".keypad button");
    let activeSession = null;
    let accumulatedText = "";
    let isSending = false;

    function setInputEnabled(enabled) {
        input.disabled = !enabled;
        sendButton.disabled = !enabled;
        newSessionButton.disabled = !enabled;
        keypad.forEach(function(button) { button.disabled = !enabled; });
        if (enabled) input.focus();
    }

    async function readStatus() {
        try {
            const response = await fetch("/simulator/api/status");
            if (!response.ok) throw new Error("Could not read prototype status.");
            const details = await response.json();
            code.textContent = details.serviceCode;
            phoneCode.textContent = details.serviceCode;
            document.querySelector(".primary-button").textContent = "Dial " + details.serviceCode;
            dataSource.textContent = details.source + " " + details.tripCount + " trips are listed.";
            bookingCount.textContent = details.bookingCount === null
                ? ""
                : "Local sample bookings: " + details.bookingCount;
            tripInventory.replaceChildren();
            details.trips.forEach(function(trip) {
                const item = document.createElement("li");
                const route = document.createElement("strong");
                route.textContent = trip.from + " to " + trip.to + " · " + trip.departureTime;
                const summary = document.createElement("span");
                summary.textContent = trip.bus + " · " + trip.seats + " seats · RWF " +
                    new Intl.NumberFormat("en-RW", { maximumFractionDigits: 0 }).format(trip.fare);
                item.append(route, summary);
                tripInventory.appendChild(item);
            });
        } catch (error) {
            dataSource.textContent = error.message || "Could not read trip data status.";
        }
    }

    async function sendValue(value) {
        if (!activeSession || isSending || (!value.trim() && accumulatedText)) return;
        isSending = true;
        status.textContent = "";
        input.disabled = true;
        sendButton.disabled = true;

        accumulatedText = accumulatedText
            ? accumulatedText + "*" + value.trim()
            : value.trim();
        input.value = "";
        screenLabel.textContent = "Sending…";

        try {
            const response = await fetch("/simulator/api/ussd", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId: activeSession,
                    serviceCode: code.textContent,
                    phoneNumber: callerPhone.value,
                    text: accumulatedText
                })
            });
            const body = await response.text();
            if (!response.ok) throw new Error(body.replace(/^(CON|END)\s*/, ""));
            const kind = body.startsWith("END ") ? "END" : body.startsWith("CON ") ? "CON" : "";
            if (!kind) throw new Error("The USSD service returned an invalid response.");
            message.textContent = body.slice(kind.length).trim();
            screenLabel.textContent = kind === "END" ? "Session ended" : "USSD menu";
            if (kind === "END") {
                status.textContent = "The simulated session has ended. Start a new session to book another trip.";
                setInputEnabled(false);
                await readStatus();
            } else {
                input.disabled = false;
                sendButton.disabled = false;
                keypad.forEach(function(button) { button.disabled = false; });
                input.focus();
            }
        } catch (error) {
            accumulatedText = accumulatedText.split("*").slice(0, -1).join("*");
            message.textContent = "Request error";
            status.textContent = error.message || "Could not contact the local USSD service.";
            input.disabled = false;
            sendButton.disabled = false;
            input.focus();
        } finally {
            isSending = false;
        }
    }

    startForm.addEventListener("submit", async function(event) {
        event.preventDefault();
        if (!callerPhone.value.trim()) {
            callerPhone.focus();
            return;
        }
        activeSession = window.crypto && window.crypto.randomUUID
            ? window.crypto.randomUUID()
            : "local-" + Date.now() + "-" + Math.random().toString(16).slice(2);
        accumulatedText = "";
        phoneNumber.textContent = callerPhone.value.trim();
        message.textContent = "Connecting to " + code.textContent + "…";
        screenLabel.textContent = "USSD menu";
        status.textContent = "";
        setInputEnabled(true);
        await sendValue("");
    });

    inputForm.addEventListener("submit", function(event) {
        event.preventDefault();
        sendValue(input.value);
    });

    keypad.forEach(function(button) {
        button.addEventListener("click", function() {
            sendValue(button.dataset.key);
        });
    });

    newSessionButton.addEventListener("click", function() {
        activeSession = null;
        accumulatedText = "";
        phoneNumber.textContent = "No caller";
        screenLabel.textContent = "USSD menu";
        message.textContent = "Enter a caller number, then dial the code to begin.";
        status.textContent = "";
        setInputEnabled(false);
    });

    readStatus();
})();
