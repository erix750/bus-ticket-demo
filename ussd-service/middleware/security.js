const { timingSafeEqual } = require("node:crypto");

function sameSecret(first, second) {
    const left = Buffer.from(first);
    const right = Buffer.from(second);
    return left.length === right.length && timingSafeEqual(left, right);
}

function createSecurityMiddleware(options) {
    const callbackToken = (options.callbackToken || "").trim();
    if (callbackToken.length < 32) {
        throw new Error("USSD_CALLBACK_TOKEN must contain at least 32 characters.");
    }
    const configuredServiceCode = (options.serviceCode || "*200#").trim();
    if (!/^[*#0-9]{1,32}$/.test(configuredServiceCode)) {
        throw new Error("USSD_SERVICE_CODE must be a valid USSD short code.");
    }

    const requestsPerMinute = Math.max(10, options.requestsPerMinute || 40);
    const attempts = new Map();
    let lastCleanup = Date.now();

    function authenticate(request, response, next) {
        const authorization = request.get("authorization") || "";
        const headerToken = authorization.startsWith("Bearer ")
            ? authorization.slice(7)
            : request.get("x-ussd-token") || "";
        const providedToken = headerToken || String(request.query.token || "");
        if (!sameSecret(callbackToken, providedToken)) {
            response.status(401).type("text/plain").send("END Unauthorized.");
            return;
        }
        next();
    }

    function rateLimit(request, response, next) {
        const now = Date.now();
        if (now - lastCleanup > 60_000) {
            for (const [key, timestamps] of attempts) {
                const current = timestamps.filter(function(timestamp) {
                    return now - timestamp < 60_000;
                });
                if (current.length) attempts.set(key, current);
                else attempts.delete(key);
            }
            lastCleanup = now;
        }

        const sessionId = request.body && request.body.sessionId;
        const key = typeof sessionId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(sessionId)
            ? sessionId
            : String(request.ip || "unknown").slice(0, 100);
        const timestamps = (attempts.get(key) || []).filter(function(timestamp) {
            return now - timestamp < 60_000;
        });
        if (timestamps.length >= requestsPerMinute) {
            response.status(429).type("text/plain").send("END Too many requests. Please try again later.");
            return;
        }
        timestamps.push(now);
        attempts.set(key, timestamps);
        next();
    }

    function validateCallback(request, response, next) {
        const { sessionId, serviceCode: callbackServiceCode, phoneNumber, text } = request.body || {};
        if (typeof sessionId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(sessionId) ||
            callbackServiceCode !== configuredServiceCode ||
            typeof phoneNumber !== "string" || phoneNumber.length > 24 ||
            (text !== undefined && (typeof text !== "string" || text.length > 240))) {
            response.status(400).type("text/plain").send("END Invalid USSD request.");
            return;
        }
        next();
    }

    return { authenticate, rateLimit, validateCallback };
}

module.exports = { createSecurityMiddleware };
