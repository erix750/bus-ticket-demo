"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    normalizeRwandaPhoneNumber,
    validatePassengerNames
} = require("../booking-utils");

test("normalizes valid Rwanda mobile numbers to international format", function() {
    assert.equal(normalizeRwandaPhoneNumber("078 123 4567"), "+250781234567");
    assert.equal(normalizeRwandaPhoneNumber("250781234567"), "+250781234567");
    assert.equal(normalizeRwandaPhoneNumber("+250781234567"), "+250781234567");
    assert.equal(normalizeRwandaPhoneNumber("(078) 123-4567"), "+250781234567");
});

test("rejects empty and unsupported phone numbers", function() {
    assert.equal(normalizeRwandaPhoneNumber(""), "");
    assert.equal(normalizeRwandaPhoneNumber("078123"), "");
    assert.equal(normalizeRwandaPhoneNumber("0250123456"), "");
    assert.equal(normalizeRwandaPhoneNumber("+254712345678"), "");
});

test("accepts one non-empty passenger name per seat up to 80 characters", function() {
    assert.equal(validatePassengerNames(["Amina"], 1), true);
    assert.equal(validatePassengerNames(["Amina One", "Amina Two"], 2), true);
    assert.equal(validatePassengerNames(["A".repeat(80)], 1), true);
});

test("rejects missing, blank, overlong, or mismatched passenger names", function() {
    assert.equal(validatePassengerNames([], 1), false);
    assert.equal(validatePassengerNames(["   "], 1), false);
    assert.equal(validatePassengerNames(["A".repeat(81)], 1), false);
    assert.equal(validatePassengerNames(["Amina"], 2), false);
    assert.equal(validatePassengerNames([null], 1), false);
    assert.equal(validatePassengerNames("Amina", 1), false);
});
