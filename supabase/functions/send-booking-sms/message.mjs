const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatReference(bookingId) {
    return String(bookingId).replace(/-/g, "").slice(0, 12).toUpperCase();
}

function formatDate(isoDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate));
    if (!match) return String(isoDate);
    return Number(match[3]) + " " + MONTHS[Number(match[2]) - 1] + " " + match[1];
}

function formatFare(amount) {
    return "RWF " + Math.round(Number(amount) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function plain(text) {
    // Keep the SMS in the GSM-7 character set where possible so it stays one or two segments.
    return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "");
}

export function buildConfirmationMessage(booking, siteUrl) {
    const seats = Number(booking.seat_count) || 1;
    const lookup = siteUrl ? " Details: " + siteUrl.replace(/\/+$/, "") + "/booking.html" : "";
    return "Wayline booking " + formatReference(booking.id) + ": " +
        plain(booking.from_city) + " to " + plain(booking.to_city) + ", " +
        formatDate(booking.travel_date) + " " + String(booking.departure_time).slice(0, 5) + ", " +
        seats + (seats === 1 ? " seat" : " seats") + ", " + formatFare(booking.total_fare) +
        ". Not paid yet; seats are held for 15 minutes." + lookup;
}

export function shouldSendConfirmation(booking) {
    return Boolean(booking) &&
        !booking.cancelled &&
        !booking.confirmation_sms_sent_at &&
        /^\+2507[0-9]{8}$/.test(String(booking.passenger_phone || ""));
}
