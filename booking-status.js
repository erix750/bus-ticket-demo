(function() {
    function describe(booking) {
        if (booking.cancelled) {
            return {
                bookingLabel: "Cancelled",
                paymentLabel: "Not applicable",
                description: "This reservation was cancelled.",
                nextStep: "Contact Wayline or the bus company if you have a cancellation or refund question.",
                className: "status-cancelled"
            };
        }

        const paymentStatus = String(booking.paymentStatus || "").toLowerCase().replace(/_/g, "-");
        if (paymentStatus === "paid") {
            return {
                bookingLabel: "Paid ticket confirmed",
                paymentLabel: "Confirmed",
                description: "Payment has been successfully verified.",
                nextStep: "Keep your booking reference and show this confirmed ticket when boarding.",
                className: "status-confirmed"
            };
        }

        if (["pending", "payment-pending", "awaiting-payment", "processing"].includes(paymentStatus)) {
            return {
                bookingLabel: "Payment pending",
                paymentLabel: "Awaiting payment",
                description: "Payment has been started or is awaiting verification. The ticket is not confirmed as paid.",
                nextStep: "Wait for payment verification. Do not travel until the ticket is confirmed as paid.",
                className: "status-pending"
            };
        }

        return {
            bookingLabel: "Reservation saved",
            paymentLabel: "Saved",
            description: "Your reservation has been recorded, but payment has not been completed.",
            nextStep: "Payments are not active on Wayline yet. Contact the bus company to arrange payment; this reservation is not a paid ticket.",
            className: "status-saved"
        };
    }

    window.WaylineBookingStatus = Object.freeze({ describe: describe });
})();
