const paymentMethods = ["MTN Mobile Money", "Airtel Money"];

function createPaymentService() {
    return {
        choices: paymentMethods,
        fromChoice: function(value) {
            const index = Number(value) - 1;
            return Number.isInteger(index) && index >= 0 && index < paymentMethods.length
                ? paymentMethods[index]
                : "";
        }
    };
}

module.exports = { createPaymentService };
