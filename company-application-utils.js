(function(root) {
    "use strict";

    function parseDate(value) {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const parts = value.split("-").map(Number);
        const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        if (date.getUTCFullYear() !== parts[0] ||
            date.getUTCMonth() !== parts[1] - 1 ||
            date.getUTCDate() !== parts[2]) return null;
        return date;
    }

    function toUtcDate(value) {
        if (value instanceof Date) {
            return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
        }
        return parseDate(value);
    }

    function validateCompanyApplication(application, today) {
        const currentDate = toUtcDate(today || new Date());
        const issueDate = parseDate(application.licenseIssueDate);
        const expiryDate = parseDate(application.licenseExpiryDate);
        const required = [
            application.companyName,
            application.representativeName,
            application.officialEmail,
            application.contactPhone,
            application.companyAddress,
            application.companyLocation,
            application.rdbRegistrationNumber,
            application.tin,
            application.transportLicenseNumber,
            application.transportLicenseType,
            application.allowedRoutesAreas
        ];

        if (required.some(function(value) { return !String(value || "").trim(); })) {
            return "Complete every required company and licence field.";
        }
        if (!/^\d{9}$/.test(String(application.tin).trim())) {
            return "Enter the 9-digit Rwanda TIN.";
        }
        if (!issueDate || !expiryDate) {
            return "Enter valid licence issue and expiry dates.";
        }
        if (!currentDate || issueDate > currentDate) {
            return "The licence issue date cannot be in the future.";
        }
        if (expiryDate <= currentDate) {
            return "The transport licence must be valid beyond today.";
        }
        if (expiryDate < issueDate) {
            return "The licence expiry date cannot be before its issue date.";
        }
        return "";
    }

    function isLicenceExpiring(expiryValue, todayValue) {
        const expiry = parseDate(expiryValue);
        const today = toUtcDate(todayValue || new Date());
        if (!expiry || !today) return false;
        const days = Math.floor((expiry.getTime() - today.getTime()) / 86400000);
        return days <= 30;
    }

    const api = {
        parseDate: parseDate,
        validateCompanyApplication: validateCompanyApplication,
        isLicenceExpiring: isLicenceExpiring
    };

    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.WaylineCompanyApplicationUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
