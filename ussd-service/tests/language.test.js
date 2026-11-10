const test = require("node:test");
const assert = require("node:assert/strict");
const { createLanguageService } = require("../services/languageService");

test("all supported language choices resolve and have complete menu translations", function() {
    const service = createLanguageService();
    assert.deepEqual(service.codes, ["en", "rw", "fr", "sw"]);
    assert.equal(service.fromChoice("1"), "en");
    assert.equal(service.fromChoice("4"), "sw");
    assert.equal(service.fromChoice("5"), "");
    for (const language of service.codes) {
        assert.notEqual(service.text(language, "mainMenu"), "mainMenu");
        assert.notEqual(service.text(language, "companyPrompt"), "companyPrompt");
        assert.notEqual(service.text(language, "booked", { reference: "ABCD" }), "booked");
    }
});

test("language prompts interpolate fare and booking reference safely", function() {
    const service = createLanguageService();
    assert.equal(
        service.text("en", "booked", { reference: "ABC123" }),
        "Booking confirmed. Ref: ABC123. NOT PAID. Contact the bus company to pay."
    );
    assert.match(service.languagePrompt(), /Kinyarwanda/);
});
