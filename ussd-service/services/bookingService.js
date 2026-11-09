function createBookingService(supabase) {
    async function create(input) {
        const result = await supabase.rpc("ussd_book_bus", {
            p_session_id: input.sessionId,
            p_bus_id: input.trip.id,
            p_passenger_name: input.passengerName,
            p_passenger_phone: input.phone,
            p_seat_count: input.seats,
            p_payment_method: input.paymentMethod
        });
        if (result.error) throw new Error(result.error.message);
        if (!result.data || !result.data.id) throw new Error("Booking was not returned by the database.");
        return result.data;
    }

    return { create };
}

module.exports = { createBookingService };
