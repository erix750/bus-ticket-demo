// Sends an SMS confirmation through Africa's Talking when a booking is created.
// Triggered by a Supabase Database Webhook (INSERT on public.bookings).
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildConfirmationMessage, shouldSendConfirmation } from "./message.mjs";

const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
);

function sameSecret(a: string, b: string): boolean {
    if (a.length !== b.length || a.length === 0) return false;
    let difference = 0;
    for (let index = 0; index < a.length; index += 1) {
        difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
    }
    return difference === 0;
}

async function sendSms(to: string, message: string): Promise<void> {
    const username = Deno.env.get("AT_USERNAME") ?? "";
    const apiKey = Deno.env.get("AT_API_KEY") ?? "";
    const sandbox = username === "sandbox";
    const endpoint = sandbox
        ? "https://api.sandbox.africastalking.com/version1/messaging"
        : "https://api.africastalking.com/version1/messaging";
    const body = new URLSearchParams({ username, to, message });
    const senderId = Deno.env.get("AT_SENDER_ID");
    if (senderId) body.set("from", senderId);

    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            apiKey,
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
    });
    const result = await response.json().catch(() => ({}));
    const recipient = result?.SMSMessageData?.Recipients?.[0];
    if (!response.ok || !recipient || !/success/i.test(String(recipient.status))) {
        throw new Error(String(recipient?.status || result?.SMSMessageData?.Message || response.status));
    }
}

Deno.serve(async (request) => {
    const expected = Deno.env.get("WEBHOOK_SECRET") ?? "";
    if (!sameSecret(expected, request.headers.get("x-webhook-secret") ?? "")) {
        return new Response("Unauthorized", { status: 401 });
    }

    let payload;
    try {
        payload = await request.json();
    } catch {
        return new Response("Bad request", { status: 400 });
    }
    const booking = payload?.record;
    if (payload?.type !== "INSERT" || !shouldSendConfirmation(booking)) {
        return new Response("Skipped", { status: 200 });
    }

    // Claim the booking first so a retried webhook cannot send a second SMS.
    const claim = await supabase
        .from("bookings")
        .update({ confirmation_sms_sent_at: new Date().toISOString(), confirmation_sms_error: null })
        .eq("id", booking.id)
        .is("confirmation_sms_sent_at", null)
        .select("id");
    if (claim.error) return new Response("Database error", { status: 500 });
    if (!claim.data || claim.data.length === 0) return new Response("Already handled", { status: 200 });

    try {
        await sendSms(booking.passenger_phone, buildConfirmationMessage(booking, Deno.env.get("SITE_URL") ?? ""));
        return new Response("Sent", { status: 200 });
    } catch (error) {
        await supabase
            .from("bookings")
            .update({
                confirmation_sms_sent_at: null,
                confirmation_sms_error: String((error as Error).message).slice(0, 200),
            })
            .eq("id", booking.id);
        // 200 so the webhook does not retry in a loop; the error is stored on the booking.
        return new Response("SMS failed", { status: 200 });
    }
});
