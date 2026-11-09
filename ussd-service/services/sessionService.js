function parseUssdText(text) {
    if (text === undefined || text === null || text === "") return [];
    if (typeof text !== "string" || text.length > 240) {
        throw new Error("Invalid USSD input.");
    }
    return text.split("*").slice(0, 12).map(function(value) {
        return value.trim();
    });
}

function createSessionService(supabase, options) {
    const ttlSeconds = Math.max(180, options.ttlSeconds || 600);
    let loadsSinceCleanup = 0;

    async function load(sessionId, phone) {
        loadsSinceCleanup += 1;
        if (loadsSinceCleanup >= 100) {
            const cleanup = await supabase
                .from("ussd_sessions")
                .delete()
                .lt("expires_at", new Date().toISOString());
            if (cleanup.error) throw new Error(cleanup.error.message);
            loadsSinceCleanup = 0;
        }
        const result = await supabase
            .from("ussd_sessions")
            .select("phone, state, input_cursor, expires_at")
            .eq("session_id", sessionId)
            .maybeSingle();
        if (result.error) throw new Error(result.error.message);

        const expiresAt = result.data ? Date.parse(result.data.expires_at) : 0;
        if (!result.data || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
            return {
                sessionId: sessionId,
                phone: phone,
                state: { step: "language", page: 0 },
                inputCursor: 0
            };
        }
        if (result.data.phone && result.data.phone !== phone) {
            throw new Error("The USSD session phone number changed.");
        }
        return {
            sessionId: sessionId,
            phone: phone,
            state: result.data.state,
            inputCursor: Number(result.data.input_cursor) || 0
        };
    }

    async function save(sessionId, phone, state, inputCursor) {
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
        const result = await supabase.from("ussd_sessions").upsert({
            session_id: sessionId,
            phone: phone,
            state: state,
            input_cursor: inputCursor,
            expires_at: expiresAt,
            updated_at: new Date().toISOString()
        }, { onConflict: "session_id" });
        if (result.error) throw new Error(result.error.message);
    }

    function nextInput(session, parts) {
        if (parts.length <= session.inputCursor) return null;
        return parts[session.inputCursor];
    }

    return { load, save, nextInput, parseUssdText };
}

module.exports = { createSessionService, parseUssdText };
