"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    validateCompanyApplication,
    isLicenceExpiring
} = require("../company-application-utils");

const validApplication = {
    companyName: "Akagera Coaches",
    representativeName: "Aline Uwase",
    officialEmail: "office@example.rw",
    contactPhone: "+250781234567",
    companyAddress: "Kigali",
    companyLocation: "Kigali",
    rdbRegistrationNumber: "RDB-123456",
    tin: "123456789",
    transportLicenseNumber: "RURA-2026-001",
    transportLicenseType: "Passenger transport",
    licenseIssueDate: "2025-01-01",
    licenseExpiryDate: "2027-01-01",
    allowedRoutesAreas: "Kigali - Huye"
};

test("accepts a complete application with an unexpired licence", function() {
    assert.equal(validateCompanyApplication(validApplication, "2026-06-01"), "");
});

test("requires a 9-digit TIN and a future licence expiry", function() {
    assert.match(validateCompanyApplication(
        Object.assign({}, validApplication, { tin: "12345" }),
        "2026-06-01"
    ), /TIN/);
    assert.match(validateCompanyApplication(
        Object.assign({}, validApplication, { licenseExpiryDate: "2026-06-01" }),
        "2026-06-01"
    ), /valid beyond today/);
});

test("rejects malformed, future-issued, and reversed licence dates", function() {
    assert.match(validateCompanyApplication(
        Object.assign({}, validApplication, { licenseIssueDate: "2025-02-30" }),
        "2026-06-01"
    ), /valid licence issue/);
    assert.match(validateCompanyApplication(
        Object.assign({}, validApplication, { licenseIssueDate: "2026-06-02" }),
        "2026-06-01"
    ), /future/);
    assert.match(validateCompanyApplication(
        Object.assign({}, validApplication, {
            licenseIssueDate: "2026-06-01",
            licenseExpiryDate: "2026-05-01"
        }),
        "2026-06-01"
    ), /valid beyond today/);
});

test("warns for expired licences and licences expiring within 30 days", function() {
    assert.equal(isLicenceExpiring("2026-06-29", "2026-06-01"), true);
    assert.equal(isLicenceExpiring("2026-05-31", "2026-06-01"), true);
    assert.equal(isLicenceExpiring("2026-07-02", "2026-06-01"), false);
    assert.equal(isLicenceExpiring("invalid", "2026-06-01"), false);
});
