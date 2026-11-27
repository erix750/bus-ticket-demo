let database;
let currentUser = null;
let isPartnerSignUp = false;
let editingBusId = null;
let buses = [];
let bookings = [];
let pendingBooking = null;
let busRefreshTimer;
const routeLocationCache = new Map();
let routeDistanceController = null;
let requestedDistanceRoute = "";
let routeDistanceInputKey = "";

const introReveal = document.getElementById("brandReveal");
const skipIntroButton = document.getElementById("skipIntro");

function hideIntro() {
    if (!introReveal || introReveal.classList.contains("is-hidden")) return;
    introReveal.classList.add("is-hidden");
    document.body.classList.remove("intro-active");
    window.setTimeout(function() {
        introReveal.remove();
    }, 420);
}

if (introReveal) {
    document.body.classList.add("intro-active");
    skipIntroButton?.addEventListener("click", hideIntro);
    const introDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1200 : 2000;
    window.setTimeout(hideIntro, introDuration);
}

const routeUtils = window.WaylineRouteUtils;
const companyApplicationUtils = window.WaylineCompanyApplicationUtils;
const ruraFarePerKm = routeUtils.ruraFarePerKm;
const calculateFare = routeUtils.calculateFare;
const bookingUtils = window.WaylineBookingUtils;
const validatePassengerNames = bookingUtils.validatePassengerNames;
const normalizeRwandaPhoneNumber = bookingUtils.normalizeRwandaPhoneNumber;
const commonCities = routeUtils.cities;

function normalizeBus(bus) {
    return {
        id: bus.id,
        companyId: bus.companyId,
        company: bus.company,
        name: bus.name,
        from: bus.from,
        to: bus.to,
        date: bus.date,
        departureTime: bus.departureTime,
        logo: bus.logo || "",
        totalSeats: Number(bus.totalSeats),
        availableSeats: Number(bus.availableSeats),
        fare: Number(bus.fare),
        routeDistanceKm: Number(bus.routeDistanceKm) || 0,
        estimatedDurationMinutes: Number(bus.estimatedDurationMinutes) || 0,
        intermediateStops: bus.intermediateStops || "",
        fareCategory: bus.fareCategory || "intercity",
        plateNumber: bus.plateNumber || "",
        insuranceExpiry: bus.insuranceExpiry || "",
        technicalInspectionExpiry: bus.technicalInspectionExpiry || "",
        licenseValidUntil: bus.licenseValidUntil || "",
        isWaylineVerified: bus.isWaylineVerified === true,
        isActive: bus.isActive !== false,
        isCancelled: bus.isCancelled === true
    };
}

const searchForm = document.getElementById("searchForm");
const heroSearchForm = document.getElementById("heroSearchForm");
const busForm = document.getElementById("busForm");
const searchMessage = document.getElementById("searchMessage");
const searchResults = document.getElementById("searchResults");
const busList = document.getElementById("busList");
const companyFilter = document.getElementById("companyFilter");
const passengerPhoneInput = document.getElementById("passengerPhone");
const managementPanel = document.getElementById("managementPanel");
const partnerLoginScreen = document.getElementById("partnerLoginScreen");
const companyPortalEntry = document.getElementById("companyPortalEntry");
const companyApplicationPanel = document.getElementById("companyApplicationPanel");
const siteFooter = document.getElementById("siteFooter");
const pageViews = Array.from(document.querySelectorAll("[data-page-view]"));
const loginMessage = document.getElementById("loginMessage");
const passwordRecoveryForm = document.getElementById("passwordRecoveryForm");
let activePage = "home";
let companyPortalStatus = null;
let applicationWizardStep = 2;
let passengerNames = [];
let companyMfaFactorId = null;
let companyMfaSetupFactorId = null;
let companyMfaResolver = null;

function showCompanyMfa(mode, message) {
    const dialog = document.getElementById("companyMfaDialog");
    document.getElementById("companyMfaEnrollPrompt").hidden = mode !== "enroll";
    document.getElementById("companyMfaEnrollSetup").hidden = mode !== "enroll-code";
    document.getElementById("companyMfaChallengeForm").hidden = mode !== "challenge";
    document.getElementById("companyMfaMessage").textContent = message || "";
    if (!dialog.open) dialog.showModal();
}

async function ensureCompanyMfa() {
    const assurance = await database.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error) throw new Error(assurance.error.message);
    if (assurance.data.currentLevel === "aal2") return true;

    const factors = await database.auth.mfa.listFactors();
    if (factors.error) throw new Error(factors.error.message);
    const verifiedFactor = factors.data.totp.find(function(factor) {
        return factor.status === "verified";
    });
    companyMfaFactorId = verifiedFactor ? verifiedFactor.id : null;

    return new Promise(function(resolve) {
        companyMfaResolver = resolve;
        if (companyMfaFactorId) {
            showCompanyMfa("challenge", "Company management requires an authenticator code.");
        } else {
            showCompanyMfa("enroll", "Set up an authenticator before managing company records.");
        }
    });
}

document.getElementById("beginCompanyMfaSetup").addEventListener("click", async function(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
        const result = await database.auth.mfa.enroll({
            factorType: "totp",
            friendlyName: "Wayline company portal"
        });
        if (result.error) throw new Error(result.error.message);
        companyMfaSetupFactorId = result.data.id;
        document.getElementById("companyMfaQrCode").src = result.data.totp.qr_code;
        document.getElementById("companyMfaSecret").textContent = result.data.totp.secret;
        showCompanyMfa("enroll-code", "Scan the authenticator QR code, then enter the current six-digit code.");
        document.getElementById("companyMfaEnrollCode").focus();
    } catch (error) {
        document.getElementById("companyMfaMessage").textContent =
            error.message || "Could not start authenticator setup.";
    } finally {
        button.disabled = false;
    }
});

async function verifyCompanyMfaCode(factorId, code) {
    const challenge = await database.auth.mfa.challenge({ factorId: factorId });
    if (challenge.error) throw new Error(challenge.error.message);
    const verification = await database.auth.mfa.verify({
        factorId: factorId,
        challengeId: challenge.data.id,
        code: code
    });
    if (verification.error) throw new Error(verification.error.message);
}

document.getElementById("companyMfaEnrollForm").addEventListener("submit", async function(event) {
    event.preventDefault();
    const code = document.getElementById("companyMfaEnrollCode").value.trim();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
        await verifyCompanyMfaCode(companyMfaSetupFactorId, code);
        companyMfaFactorId = companyMfaSetupFactorId;
        companyMfaSetupFactorId = null;
        const resolve = companyMfaResolver;
        companyMfaResolver = null;
        document.getElementById("companyMfaDialog").close();
        if (resolve) resolve(true);
    } catch (error) {
        document.getElementById("companyMfaMessage").textContent =
            error.message || "The authenticator code could not be verified.";
    } finally {
        submit.disabled = false;
    }
});

document.getElementById("companyMfaChallengeForm").addEventListener("submit", async function(event) {
    event.preventDefault();
    const code = document.getElementById("companyMfaChallengeCode").value.trim();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
        await verifyCompanyMfaCode(companyMfaFactorId, code);
        const resolve = companyMfaResolver;
        companyMfaResolver = null;
        document.getElementById("companyMfaDialog").close();
        if (resolve) resolve(true);
    } catch (error) {
        document.getElementById("companyMfaMessage").textContent =
            error.message || "The authenticator code could not be verified.";
    } finally {
        submit.disabled = false;
    }
});

document.getElementById("cancelCompanyMfa").addEventListener("click", async function() {
    try {
        await window.WaylineDatabase.signOut();
    } catch (error) {
        console.error("Could not sign out after company two-step verification was cancelled.", error);
    }
    const resolve = companyMfaResolver;
    companyMfaResolver = null;
    document.getElementById("companyMfaDialog").close();
    if (resolve) resolve(false);
});

let companyIdleTimer = 0;
const companyIdleTimeoutMs = 15 * 60 * 1000;

function resetCompanyIdleTimer() {
    window.clearTimeout(companyIdleTimer);
    if (!currentUser) return;
    companyIdleTimer = window.setTimeout(async function() {
        const logoutButton = document.getElementById("partnerLogout");
        try {
            await signOutCompany(logoutButton);
            loginMessage.textContent = "You were signed out after 15 minutes of inactivity.";
        } catch (error) {
            loginMessage.textContent = error.message || "Could not end the idle company session.";
        }
    }, companyIdleTimeoutMs);
}

["pointerdown", "keydown", "touchstart"].forEach(function(eventName) {
    document.addEventListener(eventName, resetCompanyIdleTimer, { passive: true });
});

function readPassengerNames() {
    try {
        const stored = JSON.parse(sessionStorage.getItem("wayline-passenger-names") || "[]");
        return Array.isArray(stored)
            ? stored.map(function(name) { return String(name).trim(); }).filter(Boolean)
            : [];
    } catch (error) {
        console.error("Could not read passenger names.", error);
        return [];
    }
}

passengerNames = readPassengerNames();

function formatPassengerNames(names) {
    return names.map(function(name, index) { return (index + 1) + ". " + name; }).join(" ");
}

function navigateToPage(page, updateHistory) {
    if (page === "booking" && !passengerNames.length) {
        window.location.href = "index.html?passengerNamesRequired=1#home";
        return;
    }
    const targetPage = pageViews.find(function(view) {
        return view.dataset.pageView === page;
    });
    if (!targetPage) return;

    activePage = page;
    pageViews.forEach(function(view) {
        const isActive = view === targetPage;
        view.hidden = !isActive;
        view.classList.toggle("is-active", isActive);
    });
    document.querySelectorAll(".header-page-nav [data-page-link]").forEach(function(link) {
        const isActive = link.dataset.pageLink === page;
        link.classList.toggle("is-active", isActive);
        if (isActive) {
            link.setAttribute("aria-current", "page");
        } else {
            link.removeAttribute("aria-current");
        }
    });
    siteFooter.hidden = false;
    siteFooter.classList.toggle("is-contact", page === "contact");

    if (updateHistory !== false && window.location.hash !== "#" + page) {
        window.history.pushState(null, "", "#" + page);
    }
}

document.querySelectorAll("[data-page-link]").forEach(function(link) {
    link.addEventListener("click", function(event) {
        event.preventDefault();
        navigateToPage(link.dataset.pageLink);
    });
});

window.addEventListener("hashchange", function() {
    const page = window.location.hash.slice(1);
    if (pageViews.some(function(view) { return view.dataset.pageView === page; })) {
        navigateToPage(page, false);
    }
});

const initialPage = window.location.hash.slice(1);
if (pageViews.some(function(view) { return view.dataset.pageView === initialPage; })) {
    navigateToPage(initialPage, false);
}

if (initialPage === "booking" && !passengerNames.length) {
    window.history.replaceState(null, "", "?passengerNamesRequired=1#home");
}
if (new URLSearchParams(window.location.search).get("passengerNamesRequired") === "1") {
    window.requestAnimationFrame(function() {
        const heroForm = document.getElementById("heroSearchForm");
        if (!heroForm.querySelector(".hero-search-message")) {
            const message = document.createElement("p");
            message.className = "form-message hero-search-message";
            message.textContent = "Enter passenger names to continue.";
            message.setAttribute("role", "alert");
            heroForm.prepend(message);
        }
    });
}

function showPasswordRecoveryForm() {
    document.getElementById("partnerLoginForm").hidden = true;
    passwordRecoveryForm.hidden = false;
    document.getElementById("passwordRecoveryMessage").textContent = "";
    if (!partnerLoginScreen.open) partnerLoginScreen.showModal();
    document.getElementById("newPartnerPassword").focus();
}

function showPartnerLoginForm() {
    passwordRecoveryForm.hidden = true;
    document.getElementById("partnerLoginForm").hidden = false;
    document.getElementById("passwordRecoveryForm").reset();
}

function setPartnerPreview(active) {
    const signedIn = active && Boolean(currentUser);
    const isApproved = signedIn && companyPortalStatus &&
        companyPortalStatus.approval_status === "approved";
    const needsLicenceAttention = isApproved && (
        !companyPortalStatus.wayline_verified ||
        Number(companyPortalStatus.license_days_remaining) <= 30
    );
    managementPanel.hidden = !isApproved;
    const canRenewLicence = companyPortalStatus &&
        ["owner", "manager"].includes(companyPortalStatus.company_role);
    companyApplicationPanel.hidden = !signedIn ||
        (isApproved && (!needsLicenceAttention || !canRenewLicence));
    companyPortalEntry.hidden = signedIn;
    document.getElementById("partnerLogout").hidden = !isApproved;
    document.getElementById("applicationLogout").hidden = !signedIn || isApproved;
    const companyName = isApproved
        ? companyPortalStatus.company_name || currentUser.email
        : "Company application";
    document.getElementById("dashboardCompanyName").textContent = companyName;
    document.getElementById("dashboardWelcome").textContent = isApproved
        ? "Welcome back, " + companyName
        : "Welcome back";
    if (signedIn) {
        navigateToPage("company");
        if (partnerLoginScreen.open) partnerLoginScreen.close();
    }
}

function renderCompanyPortalStatus(status) {
    companyPortalStatus = status;
    document.getElementById("companyStaffManagement").hidden = status.company_role !== "owner";
    const canManageCompany = ["owner", "manager"].includes(status.company_role);
    document.getElementById("companyProfileForm").hidden = !canManageCompany;
    const ebmApproved = status.ebm_status === "approved";
    document.getElementById("busForm").hidden = !canManageCompany || !ebmApproved;
    document.getElementById("dashboardSchedules").hidden = !ebmApproved;
    document.getElementById("dashboardBookings").hidden = !ebmApproved;
    document.getElementById("companyEbmNavItem").hidden =
        !canManageCompany || !status.submitted_at || !status.ebm_mfa_verified;
    document.getElementById("dashboardEbm").hidden =
        !canManageCompany || !status.submitted_at || !status.ebm_mfa_verified;
    const applicationStatus = status.application_status || status.approval_status;
    const submitted = Boolean(status.submitted_at);
    const statusLabels = {
        pending: submitted ? "Pending" : "Not submitted",
        under_review: "Under Review",
        approved: "Approved",
        rejected: "Rejected",
        suspended: "Suspended"
    };
    const messages = {
        pending: submitted
            ? "Your application is pending review. Schedules and bookings stay locked until Wayline approves your company and EBM information."
            : "Complete each company application step and submit all required documents for review.",
        under_review: "Your application is being checked by Wayline. If we requested more information or documents, use the form below to send an update; it will return to the pending queue for review.",
        rejected: "Your application was not accepted. Review the administrator's note, correct the information or documents, and submit an updated application.",
        suspended: "Access to your company account has been restricted. Contact Wayline support if you need more information."
    };
    const statusElement = document.getElementById("companyApplicationStatus");
    statusElement.textContent = statusLabels[applicationStatus] || "Not submitted";
    statusElement.dataset.status = applicationStatus || "pending";
    document.getElementById("companyApplicationMessage").textContent =
        messages[applicationStatus] || messages.pending;

    const reviewNotes = document.getElementById("companyApplicationReviewNotes");
    reviewNotes.textContent = status.review_notes || "";
    reviewNotes.hidden = !status.review_notes;

    document.getElementById("applicationCompanyName").value = status.company_name || "";
    document.getElementById("applicationRepresentativeName").value = status.representative_name || "";
    document.getElementById("applicationOfficialEmail").value =
        status.official_email || (currentUser && currentUser.email) || "";
    document.getElementById("applicationContactPhone").value = status.contact_phone || "";
    document.getElementById("applicationCompanyAddress").value = status.company_address || "";
    document.getElementById("applicationCompanyLocation").value = status.company_location || "";
    document.getElementById("applicationBusinessRegistration").value = status.business_registration || "";
    document.getElementById("applicationTin").value = status.tin || "";
    document.getElementById("applicationTransportLicenseNumber").value = status.transport_license_number || "";
    document.getElementById("applicationTransportLicenseType").value = status.transport_license_type || "";
    document.getElementById("applicationLicenseIssueDate").value = status.transport_license_issue_date || "";
    document.getElementById("applicationLicenseExpiryDate").value = status.transport_license_expiry_date || "";
    document.getElementById("applicationAllowedRoutes").value = status.allowed_routes_areas || "";
    document.getElementById("applicationEbmTinPreview").textContent =
        status.tin || "Enter the TIN in Step 3";
    document.getElementById("applicationVatRegistered").value =
        status.vat_registered === null || status.vat_registered === undefined
            ? ""
            : String(status.vat_registered);
    document.getElementById("applicationTicketTaxCategory").value = status.ticket_tax_category || "";
    document.getElementById("applicationEbmDeviceIdentifier").value = status.ebm_device_identifier || "";
    document.getElementById("applicationRraBusinessName").value =
        status.rra_registered_business_name || "";
    document.getElementById("applicationEbmOwnerConfirmation").checked =
        Boolean(status.ebm_owner_confirmed_at);
    document.getElementById("applicationEbmCertificate").required =
        !status.ebm_registration_certificate_path;
    document.getElementById("applicationEbmCertificateStatus").textContent =
        status.ebm_registration_certificate_path
            ? "Certificate uploaded. Choose a new file to replace it."
            : "PDF, JPG, PNG, or WebP up to 10 MB. Upload your company's certificate from RRA.";

    const ebmStatusLabels = {
        not_submitted: "Not submitted",
        pending: "Pending review",
        approved: "Approved",
        rejected: "Rejected"
    };
    const ebmStatusElement = document.getElementById("companyEbmStatus");
    ebmStatusElement.textContent = ebmStatusLabels[status.ebm_status] || "Not submitted";
    ebmStatusElement.dataset.status = status.ebm_status || "not_submitted";
    document.getElementById("companyEbmTin").textContent = status.tin || "Not provided";
    document.getElementById("companyEbmVatStatus").textContent =
        status.vat_registered === true ? "VAT registered" :
            status.vat_registered === false ? "Not VAT registered" : "Not provided";
    document.getElementById("companyEbmTaxCategory").textContent =
        status.ticket_tax_category || "Not provided";
    document.getElementById("companyEbmDevice").textContent =
        status.ebm_device_identifier || "Not provided";
    document.getElementById("companyEbmBusinessName").textContent =
        status.rra_registered_business_name || "Not provided";
    document.getElementById("companyEbmCertificateStatus").textContent =
        status.ebm_registration_certificate_path ? "Uploaded to private storage" : "Not uploaded";
    document.getElementById("companyEbmCredentialsStatus").textContent =
        status.ebm_credentials_configured ? "Saved securely (masked)" : "Not provided";
    const ebmReviewNote = document.getElementById("companyEbmReviewNote");
    ebmReviewNote.textContent = status.ebm_status === "rejected"
        ? status.ebm_review_notes || "Wayline requested an update to your RRA/EBM information."
        : "";
    ebmReviewNote.hidden = !ebmReviewNote.textContent;

    document.getElementById("applicationReviewSummary").textContent =
        "Company: " + (status.company_name || "Not provided") +
        " · RDB: " + (status.rdb_registration_number || "Not provided") +
        " · TIN: " + (status.tin || "Not provided") +
        " · RRA/EBM: " + (ebmStatusLabels[status.ebm_status] || "Not submitted") +
        " · Certificate: " + (status.ebm_registration_certificate_path ? "uploaded" : "missing");
    if (!submitted || applicationStatus === "rejected" || applicationStatus === "under_review") {
        setApplicationWizardStep(Math.max(2, Math.min(5, Number(status.application_draft_step) || 2)));
    }

    const licenseWarning = document.getElementById("licenseExpiryWarning");
    const daysRemaining = Number(status.license_days_remaining);
    const licenceValid = status.wayline_verified === true;
    licenseWarning.hidden = status.approval_status !== "approved" ||
        (licenceValid && daysRemaining > 30);
    if (status.approval_status === "approved" && !licenceValid) {
        licenseWarning.textContent = "Your company licence is expired or awaiting manual verification. Selling schedules and publishing trips are blocked until verification is complete.";
    } else if (status.approval_status === "approved" && daysRemaining <= 30) {
        licenseWarning.textContent = "Your transport licence expires in " + Math.max(0, daysRemaining) +
            " days. Submit updated licence documents before it expires.";
    } else {
        licenseWarning.textContent = "";
    }

    const applicationForm = document.getElementById("companyApplicationForm");
    const renewalRequired = status.approval_status === "approved" &&
        (!licenceValid || daysRemaining <= 30);
    const canSubmit = applicationStatus !== "suspended" &&
        !status.ebm_reapproval_required &&
        ((!submitted && status.approval_status !== "approved") ||
            applicationStatus === "rejected" ||
            (applicationStatus === "under_review" && status.ebm_status !== "pending") ||
            (renewalRequired && applicationStatus !== "under_review"));
    applicationForm.hidden = !canSubmit;
    document.getElementById("submitCompanyApplication").textContent =
        renewalRequired
            ? "Submit licence renewal"
            : applicationStatus === "under_review"
            ? "Send requested information"
            : applicationStatus === "rejected" || submitted
                ? "Update and resubmit application"
                : "Submit for verification";
}

function setApplicationWizardStep(step) {
    applicationWizardStep = Math.max(2, Math.min(5, Number(step) || 2));
    document.querySelectorAll("[data-application-step]").forEach(function(panel) {
        panel.hidden = Number(panel.dataset.applicationStep) !== applicationWizardStep;
    });
    document.querySelectorAll("[data-progress-step]").forEach(function(item) {
        const itemStep = Number(item.dataset.progressStep);
        item.classList.toggle("is-complete", itemStep < applicationWizardStep);
        item.classList.toggle("is-current", itemStep === applicationWizardStep);
        if (itemStep === applicationWizardStep) item.setAttribute("aria-current", "step");
        else item.removeAttribute("aria-current");
    });
    const activeStep = document.querySelector('[data-application-step="' + applicationWizardStep + '"]');
    const heading = activeStep && activeStep.querySelector("h4");
    if (heading) heading.focus({ preventScroll: true });
}

function getCompanyApplicationValues() {
    const vatValue = document.getElementById("applicationVatRegistered").value;
    return {
        companyName: document.getElementById("applicationCompanyName").value.trim(),
        representativeName: document.getElementById("applicationRepresentativeName").value.trim(),
        officialEmail: document.getElementById("applicationOfficialEmail").value.trim(),
        contactPhone: document.getElementById("applicationContactPhone").value.trim(),
        companyAddress: document.getElementById("applicationCompanyAddress").value.trim(),
        companyLocation: document.getElementById("applicationCompanyLocation").value.trim(),
        rdbRegistrationNumber: document.getElementById("applicationBusinessRegistration").value.trim(),
        tin: document.getElementById("applicationTin").value.trim(),
        transportLicenseNumber: document.getElementById("applicationTransportLicenseNumber").value.trim(),
        transportLicenseType: document.getElementById("applicationTransportLicenseType").value,
        licenseIssueDate: document.getElementById("applicationLicenseIssueDate").value,
        licenseExpiryDate: document.getElementById("applicationLicenseExpiryDate").value,
        allowedRoutesAreas: document.getElementById("applicationAllowedRoutes").value.trim(),
        vatRegistered: vatValue === "" ? null : vatValue === "true",
        ticketTaxCategory: document.getElementById("applicationTicketTaxCategory").value.trim(),
        ebmDeviceIdentifier: document.getElementById("applicationEbmDeviceIdentifier").value.trim(),
        rraRegisteredBusinessName: document.getElementById("applicationRraBusinessName").value.trim(),
        ebmRegistrationCertificatePath: companyPortalStatus
            ? companyPortalStatus.ebm_registration_certificate_path || ""
            : "",
        ebmCertificate: document.getElementById("applicationEbmCertificate").files[0] || null,
        ebmOwnerConfirmation: document.getElementById("applicationEbmOwnerConfirmation").checked,
        ebmCredentials: document.getElementById("applicationEbmCredentials").value,
        certificatePath: companyPortalStatus
            ? companyPortalStatus.ebm_registration_certificate_path || ""
            : "",
        certificate: document.getElementById("applicationEbmCertificate").files[0] || null,
        ownerConfirmation: document.getElementById("applicationEbmOwnerConfirmation").checked,
        credentials: document.getElementById("applicationEbmCredentials").value,
        renewal: Boolean(companyPortalStatus && companyPortalStatus.approval_status === "approved")
    };
}

async function saveAndContinueCompanyApplication(nextStep) {
    const application = getCompanyApplicationValues();
    const activePanel = document.querySelector('[data-application-step="' + applicationWizardStep + '"]');
    const invalidField = activePanel && activePanel.querySelector(":invalid");
    if (invalidField) {
        invalidField.reportValidity();
        invalidField.focus();
        return;
    }
    if (applicationWizardStep === 3) {
        const validationError = companyApplicationUtils.validateCompanyApplication(application, new Date());
        if (validationError) {
            document.getElementById("companyApplicationFormMessage").textContent = validationError;
            return;
        }
    }
    if (applicationWizardStep === 4) {
        const validationError = companyApplicationUtils.validateCompanyEbmInformation(application);
        if (validationError) {
            document.getElementById("companyApplicationFormMessage").textContent = validationError;
            return;
        }
    }

    const message = document.getElementById("companyApplicationFormMessage");
    const button = activePanel.querySelector('[data-application-next="' + nextStep + '"]');
    message.textContent = "";
    button.disabled = true;
    try {
        const draft = await window.WaylineDatabase.saveCompanyApplicationDraft(application, nextStep);
        companyPortalStatus = Object.assign({}, companyPortalStatus, draft);
        if (application.ebmCredentials) {
            document.getElementById("applicationEbmCredentials").value = "";
        }
        renderCompanyPortalStatus(companyPortalStatus);
        setApplicationWizardStep(nextStep);
    } catch (error) {
        message.textContent = error.message || "Could not save your application progress.";
    } finally {
        button.disabled = false;
    }
}

async function loadCompanyPortalStatus() {
    const status = await window.WaylineDatabase.getCompanyPortalStatus();
    renderCompanyPortalStatus(status);
    return status;
}

function setCompanyProfilePicture(logo) {
    const image = document.getElementById("companyProfilePicture");
    const placeholder = document.getElementById("companyProfilePicturePlaceholder");
    image.hidden = !logo;
    placeholder.hidden = Boolean(logo);
    if (logo) image.src = logo;
    else image.removeAttribute("src");
}

function setPartnerFormMode(signUp) {
    isPartnerSignUp = signUp;
    document.getElementById("partnerFormTitle").textContent = signUp
        ? "Step 1: create your company account"
        : "Company sign in";
    document.getElementById("partnerFormIntro").textContent = signUp
        ? "Enter your email and password. Confirm your email before continuing to company details."
        : "Access your company schedules and bookings.";
    document.getElementById("partnerSubmitButton").textContent = signUp
        ? "Create account"
        : "Sign in";
    document.getElementById("togglePartnerMode").textContent = signUp
        ? "Already have an account? Sign in"
        : "Create a company account";
    document.getElementById("partnerPassword").autocomplete = signUp ? "new-password" : "current-password";
    document.getElementById("partnerPassword").minLength = signUp ? 12 : 0;
    document.getElementById("partnerPassword").placeholder = signUp
        ? "At least 12 characters with upper/lowercase, number and symbol"
        : "Enter your password";
    loginMessage.textContent = "";
}

const partnerEmailInput = document.getElementById("partnerEmail");
partnerEmailInput.addEventListener("input", function() {
    this.setCustomValidity("");
});
partnerEmailInput.addEventListener("invalid", function() {
    if (!isPartnerSignUp) {
        this.setCustomValidity("");
        return;
    }
    this.setCustomValidity(this.validity.valueMissing
        ? "Enter an email address you can access."
        : "This email address is not available. Enter a valid address you can access.");
});

async function refreshAppData() {
    buses = (await window.WaylineDatabase.loadBuses()).map(normalizeBus);
    bookings = await window.WaylineDatabase.loadBookings();
    updateCitySuggestions();
    updateCompanyOptions();
    updatePopularRoutes();
    renderHomeTrustCues();
    renderBookings();
    renderBuses();
}

let isRefreshingAvailability = false;

async function refreshBusAvailability(showSuccess) {
    if (isRefreshingAvailability) return;
    isRefreshingAvailability = true;
    const refreshButton = document.getElementById("refreshAvailability");
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";

    try {
        buses = (await window.WaylineDatabase.loadBuses()).map(normalizeBus);
        updateCitySuggestions();
        updateCompanyOptions();
        updatePopularRoutes();
        renderHomeTrustCues();
        renderBuses();
        if (document.getElementById("date").value) performSearch();
        if (showSuccess) {
            document.getElementById("availabilityStatus").textContent =
                "Seat availability updated just now.";
        }
    } catch (error) {
        console.error("Could not refresh bus availability.", error);
        document.getElementById("availabilityStatus").textContent =
            "Could not refresh seats. Check your connection and try again.";
    } finally {
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh seats";
        isRefreshingAvailability = false;
    }
}

document.getElementById("refreshAvailability").addEventListener("click", function() {
    refreshBusAvailability(true);
});

document.getElementById("popularRoutes").addEventListener("click", function(event) {
    const button = event.target.closest(".route-chip");
    if (!button) return;
    const from = button.dataset.from;
    const to = button.dataset.to;
    document.getElementById("from").value = from;
    document.getElementById("to").value = to;

    const routeCompanies = Array.from(new Set(buses.filter(function(bus) {
        return bus.isActive && !bus.isCancelled && bus.availableSeats > 0 &&
            bus.routeDistanceKm > 0 && isTripUpcoming(bus) &&
            routeUtils.normalizeCity(bus.from) === routeUtils.normalizeCity(from) &&
            routeUtils.normalizeCity(bus.to) === routeUtils.normalizeCity(to);
    }).map(function(bus) { return bus.company; })));
    companyFilter.value = routeCompanies.length === 1 ? routeCompanies[0] : "";
    document.getElementById("searchResults").replaceChildren();
    searchMessage.textContent = routeCompanies.length
        ? "Route selected. Choose your travel date and passenger details, then search."
        : "Route selected. Choose your travel date and search all available companies.";
    document.getElementById("date").focus();
});

function openCompanySignIn(signUp) {
    loginMessage.textContent = "";
    showPartnerLoginForm();
    setPartnerFormMode(signUp);
    partnerLoginScreen.showModal();
}

document.getElementById("companyPortalSignIn").addEventListener("click", function() {
    openCompanySignIn(false);
});

document.getElementById("companyPortalRegister").addEventListener("click", function() {
    openCompanySignIn(true);
});

document.getElementById("closePartnerLogin").addEventListener("click", function() {
    partnerLoginScreen.close();
});

async function sendPasswordResetLink(button) {
    const emailInput = document.getElementById("partnerEmail");
    const email = emailInput.value.trim();
    if (!email) {
        loginMessage.textContent = "Enter your account email address first.";
        emailInput.focus();
        return;
    }
    if (!emailInput.validity.valid) {
        emailInput.reportValidity();
        return;
    }

    button.disabled = true;
    loginMessage.textContent = "";
    try {
        await window.WaylineDatabase.sendPasswordRecovery(email);
        loginMessage.textContent = "If an account exists for that email, a password reset link has been sent.";
    } catch (error) {
        loginMessage.textContent = error.message || "Could not send a password reset email. Please try again.";
    } finally {
        button.disabled = false;
    }
}

document.getElementById("forgotPassword").addEventListener("click", function() {
    sendPasswordResetLink(this);
});

document.getElementById("resendPasswordReset").addEventListener("click", function() {
    sendPasswordResetLink(this);
});

passwordRecoveryForm.addEventListener("submit", async function(event) {
    event.preventDefault();
    const password = document.getElementById("newPartnerPassword").value;
    const confirmation = document.getElementById("confirmPartnerPassword").value;
    const message = document.getElementById("passwordRecoveryMessage");
    const passwordError = window.WaylineDatabase.getPasswordValidationError(password);
    if (passwordError) {
        message.textContent = passwordError;
        document.getElementById("newPartnerPassword").focus();
        return;
    }
    if (password !== confirmation) {
        message.textContent = "The passwords do not match.";
        document.getElementById("confirmPartnerPassword").focus();
        return;
    }

    const submitButton = document.getElementById("saveNewPassword");
    submitButton.disabled = true;
    message.textContent = "";
    try {
        await window.WaylineDatabase.updatePassword(password);
        await database.auth.signOut();
        showPartnerLoginForm();
        setPartnerFormMode(false);
        loginMessage.textContent = "Password updated. Sign in with your new password.";
    } catch (error) {
        message.textContent = error.message || "Could not update your password. Request a new reset link and try again.";
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById("backToSignIn").addEventListener("click", function() {
    showPartnerLoginForm();
    setPartnerFormMode(false);
});

document.getElementById("partnerLoginForm").addEventListener("submit", async function(event) {
    event.preventDefault();
    const submitButton = document.getElementById("partnerSubmitButton");
    submitButton.disabled = true;
    loginMessage.textContent = "";
    try {
        const email = document.getElementById("partnerEmail").value.trim();
        const password = document.getElementById("partnerPassword").value;
        if (isPartnerSignUp) {
            if (!window.WaylineDatabase.isValidEmail(email)) {
                loginMessage.textContent = "Enter a valid company email address with a working inbox.";
                document.getElementById("partnerEmail").focus();
                return;
            }
            const passwordError = window.WaylineDatabase.getPasswordValidationError(password);
            if (passwordError) {
                loginMessage.textContent = passwordError;
                document.getElementById("partnerPassword").focus();
                return;
            }
            const result = await window.WaylineDatabase.signUp(email, password);
            if (!result.session) {
                loginMessage.textContent = "Check your inbox and confirm your email before signing in. If you can't receive the link, this email isn't available—check the address and try again.";
                return;
            }
            currentUser = result.user;
            setCompanyProfilePicture("");
            await loadCompanyPortalStatus();
            await refreshAppData();
            resetCompanyIdleTimer();
            setPartnerPreview(true);
            return;
        }

        const result = await window.WaylineDatabase.signIn(email, password);
        currentUser = result.user;
        const profile = await window.WaylineDatabase.getCompanyProfile(currentUser.id);
        if (!profile) {
            const isAdmin = await window.WaylineDatabase.isWaylineAdmin();
            currentUser = null;
            setCompanyProfilePicture("");
            setPartnerPreview(false);
            loginMessage.textContent = isAdmin
                ? "Administrator accounts use the protected admin portal at admin.html."
                : "This account does not have a company profile. Register a company account or contact Wayline support.";
            return;
        }
        document.getElementById("company").value = profile.name;
        setCompanyProfilePicture(profile.logo_data);
        await loadCompanyPortalStatus();
        const requiresCompanyMfa = companyPortalStatus.approval_status === "approved" ||
            (companyPortalStatus.submitted_at &&
                ["owner", "manager"].includes(companyPortalStatus.company_role));
        if (requiresCompanyMfa && !(await ensureCompanyMfa())) {
            currentUser = null;
            companyPortalStatus = null;
            setCompanyProfilePicture("");
            setPartnerPreview(false);
            loginMessage.textContent = "Two-step verification is required to manage company records.";
            return;
        }
        if (requiresCompanyMfa) await loadCompanyPortalStatus();
        await refreshAppData();
        resetCompanyIdleTimer();
        setPartnerPreview(true);
    } catch (error) {
        const signUpEmailUnavailable = isPartnerSignUp &&
            /invalid email|email.*invalid|already registered|user already exists|email.*already|already.*email/i.test(error.message || "");
        const invalidSignIn = !isPartnerSignUp &&
            /invalid login credentials|email not confirmed/i.test(error.message || "");
        loginMessage.textContent = signUpEmailUnavailable
            ? "Email not available. Check the address or use an email account you can access."
            : invalidSignIn
                ? "Sign-in failed. Only registered company accounts can sign in. Check your email and password; if you just signed up, verify your email first."
                : error.message || "Could not complete company account sign-in.";
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById("companyProfileForm").addEventListener("submit", async function(event) {
    event.preventDefault();
    const input = document.getElementById("companyProfilePictureFile");
    const file = input.files[0];
    const message = document.getElementById("companyProfileMessage");
    const submitButton = document.getElementById("saveCompanyProfilePicture");
    message.textContent = "";

    if (!currentUser) {
        message.textContent = "Sign in with your company account before updating your profile picture.";
        return;
    }
    if (!file) {
        message.textContent = "Choose a picture to upload.";
        input.focus();
        return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        message.textContent = "Choose a PNG, JPG, or WebP image.";
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        message.textContent = "The company picture must be 10 MB or smaller.";
        return;
    }

    submitButton.disabled = true;
    try {
        const logo = await resizeCompanyLogo(file);
        await window.WaylineDatabase.updateCompanyProfilePicture(logo);
        setCompanyProfilePicture(logo);
        input.value = "";
        message.textContent = "Profile picture saved.";
        try {
            await refreshAppData();
        } catch (error) {
            console.error("Profile picture was saved, but bus listings could not refresh.", error);
            message.textContent = "Profile picture saved, but bus listings could not refresh. Reload the page to see it everywhere.";
        }
    } catch (error) {
        message.textContent = error.message || "Could not save the profile picture. Please try again.";
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById("togglePartnerMode").addEventListener("click", function() {
    setPartnerFormMode(!isPartnerSignUp);
});

document.querySelectorAll("[data-application-next]").forEach(function(button) {
    button.addEventListener("click", function() {
        saveAndContinueCompanyApplication(Number(button.dataset.applicationNext));
    });
});

document.querySelectorAll("[data-application-previous]").forEach(function(button) {
    button.addEventListener("click", function() {
        setApplicationWizardStep(Number(button.dataset.applicationPrevious));
    });
});

document.getElementById("companyApplicationForm").addEventListener("submit", async function(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (applicationWizardStep !== 5) {
        await saveAndContinueCompanyApplication(applicationWizardStep + 1);
        return;
    }
    const businessDocument = document.getElementById("applicationBusinessDocument").files[0];
    const transportLicense = document.getElementById("applicationTransportLicense").files[0];
    const representativeIdDocument = document.getElementById("applicationRepresentativeIdDocument").files[0];
    const message = document.getElementById("companyApplicationFormMessage");
    const button = document.getElementById("submitCompanyApplication");
    const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    const application = getCompanyApplicationValues();
    application.businessDocument = businessDocument;
    application.transportLicense = transportLicense;
    application.representativeIdDocument = representativeIdDocument;
    const documents = [businessDocument, transportLicense, representativeIdDocument];

    message.textContent = "";
    if (!currentUser) {
        message.textContent = "Sign in with your company account before submitting an application.";
        return;
    }
    if (documents.some(function(file) {
        return !file || !allowedTypes.includes(file.type) || file.size > 10 * 1024 * 1024;
    })) {
        message.textContent = "Choose PDF, JPG, PNG, or WebP documents up to 10 MB each.";
        return;
    }
    const validationError = companyApplicationUtils.validateCompanyApplication(
        application,
        new Date()
    );
    if (validationError) {
        message.textContent = validationError;
        return;
    }
    const ebmValidationError = companyApplicationUtils.validateCompanyEbmInformation(application);
    if (ebmValidationError) {
        message.textContent = ebmValidationError;
        return;
    }
    const invalidField = form.querySelector('[data-application-step="5"] :invalid');
    if (invalidField) {
        invalidField.reportValidity();
        invalidField.focus();
        return;
    }

    button.disabled = true;
    button.textContent = "Submitting for review...";
    try {
        const status = await window.WaylineDatabase.submitCompanyApplication(application);
        form.reset();
        renderCompanyPortalStatus(status);
        message.textContent = application.renewal
            ? "Your updated licence documents are pending review. Schedule sales stay blocked until Wayline approves the updated information."
            : "Your application is pending review. Schedules and bookings stay locked until Wayline approves your company and EBM information.";
    } catch (error) {
        message.textContent = error.message || "Could not submit the company application. Please try again.";
    } finally {
        button.disabled = false;
        const appStatus = companyPortalStatus && companyPortalStatus.application_status;
        button.textContent = companyPortalStatus && companyPortalStatus.approval_status === "approved"
            ? "Submit licence renewal"
            : appStatus === "under_review"
            ? "Send requested information"
            : appStatus === "rejected" || (companyPortalStatus && companyPortalStatus.submitted_at)
                ? "Update and resubmit application"
                : "Submit for verification";
    }
});

async function signOutCompany(button) {
    button.disabled = true;
    try {
        if (currentUser) await window.WaylineDatabase.signOut();
        currentUser = null;
        companyPortalStatus = null;
        window.clearTimeout(companyIdleTimer);
        setCompanyProfilePicture("");
        await refreshAppData();
        setPartnerPreview(false);
    } catch (error) {
        loginMessage.textContent = error.message || "Could not sign out.";
    } finally {
        button.disabled = false;
    }
}

document.getElementById("partnerLogout").addEventListener("click", function() {
    signOutCompany(this);
});

document.getElementById("applicationLogout").addEventListener("click", function() {
    signOutCompany(this);
});

document.getElementById("companyApplicationForm").addEventListener("input", function() {
    document.getElementById("companyApplicationFormMessage").textContent = "";
    document.getElementById("applicationEbmTinPreview").textContent =
        document.getElementById("applicationTin").value.trim() || "Enter the TIN in Step 3";
});

document.getElementById("applicationEbmCertificate").addEventListener("change", function() {
    this.required = !this.files.length &&
        !(companyPortalStatus && companyPortalStatus.ebm_registration_certificate_path);
});

document.getElementById("companyApplicationForm").addEventListener("input", function() {
    document.getElementById("companyApplicationFormMessage").textContent = "";
});

document.getElementById("requestEbmChange").addEventListener("click", function() {
    const form = document.getElementById("companyEbmChangeForm");
    form.hidden = false;
    document.getElementById("companyEbmChangeTin").value = companyPortalStatus.tin || "";
    document.getElementById("companyEbmChangeVatRegistered").value =
        companyPortalStatus.vat_registered === null || companyPortalStatus.vat_registered === undefined
            ? ""
            : String(companyPortalStatus.vat_registered);
    document.getElementById("companyEbmChangeTaxCategory").value =
        companyPortalStatus.ticket_tax_category || "";
    document.getElementById("companyEbmChangeDevice").value =
        companyPortalStatus.ebm_device_identifier || "";
    document.getElementById("companyEbmChangeBusinessName").value =
        companyPortalStatus.rra_registered_business_name || "";
    document.getElementById("companyEbmChangeCertificate").required =
        !companyPortalStatus.ebm_registration_certificate_path;
    document.getElementById("companyEbmChangeConfirmation").checked = false;
    document.getElementById("companyEbmChangeCredentials").value = "";
    document.getElementById("companyEbmChangeMessage").textContent = "";
});

document.getElementById("cancelCompanyEbmChange").addEventListener("click", function() {
    document.getElementById("companyEbmChangeForm").hidden = true;
});

document.getElementById("companyEbmChangeCertificate").addEventListener("change", function() {
    this.required = !this.files.length &&
        !(companyPortalStatus && companyPortalStatus.ebm_registration_certificate_path);
});

document.getElementById("companyEbmChangeForm").addEventListener("submit", async function(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById("companyEbmChangeMessage");
    const button = document.getElementById("saveCompanyEbmChange");
    const certificate = document.getElementById("companyEbmChangeCertificate").files[0] || null;
    const vatValue = document.getElementById("companyEbmChangeVatRegistered").value;
    const application = {
        tin: document.getElementById("companyEbmChangeTin").value.trim(),
        vatRegistered: vatValue === "" ? null : vatValue === "true",
        ticketTaxCategory: document.getElementById("companyEbmChangeTaxCategory").value.trim(),
        ebmDeviceIdentifier: document.getElementById("companyEbmChangeDevice").value.trim(),
        rraRegisteredBusinessName: document.getElementById("companyEbmChangeBusinessName").value.trim(),
        ebmRegistrationCertificatePath: companyPortalStatus.ebm_registration_certificate_path || "",
        ebmCertificate: certificate,
        ebmOwnerConfirmation: document.getElementById("companyEbmChangeConfirmation").checked,
        ebmCredentials: document.getElementById("companyEbmChangeCredentials").value
    };
    application.certificatePath = application.ebmRegistrationCertificatePath;
    application.certificate = certificate;
    application.ownerConfirmation = application.ebmOwnerConfirmation;
    application.credentials = application.ebmCredentials;
    const invalidField = form.querySelector(":invalid");
    if (invalidField) {
        invalidField.reportValidity();
        invalidField.focus();
        return;
    }
    const validationError = companyApplicationUtils.validateCompanyEbmInformation(application);
    if (validationError) {
        message.textContent = validationError;
        return;
    }
    button.disabled = true;
    message.textContent = "";
    try {
        await window.WaylineDatabase.submitCompanyEbmInformation(application);
        await loadCompanyPortalStatus();
        form.hidden = true;
        message.textContent = "Your RRA / EBM information is pending Wayline review. Ticket sales are blocked until it is approved.";
    } catch (error) {
        message.textContent = error.message || "Could not submit your RRA / EBM update.";
    } finally {
        button.disabled = false;
    }
});

document.getElementById("companyStaffForm").addEventListener("submit", async function(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.getElementById("assignCompanyStaff");
    const message = document.getElementById("companyStaffMessage");
    button.disabled = true;
    message.textContent = "";
    try {
        await window.WaylineDatabase.setCompanyStaffRole(
            document.getElementById("companyStaffEmail").value.trim(),
            document.getElementById("companyStaffRole").value
        );
        form.reset();
        message.textContent = "The staff role was saved.";
    } catch (error) {
        message.textContent = error.message || "Could not assign the staff role.";
    } finally {
        button.disabled = false;
    }
});

async function initializeApp() {
    database = await window.WaylineDatabase.open();
    database.auth.onAuthStateChange(function(event) {
        if (event === "PASSWORD_RECOVERY") showPasswordRecoveryForm();
    });
    const sessionResult = await database.auth.getSession();
    if (sessionResult.error) throw new Error(sessionResult.error.message);
    currentUser = sessionResult.data.session ? sessionResult.data.session.user : null;
    if (currentUser) {
        const profile = await window.WaylineDatabase.getCompanyProfile(currentUser.id);
        if (profile) {
            document.getElementById("company").value = profile.name;
            setCompanyProfilePicture(profile.logo_data);
            await loadCompanyPortalStatus();
            const requiresCompanyMfa = companyPortalStatus.approval_status === "approved" ||
                (companyPortalStatus.submitted_at &&
                    ["owner", "manager"].includes(companyPortalStatus.company_role));
            if (!requiresCompanyMfa || await ensureCompanyMfa()) {
                if (requiresCompanyMfa) await loadCompanyPortalStatus();
                resetCompanyIdleTimer();
                setPartnerPreview(true);
            } else {
                currentUser = null;
                companyPortalStatus = null;
                setCompanyProfilePicture("");
                setPartnerPreview(false);
                loginMessage.textContent = "Two-step verification is required to manage company records.";
            }
        } else {
            currentUser = null;
            companyPortalStatus = null;
            setCompanyProfilePicture("");
            setPartnerPreview(false);
        }
    } else {
        companyPortalStatus = null;
        setCompanyProfilePicture("");
        setPartnerPreview(false);
    }
    await refreshAppData();
    window.WaylineDatabase.subscribeToBusChanges(function() {
        window.clearTimeout(busRefreshTimer);
        busRefreshTimer = window.setTimeout(function() {
            refreshBusAvailability(false);
        }, 200);
    }, function(status, error) {
        if (status === "SUBSCRIBED") {
            document.getElementById("availabilityStatus").textContent = "Live seat updates connected.";
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            console.error("Live bus availability could not connect.", error);
            document.getElementById("availabilityStatus").textContent =
                "Live updates are disconnected. Seats will refresh automatically every 30 seconds.";
        }
    });
    window.setInterval(function() {
        refreshBusAvailability(false);
    }, 30000);
    window.addEventListener("focus", function() {
        refreshBusAvailability(false);
    });
    document.addEventListener("visibilitychange", function() {
        if (document.visibilityState === "visible") refreshBusAvailability(false);
    });
}

function getRwandaDateTime() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Kigali",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date()).reduce(function(result, part) {
        result[part.type] = part.value;
        return result;
    }, {});
    return {
        date: parts.year + "-" + parts.month + "-" + parts.day,
        time: parts.hour + ":" + parts.minute
    };
}

function isTripUpcoming(bus) {
    const now = getRwandaDateTime();
    return bus.date > now.date || (bus.date === now.date && bus.departureTime > now.time);
}

const today = getRwandaDateTime().date;
document.getElementById("date").min = today;
document.getElementById("busDate").min = today;
document.getElementById("heroDate").min = today;
document.getElementById("heroDate").value = today;
const routeDistanceInput = document.getElementById("routeDistance");
const routeDistanceStatus = document.getElementById("routeDistanceStatus");
const calculateRouteDistanceButton = document.getElementById("calculateRouteDistance");
const routeSegmentDistanceField = document.getElementById("routeSegmentDistanceField");
const routeSegmentDistancesInput = document.getElementById("routeSegmentDistances");
document.getElementById("fareCategory").addEventListener("change", updateCalculatedFare);

function updateRouteSegmentDistanceField() {
    const hasStops = routeUtils.parseStops(document.getElementById("intermediateStops").value).length > 0;
    routeSegmentDistanceField.hidden = !hasStops;
    if (!hasStops) routeSegmentDistancesInput.value = "";
}

document.getElementById("busFrom").addEventListener("input", updateRouteSegmentDistanceField);
document.getElementById("busTo").addEventListener("input", updateRouteSegmentDistanceField);
document.getElementById("intermediateStops").addEventListener("input", updateRouteSegmentDistanceField);
updateRouteSegmentDistanceField();

function normalizedText(value) {
    return value.trim().toLocaleLowerCase();
}

function formatBookingReference(bookingId) {
    return String(bookingId).replace(/-/g, "").slice(0, 12).toUpperCase();
}

function formatDate(date) {
    if (!date) return "Date not set";
    return new Date(date + "T12:00:00").toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

function formatFare(amount) {
    return "RWF " + new Intl.NumberFormat("en-RW", {
        maximumFractionDigits: 0
    }).format(Number(amount) || 0);
}

function updateCalculatedFare() {
    const distance = Number(routeDistanceInput.value);
    const category = document.getElementById("fareCategory").value;
    const rate = ruraFarePerKm[category];
    const fare = calculateFare(distance, category);
    const enteredSegmentDistances = routeSegmentDistancesInput.value.trim();
    if (enteredSegmentDistances) {
        const segments = routeUtils.buildRouteSegments(
            document.getElementById("busFrom").value,
            document.getElementById("busTo").value,
            document.getElementById("intermediateStops").value,
            enteredSegmentDistances.split(/[;,\n]/).map(function(value) { return Number(value.trim()); })
        );
        if (!segments || !rate) {
            document.getElementById("calculatedFare").textContent =
                "Enter one valid distance for every adjacent pair of route stops.";
            return;
        }
        const segmentSummary = segments.map(function(segment) {
            return segment.from + " to " + segment.to + ": " +
                formatFare(calculateFare(segment.distanceKm, category));
        }).join("; ");
        document.getElementById("calculatedFare").textContent =
            "Full-route fare: " + formatFare(fare) + " per passenger. Leg fares: " + segmentSummary;
        return;
    }
    document.getElementById("calculatedFare").textContent = fare
        ? "Calculated fare: " + formatFare(fare) + " per passenger (" + distance +
            " km × RWF " + rate + "/km, rounded to the nearest RWF)."
        : "Calculate or enter the route distance to calculate the RWF fare.";
}

routeSegmentDistancesInput.addEventListener("input", updateCalculatedFare);

function getRouteKey() {
    return normalizedText(document.getElementById("busFrom").value) + "|" +
        normalizedText(document.getElementById("busTo").value);
}

function invalidateRouteDistance() {
    const routeKey = getRouteKey();
    document.getElementById("routeActualChecked").checked = false;
    if (routeDistanceController && requestedDistanceRoute !== routeKey) {
        cancelRouteDistanceLookup();
        routeDistanceStatus.textContent = "The route changed. Calculate the new distance or enter it manually.";
    }

    if (routeDistanceInput.value && routeDistanceInputKey !== routeKey) {
        routeDistanceInput.value = "";
        routeDistanceInputKey = "";
        document.getElementById("estimatedDuration").value = "";
        document.getElementById("intermediateStops").value = "";
        updateCalculatedFare();
        routeDistanceStatus.textContent = "The route changed. Calculate the new distance or enter it manually.";
    }
}

function cancelRouteDistanceLookup() {
    if (!routeDistanceController) return;
    routeDistanceController.abort();
    routeDistanceController = null;
    requestedDistanceRoute = "";
    calculateRouteDistanceButton.disabled = false;
    calculateRouteDistanceButton.textContent = "Calculate road distance";
}

async function fetchDistanceData(url, signal) {
    const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: signal
    });
    if (!response.ok) {
        throw new Error("The distance service returned HTTP " + response.status + ".");
    }
    return response.json();
}

async function geocodeRwandanCity(city, signal) {
    const key = normalizedText(city);
    if (routeLocationCache.has(key)) return routeLocationCache.get(key);

    const query = encodeURIComponent(city + ", Rwanda");
    const url = "https://photon.komoot.io/api/?q=" + query + "&limit=5&lang=en";
    const data = await fetchDistanceData(url, signal);
    if (!data || !Array.isArray(data.features)) {
        throw new Error("The city lookup service returned an unexpected response.");
    }
    const feature = data.features.find(function(item) {
        return item.properties && item.properties.countrycode === "RW" &&
            item.geometry && Array.isArray(item.geometry.coordinates) &&
            item.geometry.coordinates.length >= 2 &&
            item.geometry.coordinates.every(Number.isFinite);
    });
    if (!feature) {
        throw new Error("Could not find \"" + city + "\" in Rwanda. Check the city name and try again.");
    }

    const coordinates = feature.geometry.coordinates.slice(0, 2);
    routeLocationCache.set(key, coordinates);
    return coordinates;
}

async function calculateRouteDistance() {
    const from = document.getElementById("busFrom").value.trim();
    const to = document.getElementById("busTo").value.trim();
    if (!from || !to) {
        routeDistanceStatus.textContent = "Enter both route cities before calculating the distance.";
        return;
    }
    if (routeUtils.normalizeCity(from) === routeUtils.normalizeCity(to)) {
        routeDistanceStatus.textContent = "Choose two different cities before calculating the distance.";
        return;
    }

    if (routeDistanceController) routeDistanceController.abort();
    const controller = new AbortController();
    routeDistanceController = controller;
    requestedDistanceRoute = getRouteKey();
    const routeKey = requestedDistanceRoute;
    let timedOut = false;
    const timeoutId = window.setTimeout(function() {
        timedOut = true;
        controller.abort();
    }, 20000);

    calculateRouteDistanceButton.disabled = true;
    calculateRouteDistanceButton.textContent = "Calculating...";
    routeDistanceStatus.textContent = "Finding the cities and calculating the road distance...";

    try {
        const fromCoordinates = await geocodeRwandanCity(from, controller.signal);
        const toCoordinates = await geocodeRwandanCity(to, controller.signal);
        const coordinates = fromCoordinates.join(",") + ";" + toCoordinates.join(",");
        const url = "https://router.project-osrm.org/route/v1/driving/" + coordinates +
            "?overview=false&steps=false";
        const data = await fetchDistanceData(url, controller.signal);
        if (data.code !== "Ok" || !data.routes || !data.routes.length ||
            !Number.isFinite(data.routes[0].distance) || data.routes[0].distance <= 0) {
            throw new Error("No drivable route was found between those cities.");
        }

        const distanceKm = Math.round(data.routes[0].distance / 100) / 10;
        if (distanceKm < 0.1 || distanceKm > 1000) {
            throw new Error("The estimated distance must be between 0.1 and 1,000 km. Verify the route and enter it manually.");
        }
        if (controller.signal.aborted || getRouteKey() !== routeKey) return;

        routeDistanceInput.value = distanceKm.toFixed(1);
        routeDistanceInputKey = routeKey;
        const durationMinutes = Math.ceil(Number(data.routes[0].duration) / 60);
        document.getElementById("estimatedDuration").value =
            Number.isInteger(durationMinutes) && durationMinutes >= 1 && durationMinutes <= 1440
                ? String(durationMinutes)
                : "";
        document.getElementById("routeActualChecked").checked = false;
        updateCalculatedFare();
        routeDistanceStatus.textContent =
            "Estimated road distance: " + distanceKm.toFixed(1) +
            " km from city center to city center" +
            (Number.isInteger(durationMinutes) && durationMinutes >= 1
                ? " and about " + formatDuration(durationMinutes)
                : "") +
            ". Check the actual bus route and duration before saving.";
    } catch (error) {
        if (!controller.signal.aborted || timedOut) {
            routeDistanceStatus.textContent = timedOut
                ? "The road-distance request timed out. Check your connection and try again."
                : error.message || "Could not calculate the road distance. Enter it manually and try again.";
            console.error("Could not calculate the bus route distance.", error);
        }
    } finally {
        window.clearTimeout(timeoutId);
        if (routeDistanceController === controller) {
            routeDistanceController = null;
            requestedDistanceRoute = "";
            calculateRouteDistanceButton.disabled = false;
            calculateRouteDistanceButton.textContent = "Calculate road distance";
        }
    }
}

routeDistanceInput.addEventListener("input", function() {
    cancelRouteDistanceLookup();
    routeDistanceInputKey = routeDistanceInput.value ? getRouteKey() : "";
    document.getElementById("routeActualChecked").checked = false;
    document.getElementById("estimatedDuration").value = "";
    routeDistanceStatus.textContent = routeDistanceInput.value
        ? "Using the manually entered distance."
        : "Enter the departure and destination cities to estimate the driving distance. You can edit the result.";
    updateCalculatedFare();
});
document.getElementById("busFrom").addEventListener("input", invalidateRouteDistance);
document.getElementById("busTo").addEventListener("input", invalidateRouteDistance);
document.getElementById("routeActualChecked").addEventListener("invalid", function() {
    document.getElementById("busMessage").textContent =
        "Check the actual bus route and confirm it before publishing the fare.";
});
calculateRouteDistanceButton.addEventListener("click", calculateRouteDistance);

function makeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function makeCompanyLogo(bus, className) {
    if (!bus.logo) return null;
    const logo = document.createElement("img");
    logo.className = className;
    logo.src = bus.logo;
    logo.alt = bus.company + " logo";
    return logo;
}

function resizeCompanyLogo(file) {
    return new Promise(function(resolve, reject) {
        const reader = new FileReader();
        reader.onerror = function() { reject(new Error("The selected image could not be read.")); };
        reader.onload = function() {
            const image = new Image();
            image.onerror = function() { reject(new Error("The selected file is not a valid image.")); };
            image.onload = function() {
                const maxDimension = 256;
                const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                const context = canvas.getContext("2d");
                if (!context) {
                    reject(new Error("Image resizing is not supported by this browser."));
                    return;
                }
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/webp", 0.82));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function addEmptyMessage(container, text) {
    container.appendChild(makeElement("p", "empty-state", text));
}

function updateCompanyOptions() {
    const selectedCompany = companyFilter.value;
    const companies = Array.from(new Set(buses.filter(function(bus) {
        return bus.isActive && bus.availableSeats > 0 && bus.routeDistanceKm > 0 &&
            bus.company.trim() && bus.from && bus.to && isTripUpcoming(bus);
    }).map(function(bus) { return bus.company.trim(); })));
    companyFilter.replaceChildren(new Option(
        companies.length ? "All bus companies" : "No buses available yet",
        ""
    ));

    companies.sort(function(first, second) { return first.localeCompare(second); });
    companies.forEach(function(company) {
        companyFilter.appendChild(new Option(company, company));
    });
    if (companies.includes(selectedCompany)) companyFilter.value = selectedCompany;
}

function updatePopularRoutes() {
    const routeGroup = document.getElementById("popularRoutes");
    const routes = new Map();
    buses.filter(function(bus) {
        return bus.isActive && !bus.isCancelled && bus.availableSeats > 0 &&
            bus.routeDistanceKm > 0 && isTripUpcoming(bus);
    }).forEach(function(bus) {
        const stops = routeUtils.parseStops(bus.intermediateStops);
        const key = [
            routeUtils.normalizeCity(bus.from),
            routeUtils.normalizeCity(bus.to),
            stops.map(routeUtils.normalizeCity).join("|")
        ].join("::");
        if (!routes.has(key)) routes.set(key, {
            from: bus.from,
            to: bus.to,
            stops: stops
        });
    });

    routeGroup.replaceChildren(makeElement("span", "", "Available routes"));
    Array.from(routes.values()).forEach(function(route) {
        const button = makeElement(
            "button",
            "route-chip",
            routeUtils.formatRoute(route.from, route.to) +
                (route.stops.length ? " · Via " + route.stops.join(" · ") : "")
        );
        button.type = "button";
        button.dataset.from = route.from;
        button.dataset.to = route.to;
        routeGroup.appendChild(button);
    });
    routeGroup.hidden = routes.size === 0;
}

function renderHomeTrustCues() {
    const availableBuses = buses.filter(function(bus) {
        return bus.isActive && !bus.isCancelled && bus.availableSeats > 0 &&
            bus.routeDistanceKm > 0 && bus.company && bus.from && bus.to &&
            isTripUpcoming(bus);
    });
    const companies = Array.from(new Set(availableBuses.map(function(bus) {
        return bus.company.trim();
    }))).filter(Boolean).sort(function(first, second) {
        return first.localeCompare(second);
    });
    document.getElementById("homeCompanyCount").textContent = String(companies.length);

    const companyNames = document.getElementById("homeCompanyNames");
    companyNames.replaceChildren();
    if (companies.length) {
        companies.slice(0, 4).forEach(function(company) {
            companyNames.appendChild(makeElement("span", "home-company-chip", company));
        });
    } else {
        companyNames.appendChild(makeElement("span", "home-company-empty", "No trips are currently listed."));
    }

    const routes = new Map();
    availableBuses.forEach(function(bus) {
        const key = routeUtils.normalizeCity(bus.from) + "::" + routeUtils.normalizeCity(bus.to);
        let route = routes.get(key);
        if (!route) {
            route = {
                from: bus.from,
                to: bus.to,
                fare: Number(bus.fare),
                date: bus.date,
                departureTime: bus.departureTime,
                departures: 0
            };
            routes.set(key, route);
        }
        route.departures += 1;
        route.fare = Math.min(route.fare, Number(bus.fare));
        if (bus.date < route.date ||
            (bus.date === route.date && bus.departureTime < route.departureTime)) {
            route.date = bus.date;
            route.departureTime = bus.departureTime;
        }
    });

    const routeHighlights = document.getElementById("homeRouteHighlights");
    routeHighlights.replaceChildren();
    const featuredRoutes = Array.from(routes.values()).sort(function(first, second) {
        return second.departures - first.departures ||
            first.fare - second.fare ||
            first.from.localeCompare(second.from);
    }).slice(0, 3);

    if (!featuredRoutes.length) {
        routeHighlights.appendChild(makeElement("p", "home-route-empty", "No trips are currently listed."));
        return;
    }

    featuredRoutes.forEach(function(route) {
        const card = makeElement("button", "home-route-card");
        card.type = "button";
        card.dataset.from = route.from;
        card.dataset.to = route.to;
        card.dataset.date = route.date;
        const fare = makeElement("span", "home-route-fare");
        fare.append(
            makeElement("span", "home-route-fare-label", "From"),
            makeElement("strong", "", formatFare(route.fare))
        );
        card.append(
            makeElement("strong", "home-route-name", routeUtils.formatRoute(route.from, route.to)),
            fare,
            makeElement("span", "home-route-action", "Search this route")
        );
        routeHighlights.appendChild(card);
    });
}

function updateCitySuggestions() {
    const cities = new Map();
    commonCities.forEach(function(city) {
        cities.set(normalizedText(city), city);
    });
    buses.forEach(function(bus) {
        [bus.from, bus.to].forEach(function(city) {
            const trimmedCity = city.trim();
            if (trimmedCity) cities.set(normalizedText(trimmedCity), trimmedCity);
        });
        routeUtils.parseStops(bus.intermediateStops).forEach(function(city) {
            cities.set(normalizedText(city), city);
        });
    });

    document.getElementById("citySuggestions").replaceChildren(
        ...Array.from(cities.values())
            .sort(function(first, second) { return first.localeCompare(second); })
            .map(function(city) {
                const option = document.createElement("option");
                option.value = city;
                return option;
            })
    );
}

function getBusRouteSection(bus, origin, destination) {
    const segments = bus.routeSegments || [];
    let fareDetails = null;
    if (segments.length) {
        fareDetails = routeUtils.calculateSegmentFare(
            bus.from,
            bus.to,
            bus.intermediateStops,
            segments,
            origin,
            destination,
            bus.fareCategory
        );
    } else if (routeUtils.normalizeCity(bus.from) === routeUtils.normalizeCity(origin) &&
        routeUtils.normalizeCity(bus.to) === routeUtils.normalizeCity(destination)) {
        fareDetails = {
            from: bus.from,
            to: bus.to,
            distanceKm: bus.routeDistanceKm,
            fare: bus.fare
        };
    }
    if (!fareDetails) return null;
    const route = routeUtils.findRouteSection(
        bus.from,
        bus.to,
        bus.intermediateStops,
        fareDetails.from,
        fareDetails.to
    );
    return Object.assign({}, fareDetails, { stops: route.slice(1, -1) });
}

function renderSearchResults(matchingBuses, requestedSeats) {
    searchResults.replaceChildren();

    matchingBuses.forEach(function(bus) {
        const result = makeElement("article", "result-card");
        const heading = makeElement("div", "result-heading");
        const operator = makeElement("div", "result-operator");
        const brand = makeElement("div", "company-brand");
        const logo = makeCompanyLogo(bus, "company-logo");
        if (logo) brand.appendChild(logo);
        operator.appendChild(makeElement("h3", "", bus.company));
        operator.appendChild(makeElement("p", "muted-label", bus.name));
        brand.appendChild(operator);
        heading.appendChild(brand);
        heading.appendChild(makeElement("span", "availability", bus.availableSeats + " seats remaining"));

        const selectedFrom = bus.selectedFrom || bus.from;
        const selectedTo = bus.selectedTo || bus.to;
        const isFullRoute = routeUtils.normalizeCity(selectedFrom) === routeUtils.normalizeCity(bus.from) &&
            routeUtils.normalizeCity(selectedTo) === routeUtils.normalizeCity(bus.to);
        const route = makeElement("p", "result-route", routeUtils.formatRoute(selectedFrom, selectedTo));
        const stops = bus.selectedStops || routeUtils.parseStops(bus.intermediateStops);
        const stopsDetails = stops.length
            ? makeElement("p", "result-stops", "Via " + stops.join(" · "))
            : null;
        const estimatedArrival = isFullRoute ? getEstimatedArrival(bus) : null;
        const journeyTiming = isFullRoute && bus.estimatedDurationMinutes
            ? " | About " + formatDuration(bus.estimatedDurationMinutes) +
                " | Estimated arrival " + (estimatedArrival
                    ? (estimatedArrival.date === bus.date
                        ? estimatedArrival.time
                        : formatDate(estimatedArrival.date) + " at " + estimatedArrival.time)
                    : "not available")
            : isFullRoute
                ? " | Arrival and duration not provided by operator"
                : " | Segment duration and arrival time not provided";
        const farePerPassenger = Number(bus.selectedFare) || bus.fare;
        const routeDistance = Number(bus.selectedDistanceKm) || bus.routeDistanceKm;
        const details = makeElement(
            "p",
            "result-details",
            "Departs " + formatDate(bus.date) + " at " + bus.departureTime +
                journeyTiming + " | " + routeDistance + " km"
        );
        const fareDetails = makeElement("p", "result-details", formatFare(farePerPassenger) + " per passenger");
        const verificationBadge = makeWaylineVerificationBadge(bus);
        const baseFare = farePerPassenger * requestedSeats;
        const total = baseFare;
        const priceBreakdown = makeElement(
            "p",
            "result-total",
            formatFare(farePerPassenger) + " x " + requestedSeats + " passengers = " + formatFare(total) + " total"
        );
        const bookButton = makeElement(
            "button",
            "button button-primary result-book-button",
            "Select bus"
        );
        bookButton.type = "button";
        bookButton.addEventListener("click", function() {
            openDemoCheckout(bus.id, requestedSeats, baseFare, total, bus);
        });

        result.append(heading, route);
        if (verificationBadge) result.appendChild(verificationBadge);
        if (stopsDetails) result.appendChild(stopsDetails);
        result.append(fareDetails, details, priceBreakdown, bookButton);
        searchResults.appendChild(result);
    });
}

function makeWaylineVerificationBadge(bus) {
    const today = new Date().toISOString().slice(0, 10);
    if (!bus.isWaylineVerified || !bus.licenseValidUntil || bus.licenseValidUntil < today) return null;
    return makeElement(
        "p",
        "company-verification-badge",
        "Verified by Wayline · Licence valid until " +
            new Date(bus.licenseValidUntil + "T12:00:00").toLocaleDateString()
    );
}

function openDemoCheckout(busId, seatCount, baseFare, totalFare, selectedBus) {
    const bus = buses.find(function(item) { return item.id === busId; });

    if (!bus || !bus.isActive || bus.availableSeats < seatCount) {
        searchMessage.textContent = "Those places are no longer available. Search again for current availability.";
        performSearch();
        return;
    }

    if (!validatePassengerNames(passengerNames, seatCount)) {
        window.location.href = "index.html?passengerNamesRequired=1#home";
        return;
    }
    passengerPhoneInput.value = "";
    passengerPhoneInput.setCustomValidity("");
    document.getElementById("paymentMethod").value = "";
    pendingBooking = {
        busId: busId,
        seatCount: seatCount,
        baseFare: baseFare,
        totalFare: totalFare,
        from: selectedBus.selectedFrom || bus.from,
        to: selectedBus.selectedTo || bus.to,
        stops: selectedBus.selectedStops || routeUtils.parseStops(bus.intermediateStops),
        distanceKm: Number(selectedBus.selectedDistanceKm) || bus.routeDistanceKm
    };
    document.getElementById("checkoutRoute").textContent =
        bus.company + " | " + bus.name + " | " + routeUtils.formatRoute(pendingBooking.from, pendingBooking.to) +
        (pendingBooking.stops.length ? " · Via " + pendingBooking.stops.join(" · ") : "") +
        " | " + formatDate(bus.date) + " at " + bus.departureTime +
        " | " + seatCount + (seatCount === 1 ? " passenger" : " passengers") +
        " | " + bus.availableSeats + " seats remaining";
    document.getElementById("checkoutFare").textContent = formatFare(baseFare);
    document.getElementById("checkoutTotal").textContent = formatFare(totalFare);
    document.getElementById("checkoutPassengerNames").textContent = "Passengers: " + formatPassengerNames(passengerNames);
    document.getElementById("checkoutEntryStep").hidden = false;
    document.getElementById("checkoutReviewStep").hidden = true;
    setBookingProgress(2);
    document.getElementById("checkoutDialog").showModal();
    passengerPhoneInput.focus();
}

function performSearch() {
    const from = document.getElementById("from").value.trim();
    const to = document.getElementById("to").value.trim();
    const date = document.getElementById("date").value;
    const company = companyFilter.value;
    const requestedSeats = Number(document.getElementById("seatCount").value);

    searchResults.replaceChildren();
    if (!from || !to) {
        searchMessage.textContent = "Enter both a departure city and destination.";
        return;
    }
    if (routeUtils.normalizeCity(from) === routeUtils.normalizeCity(to)) {
        searchMessage.textContent = "Choose two different cities for your journey.";
        return;
    }
    if (!date) {
        searchMessage.textContent = "Choose a travel date to see available buses.";
        document.getElementById("date").focus();
        return;
    }
    if (date < getRwandaDateTime().date) {
        searchMessage.textContent = "Choose today or a future travel date.";
        document.getElementById("date").focus();
        return;
    }
    if (!Number.isInteger(requestedSeats) || requestedSeats < 1 || requestedSeats > 20) {
        searchMessage.textContent = "Choose between 1 and 20 passengers.";
        return;
    }

    setBookingProgress(1);
    const matches = buses.map(function(bus) {
        if (!bus.isActive || bus.isCancelled || bus.availableSeats < requestedSeats ||
            bus.routeDistanceKm <= 0 || (company && bus.company !== company) ||
            !bus.from || !bus.to || bus.date !== date || !isTripUpcoming(bus)) return null;
        const section = getBusRouteSection(bus, from, to);
        if (!section) return null;
        return Object.assign({}, bus, {
            selectedFrom: section.from,
            selectedTo: section.to,
            selectedStops: section.stops,
            selectedDistanceKm: section.distanceKm,
            selectedFare: section.fare
        });
    }).filter(Boolean);

    if (matches.length === 0) {
        searchForm.hidden = false;
        searchSummary.hidden = true;
        searchMessage.textContent =
            "No buses are available for this route and date with enough seats. Try another date or route.";
        document.getElementById("noResultsActions").hidden = false;
        searchMessage.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "start"
        });
        return;
    }

    document.getElementById("noResultsActions").hidden = true;
    collapseSearchForm(from, to, date, requestedSeats);
    matches.sort(function(first, second) {
        return first.departureTime.localeCompare(second.departureTime);
    });
    searchMessage.textContent = matches.length + (matches.length === 1 ? " bus found." : " buses found.");
    renderSearchResults(matches, requestedSeats);
    window.requestAnimationFrame(function() {
        searchResults.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "start"
        });
    });
}

function formatDuration(minutes) {
    const duration = Number(minutes);
    if (!Number.isInteger(duration) || duration < 1) return "Not provided";
    const hours = Math.floor(duration / 60);
    const remainingMinutes = duration % 60;
    if (!hours) return remainingMinutes + " min";
    return hours + " hr" + (hours === 1 ? "" : "s") +
        (remainingMinutes ? " " + remainingMinutes + " min" : "");
}

function getEstimatedArrival(bus) {
    const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bus.date || "");
    const timeParts = /^(\d{2}):(\d{2})$/.exec(bus.departureTime || "");
    const duration = Number(bus.estimatedDurationMinutes);
    if (!dateParts || !timeParts || !Number.isInteger(duration) || duration < 1) return null;

    const arrival = new Date(Date.UTC(
        Number(dateParts[1]),
        Number(dateParts[2]) - 1,
        Number(dateParts[3]),
        Number(timeParts[1]),
        Number(timeParts[2]) + duration
    ));
    if (Number.isNaN(arrival.getTime())) return null;
    return {
        date: arrival.toISOString().slice(0, 10),
        time: arrival.toISOString().slice(11, 16)
    };
}

function populateBookingReview(bus) {
    const stops = pendingBooking.stops;
    const isFullRoute = routeUtils.normalizeCity(pendingBooking.from) === routeUtils.normalizeCity(bus.from) &&
        routeUtils.normalizeCity(pendingBooking.to) === routeUtils.normalizeCity(bus.to);
    const estimatedArrival = isFullRoute ? getEstimatedArrival(bus) : null;
    document.getElementById("reviewPassenger").textContent = "Passengers: " + formatPassengerNames(passengerNames);
    document.getElementById("reviewPhone").textContent =
        normalizeRwandaPhoneNumber(passengerPhoneInput.value);
    document.getElementById("reviewCompany").textContent = bus.company;
    document.getElementById("reviewBus").textContent = bus.name;
    document.getElementById("reviewRoute").textContent = routeUtils.formatRoute(pendingBooking.from, pendingBooking.to);
    document.getElementById("reviewStops").textContent = stops.length
        ? stops.join(" · ")
        : "No intermediate stops listed";
    document.getElementById("reviewDeparture").textContent =
        formatDate(bus.date) + " at " + bus.departureTime;
    document.getElementById("reviewDistance").textContent =
        pendingBooking.distanceKm + " km" + (isFullRoute && bus.estimatedDurationMinutes
            ? " · About " + formatDuration(bus.estimatedDurationMinutes) +
                (estimatedArrival
                    ? " · Estimated arrival " +
                        (estimatedArrival.date === bus.date
                            ? estimatedArrival.time
                            : formatDate(estimatedArrival.date) + " at " + estimatedArrival.time)
                    : "")
            : isFullRoute ? " · Duration not provided" : " · Segment duration and arrival time not provided");
    document.getElementById("reviewSeats").textContent =
        pendingBooking.seatCount + (pendingBooking.seatCount === 1 ? " passenger" : " passengers") +
        " · " + bus.availableSeats + " seats remaining before reservation";
    document.getElementById("reviewTotal").textContent = formatFare(pendingBooking.totalFare);
    document.getElementById("reviewPaymentMethod").textContent =
        document.getElementById("paymentMethod").value + " (not processed)";
}

async function bookTrip(busId, seatCount, baseFare, totalFare, passengerNamesToSave, passengerPhone, paymentMethod, from, to) {
    const bus = buses.find(function(item) { return item.id === busId; });
    const normalizedPhone = normalizeRwandaPhoneNumber(passengerPhone);

    if (!validatePassengerNames(passengerNamesToSave, seatCount)) {
        window.location.href = "index.html?passengerNamesRequired=1#home";
        return false;
    }
    if (!normalizedPhone) {
        passengerPhoneInput.setCustomValidity("Enter a valid Rwanda mobile number, such as 078 123 4567.");
        document.getElementById("passengerPhone").reportValidity();
        document.getElementById("passengerPhone").focus();
        return false;
    }
    if (!bus || !bus.isActive || bus.availableSeats < seatCount) {
        searchMessage.textContent = "Those seats are no longer available. Search again for current availability.";
        await refreshAppData();
        performSearch();
        return false;
    }

    const booking = await window.WaylineDatabase.createBooking(
        bus,
        passengerNamesToSave,
        normalizedPhone,
        seatCount,
        paymentMethod,
        from,
        to
    );
    try {
        await refreshAppData();
        searchMessage.textContent = "Reservation saved. Payment has not been collected.";
        performSearch();
    } catch (error) {
        console.error("Reservation was saved, but availability could not be refreshed.", error);
        booking.refreshWarning =
            "Your reservation was saved, but seat availability could not refresh. Refresh the search before choosing another trip.";
    }
    return booking;
}

document.getElementById("closeCheckout").addEventListener("click", function() {
    pendingBooking = null;
    document.getElementById("checkoutDialog").close();
});

document.getElementById("cancelCheckout").addEventListener("click", function() {
    pendingBooking = null;
    document.getElementById("checkoutDialog").close();
});

document.getElementById("checkoutDialog").addEventListener("close", function() {
    pendingBooking = null;
    passengerPhoneInput.value = "";
    document.getElementById("paymentMethod").value = "";
    document.getElementById("checkoutEntryStep").hidden = false;
    document.getElementById("checkoutReviewStep").hidden = true;
});

passengerPhoneInput.addEventListener("input", function() {
    passengerPhoneInput.setCustomValidity("");
});

document.getElementById("reviewBooking").addEventListener("click", function() {
    if (!pendingBooking) return;
    const paymentMethod = document.getElementById("paymentMethod");
    if (!validatePassengerNames(passengerNames, pendingBooking.seatCount)) {
        window.location.href = "index.html?passengerNamesRequired=1#home";
        return;
    }
    const normalizedPhone = normalizeRwandaPhoneNumber(passengerPhoneInput.value);
    passengerPhoneInput.setCustomValidity(normalizedPhone
        ? ""
        : "Enter a valid Rwanda mobile number, such as 078 123 4567.");
    if (!passengerPhoneInput.reportValidity()) return;
    if (!paymentMethod.value) {
        paymentMethod.reportValidity();
        return;
    }

    const bus = buses.find(function(item) { return item.id === pendingBooking.busId; });
    if (!bus || !bus.isActive || bus.availableSeats < pendingBooking.seatCount || !isTripUpcoming(bus)) {
        searchMessage.textContent = "This trip is no longer available. Search again to see current buses and seats.";
        document.getElementById("checkoutDialog").close();
        performSearch();
        return;
    }

    populateBookingReview(bus);
    document.getElementById("checkoutEntryStep").hidden = true;
    document.getElementById("checkoutReviewStep").hidden = false;
    document.getElementById("checkoutReviewTitle").focus();
});

document.getElementById("editBookingDetails").addEventListener("click", function() {
    document.getElementById("checkoutReviewStep").hidden = true;
    document.getElementById("checkoutEntryStep").hidden = false;
    passengerPhoneInput.focus();
});

document.getElementById("confirmBooking").addEventListener("click", async function(event) {
    if (!pendingBooking) return;
    const paymentMethod = document.getElementById("paymentMethod");
    passengerPhoneInput.setCustomValidity("");
    if (!validatePassengerNames(passengerNames, pendingBooking.seatCount)) {
        window.location.href = "index.html?passengerNamesRequired=1#home";
        return;
    }
    if (!passengerPhoneInput.reportValidity()) return;
    if (!paymentMethod.value) {
        paymentMethod.reportValidity();
        return;
    }
    setBookingProgress(3);
    const confirmButton = event.currentTarget;
    confirmButton.disabled = true;
    try {
        const booking = await bookTrip(
            pendingBooking.busId,
            pendingBooking.seatCount,
            pendingBooking.baseFare,
            pendingBooking.totalFare,
            passengerNames,
            passengerPhoneInput.value.trim(),
            paymentMethod.value,
            pendingBooking.from,
            pendingBooking.to
        );
        if (booking) {
            const bookingStatus = window.WaylineBookingStatus.describe(booking);
            document.getElementById("checkoutDialog").close();
            setBookingProgress(4);
            document.getElementById("bookingConfirmationRoute").textContent =
                routeUtils.formatRoute(booking.from, booking.to);
            document.getElementById("bookingConfirmationTravel").textContent =
                formatDate(booking.date) +
                (booking.departureTime ? " at " + booking.departureTime : "");
            document.getElementById("bookingConfirmationPassenger").textContent =
                "Passengers: " + formatPassengerNames(booking.names || passengerNames);
            document.getElementById("bookingConfirmationCompany").textContent =
                booking.company || "Company not recorded";
            document.getElementById("bookingConfirmationAmount").textContent =
                formatFare(booking.totalFare);
            const bookingStatusBadge = document.getElementById("bookingConfirmationBookingStatus");
            bookingStatusBadge.className = "status-badge " + bookingStatus.className;
            bookingStatusBadge.textContent = bookingStatus.bookingLabel;
            document.getElementById("bookingConfirmationPaymentStatus").textContent =
                bookingStatus.paymentLabel + " · " + (booking.paymentMethod || "No method selected");
            document.getElementById("bookingConfirmationMessage").textContent =
                "Seat reserved. Pay within 15:00 to keep it. Booking is unpaid until the company confirms payment.";
            document.getElementById("bookingConfirmationNextStep").textContent =
                booking.refreshWarning
                    ? bookingStatus.nextStep + " " + booking.refreshWarning
                    : bookingStatus.nextStep;
            document.getElementById("bookingConfirmationReference").textContent =
                formatBookingReference(booking.id);
            document.getElementById("copyBookingReferenceMessage").textContent = "";
            document.getElementById("bookingConfirmationDialog").showModal();
        } else {
            setBookingProgress(2);
        }
    } catch (error) {
        setBookingProgress(2);
        document.getElementById("searchMessage").textContent = error.message || "Could not save the booking. Please try again.";
    } finally {
        confirmButton.disabled = false;
    }
});

document.getElementById("copyBookingReference").addEventListener("click", async function() {
    const reference = document.getElementById("bookingConfirmationReference").textContent;
    const message = document.getElementById("copyBookingReferenceMessage");
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(reference);
        } else {
            const temporaryInput = document.createElement("textarea");
            temporaryInput.value = reference;
            temporaryInput.setAttribute("readonly", "");
            temporaryInput.style.position = "fixed";
            temporaryInput.style.opacity = "0";
            document.body.appendChild(temporaryInput);
            temporaryInput.select();
            const copied = document.execCommand("copy");
            temporaryInput.remove();
            if (!copied) throw new Error("Clipboard access is unavailable.");
        }
        message.textContent = "Booking reference copied.";
    } catch (error) {
        message.textContent = "Could not copy automatically. Select the reference above to copy it.";
        const range = document.createRange();
        range.selectNodeContents(document.getElementById("bookingConfirmationReference"));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        console.error("Could not copy the booking reference.", error);
    }
});

function closeBookingConfirmation() {
    document.getElementById("bookingConfirmationDialog").close();
}

document.getElementById("closeBookingConfirmation").addEventListener("click", function() {
    closeBookingConfirmation();
});
document.getElementById("closeBookingConfirmationDone").addEventListener("click", function() {
    closeBookingConfirmation();
});

function bookingTripStatus(booking) {
    if (String(booking.paymentStatus || "").toLowerCase() === "expired") return "expired";
    if (booking.cancelled) return "cancelled";
    return isTripUpcoming(booking) ? "upcoming" : "completed";
}

function csvCell(value) {
    let text = String(value == null ? "" : value);
    if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
}

function downloadPassengerManifest(bus) {
    if (!currentUser || bus.companyId !== currentUser.id) {
        throw new Error("Only the bus company can access this passenger manifest.");
    }

    const manifestBookings = bookings.filter(function(booking) {
        return booking.companyView && booking.companyId === currentUser.id &&
            booking.busId === bus.id;
    });
    if (!manifestBookings.length) {
        document.getElementById("busMessage").textContent =
            "There are no passenger bookings for this schedule yet.";
        return;
    }

    const rows = [
        ["Bus", "Route", "Travel date", "Departure time", "Booking reference", "Passenger names", "Phone number", "Seats", "Booking status", "Payment status"]
    ].concat(manifestBookings.map(function(booking) {
        return [
            booking.busName,
            routeUtils.formatRoute(booking.from, booking.to),
            booking.date,
            booking.departureTime,
            formatBookingReference(booking.id),
            (booking.names || [booking.name]).join("; "),
            booking.phone,
            booking.seats,
            String(booking.paymentStatus || "").toLowerCase() === "expired"
                ? "Expired"
                : booking.cancelled ? "Cancelled" : "Reserved",
            window.WaylineBookingStatus.describe(booking).paymentLabel
        ];
    }));
    const csv = "\uFEFF" + rows.map(function(row) {
        return row.map(csvCell).join(",");
    }).join("\r\n");
    const file = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "wayline-manifest-" +
        bus.date + "-" + bus.name.replace(/[^A-Za-z0-9_-]+/g, "-") + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function() { URL.revokeObjectURL(downloadUrl); }, 1000);
    document.getElementById("busMessage").textContent =
        "Passenger manifest downloaded. Keep passenger contact details private.";
}

function renderBookings() {
    const companyBookingList = document.getElementById("companyBookingList");
    companyBookingList.replaceChildren();
    document.getElementById("companyBookingCount").textContent = String(bookings.length);
    document.getElementById("dashboardBookingCount").textContent = String(currentUser ? bookings.length : 0);

    if (!currentUser || bookings.length === 0) {
        if (currentUser) addEmptyMessage(companyBookingList, "No bookings have been made for your schedules yet.");
        return;
    }

    const searchTerm = normalizedText(document.getElementById("bookingSearch").value);
    const requestedStatus = document.getElementById("bookingStatusFilter").value;
    const filteredBookings = bookings.filter(function(booking) {
        const status = bookingTripStatus(booking);
        const searchable = [
            booking.name,
            (booking.names || []).join(" "),
            booking.phone,
            booking.company,
            booking.busName,
            booking.from,
            booking.to,
            formatBookingReference(booking.id)
        ].join(" ").toLocaleLowerCase();
        return (!searchTerm || searchable.includes(searchTerm)) &&
            (requestedStatus === "all" || requestedStatus === status);
    });
    if (!filteredBookings.length) {
        addEmptyMessage(companyBookingList, "No bookings match these filters.");
        return;
    }

    [
        { status: "upcoming", title: "Upcoming trips" },
        { status: "completed", title: "Completed trips" },
        { status: "expired", title: "Expired reservations" },
        { status: "cancelled", title: "Cancelled trips" }
    ].forEach(function(groupDefinition) {
        const groupBookings = filteredBookings.filter(function(booking) {
            return bookingTripStatus(booking) === groupDefinition.status;
        });
        if (!groupBookings.length) return;

        const group = makeElement("section", "booking-status-group");
        group.appendChild(makeElement("h4", "", groupDefinition.title));
        const list = makeElement("div", "record-list");
        groupBookings.forEach(function(booking) {
            const card = makeElement(
                "article",
                "record-card booking-card" + (booking.cancelled ? " is-cancelled" : "")
            );
            const top = makeElement("div", "record-topline");
            top.appendChild(makeElement("h3", "", routeUtils.formatRoute(booking.from, booking.to)));
            top.appendChild(makeElement(
                "span",
                "status-badge status-" + bookingTripStatus(booking),
                groupDefinition.title.replace(" trips", "")
            ));

            const reference = makeElement(
                "p",
                "ticket-reference",
                "BOOKING REF  " + formatBookingReference(booking.id)
            );
            const bookingStatus = window.WaylineBookingStatus.describe(booking);
            const details = makeElement(
                "p",
                "record-details",
                "Passengers: " + (booking.names || [booking.name]).map(function(name, index) {
                    return (index + 1) + ". " + name;
                }).join(" ") + (booking.phone ? " | " + booking.phone : "") +
                    "\nCompany: " + (booking.company || "Company not recorded") +
                    (booking.busName ? " | " + booking.busName : "") +
                    "\n" + formatDate(booking.date) +
                    (booking.departureTime ? " at " + booking.departureTime : "") +
                    " | " + booking.seats + (booking.seats === 1 ? " passenger" : " passengers") +
                    "\nPayment method: " + (booking.paymentMethod || "Not selected") +
                    (booking.totalFare > 0 ? "\nFare " + formatFare(booking.baseFare) +
                        (booking.platformFee > 0 ? " | Service fee " + formatFare(booking.platformFee) : "") +
                        " | Total " + formatFare(booking.totalFare) : "") +
                    "\nPayment: " + bookingStatus.paymentLabel +
                    "\n" + bookingStatus.description
            );
            card.append(top, reference, details);

            if (!booking.cancelled) {
                const actions = makeElement("div", "record-actions");
                const printButton = makeElement("button", "button button-print", "Print booking record");
                printButton.type = "button";
                printButton.addEventListener("click", function() {
                    card.classList.add("is-printing");
                    document.body.classList.add("printing-ticket");
                    window.print();
                    card.classList.remove("is-printing");
                    document.body.classList.remove("printing-ticket");
                });
                actions.appendChild(printButton);
                card.appendChild(actions);
            }
            list.appendChild(card);
        });
        group.appendChild(list);
        companyBookingList.appendChild(group);
    });
}

function resetScheduleEditor() {
    editingBusId = null;
    busForm.reset();
    cancelRouteDistanceLookup();
    routeDistanceInputKey = "";
    routeDistanceStatus.textContent =
        "Enter the departure and destination cities to estimate the driving distance. You can edit the result.";
    routeSegmentDistanceField.hidden = true;
    routeSegmentDistancesInput.value = "";
    document.getElementById("busPlateNumber").value = "";
    document.getElementById("busInsuranceExpiry").value = "";
    document.getElementById("busInspectionExpiry").value = "";
    busForm.querySelector('button[type="submit"]').textContent = "Add bus schedule";
    document.getElementById("cancelBusEdit").hidden = true;
    updateCalculatedFare();
}

function editSchedule(bus) {
    if (!currentUser || !companyPortalStatus || bus.companyId !== companyPortalStatus.company_id) return;
    editingBusId = bus.id;
    document.getElementById("company").value = bus.company;
    document.getElementById("busName").value = bus.name;
    document.getElementById("busPlateNumber").value = bus.plateNumber || "";
    document.getElementById("busInsuranceExpiry").value = bus.insuranceExpiry || "";
    document.getElementById("busInspectionExpiry").value = bus.technicalInspectionExpiry || "";
    document.getElementById("busFrom").value = bus.from;
    document.getElementById("busTo").value = bus.to;
    document.getElementById("busDate").value = bus.date;
    document.getElementById("departureTime").value = bus.departureTime;
    document.getElementById("seatNumber").value = bus.totalSeats;
    routeDistanceInput.value = bus.routeDistanceKm;
    document.getElementById("estimatedDuration").value =
        bus.estimatedDurationMinutes || "";
    document.getElementById("intermediateStops").value = bus.intermediateStops || "";
    updateRouteSegmentDistanceField();
    routeSegmentDistancesInput.value = (bus.routeSegments || []).map(function(segment) {
        return segment.distanceKm;
    }).join(", ");
    document.getElementById("routeActualChecked").checked = false;
    routeDistanceInputKey = getRouteKey();
    document.getElementById("fareCategory").value = bus.fareCategory;
    routeDistanceStatus.textContent = "Editing this schedule. Confirm the route distance before saving.";
    busForm.querySelector('button[type="submit"]').textContent = "Save schedule";
    document.getElementById("cancelBusEdit").hidden = false;
    updateCalculatedFare();
    busForm.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("busName").focus({ preventScroll: true });
}

function scheduleStatus(bus) {
    if (bus.isCancelled) return "cancelled";
    if (!bus.isActive) return "hidden";
    if (!isTripUpcoming(bus)) return "completed";
    if (bus.availableSeats === 0) return "full";
    return "upcoming";
}

document.getElementById("cancelBusEdit").addEventListener("click", function() {
    resetScheduleEditor();
    document.getElementById("busMessage").textContent = "Schedule edit cancelled.";
});

document.querySelectorAll(".dashboard-nav a").forEach(function(link) {
    link.addEventListener("click", function() {
        document.querySelectorAll(".dashboard-nav a").forEach(function(item) {
            item.classList.toggle("is-active", item === link);
        });
    });
});

function renderBuses() {
    busList.replaceChildren();
    const manageableBuses = currentUser
        ? buses.filter(function(bus) { return bus.companyId === currentUser.id; })
        : buses;
    document.getElementById("busCount").textContent =
        manageableBuses.length + (manageableBuses.length === 1 ? " schedule" : " schedules");
    document.getElementById("dashboardScheduleCount").textContent = String(manageableBuses.length);
    document.getElementById("dashboardActiveCount").textContent = String(
        manageableBuses.filter(function(bus) {
            return bus.isActive && bus.availableSeats > 0 && isTripUpcoming(bus);
        }).length
    );
    document.getElementById("dashboardSeatCount").textContent = String(
        manageableBuses.filter(function(bus) {
            return bus.isActive && isTripUpcoming(bus);
        })
            .reduce(function(total, bus) { return total + bus.availableSeats; }, 0)
    );

    if (manageableBuses.length === 0) {
        addEmptyMessage(busList, "No schedules yet. Add a bus above to make it bookable.");
        return;
    }

    const searchTerm = normalizedText(document.getElementById("scheduleSearch").value);
    const requestedStatus = document.getElementById("scheduleStatusFilter").value;
    const filteredBuses = manageableBuses.filter(function(bus) {
        const searchable = [
            bus.name,
            bus.company,
            bus.from,
            bus.to,
            routeUtils.parseStops(bus.intermediateStops).join(" ")
        ].join(" ").toLocaleLowerCase();
        return (!searchTerm || searchable.includes(searchTerm)) &&
            (requestedStatus === "all" || scheduleStatus(bus) === requestedStatus);
    });
    if (!filteredBuses.length) {
        addEmptyMessage(busList, "No schedules match these filters.");
        return;
    }

    filteredBuses.forEach(function(bus) {
        const card = makeElement("article", "record-card schedule-card");
        const top = makeElement("div", "record-topline");
        top.appendChild(makeElement("h3", "", bus.name));
        const category = scheduleStatus(bus);
        const availabilityText = bus.isCancelled
            ? "Trip cancelled · reservations cancelled"
            : !bus.isActive
                ? "Hidden from passengers"
            : category === "completed"
                ? "Completed trip"
                : bus.availableSeats === 0
                    ? "Full · 0 seats remaining"
                    : bus.availableSeats + " seats remaining · " + bus.totalSeats + " total";
        top.appendChild(makeElement("span", "availability", availabilityText));

        const company = makeElement("div", "company-brand record-company-brand");
        const logo = makeCompanyLogo(bus, "company-logo");
        if (logo) company.appendChild(logo);
        company.appendChild(makeElement("p", "record-company", bus.company || "Company not set"));
        const stops = routeUtils.parseStops(bus.intermediateStops);
        const estimatedArrival = getEstimatedArrival(bus);
        const scheduleText = bus.from && bus.to && bus.date && bus.departureTime
            ? bus.routeDistanceKm > 0
                ? routeUtils.formatRoute(bus.from, bus.to) +
                    (stops.length ? "\nVia " + stops.join(" · ") : "") +
                    "\n" + formatDate(bus.date) + " at " + bus.departureTime +
                    " | " + bus.routeDistanceKm + " km" +
                    (bus.estimatedDurationMinutes
                        ? " | About " + formatDuration(bus.estimatedDurationMinutes) +
                            (estimatedArrival
                                ? " | Est. arrival " +
                                    (estimatedArrival.date === bus.date
                                        ? estimatedArrival.time
                                        : formatDate(estimatedArrival.date) + " at " + estimatedArrival.time)
                                : "")
                        : "") +
                    " | " + formatFare(bus.fare) + " per passenger"
                : routeUtils.formatRoute(bus.from, bus.to) + "\n" + formatDate(bus.date) +
                    " | Add a new schedule with route distance to apply RURA fares."
            : "Older bus record: add a new schedule to make this bus bookable.";
        const details = makeElement("p", "record-details", scheduleText);
        card.append(top, company, details);

        if (!currentUser) {
            const signInMessage = makeElement("p", "muted-label", "Sign in to manage schedules.");
            card.appendChild(signInMessage);
        } else if (companyPortalStatus &&
            ["owner", "manager"].includes(companyPortalStatus.company_role)) {
            const actions = makeElement("div", "record-actions");
            const editButton = makeElement("button", "button button-text", "Edit schedule");
            editButton.type = "button";
            editButton.disabled = bus.isCancelled;
            editButton.addEventListener("click", function() {
                editSchedule(bus);
            });
            const visibilityButton = makeElement("button", "button button-text",
                bus.isCancelled ? "Trip cancelled" : bus.isActive ? "Hide schedule" : "Show schedule");
            visibilityButton.type = "button";
            visibilityButton.disabled = bus.isCancelled;
            if (!bus.isCancelled) {
                visibilityButton.addEventListener("click", function() {
                    setScheduleActive(bus.id, !bus.isActive);
                });
            }
            const cancelButton = makeElement("button", "button button-danger", "Cancel trip");
            cancelButton.type = "button";
            cancelButton.disabled = bus.isCancelled || !isTripUpcoming(bus);
            cancelButton.addEventListener("click", function() {
                cancelSchedule(bus.id);
            });
            const removeButton = makeElement("button", "button button-danger", "Remove schedule");
            removeButton.type = "button";
            removeButton.addEventListener("click", function() {
                removeSchedule(bus.id);
            });
            const manifestButton = makeElement("button", "button button-print", "Download passenger manifest");
            manifestButton.type = "button";
            manifestButton.addEventListener("click", function() {
                try {
                    downloadPassengerManifest(bus);
                } catch (error) {
                    document.getElementById("busMessage").textContent =
                        error.message || "Could not download the passenger manifest.";
                }
            });
            actions.append(editButton, visibilityButton, cancelButton, removeButton, manifestButton);
            card.appendChild(actions);
        } else {
            card.appendChild(makeElement("p", "muted-label", "Cashier access is view-only for schedules."));
        }
        busList.appendChild(card);
    });
}

document.getElementById("scheduleSearch").addEventListener("input", renderBuses);
document.getElementById("scheduleStatusFilter").addEventListener("change", renderBuses);
document.getElementById("bookingSearch").addEventListener("input", renderBookings);
document.getElementById("bookingStatusFilter").addEventListener("change", renderBookings);

async function setScheduleActive(busId, isActive) {
    const bus = buses.find(function(item) { return item.id === busId; });
    if (!currentUser || !bus || bus.companyId !== currentUser.id || bus.isCancelled) return;

    try {
        await window.WaylineDatabase.setScheduleActive(busId, isActive);
        await refreshAppData();
    } catch (error) {
        document.getElementById("busMessage").textContent =
            error.message || "Could not update the schedule. Please try again.";
        return;
    }

    document.getElementById("busMessage").textContent = isActive
        ? "Schedule is visible to passengers again."
        : "Schedule hidden from passengers. Its records and bookings are kept.";
    if (document.getElementById("date").value) performSearch();
}

async function cancelSchedule(busId) {
    const bus = buses.find(function(item) { return item.id === busId; });
    if (!currentUser || !bus || bus.companyId !== currentUser.id || bus.isCancelled) return;
    if (!window.confirm(
        "Cancel " + bus.name + " on " + formatDate(bus.date) + "? All existing reservations will be cancelled and seats released. Passengers will not be notified automatically; contact them directly about the cancelled trip or refunds. This cannot be undone."
    )) return;

    try {
        await window.WaylineDatabase.cancelSchedule(busId);
        await refreshAppData();
        document.getElementById("busMessage").textContent =
            "Trip cancelled. Existing reservations were cancelled and seats released. Contact affected passengers directly.";
        if (document.getElementById("date").value) performSearch();
    } catch (error) {
        document.getElementById("busMessage").textContent =
            error.message || "Could not cancel this trip. Please try again.";
    }
}

async function removeSchedule(busId) {
    const bus = buses.find(function(item) { return item.id === busId; });
    if (!currentUser || !bus || bus.companyId !== currentUser.id) return;
    if (!window.confirm("Permanently remove " + bus.name + "? Schedules with ticket records cannot be removed.")) return;

    try {
        await window.WaylineDatabase.removeSchedule(busId);
        await refreshAppData();
        document.getElementById("busMessage").textContent = "Schedule permanently removed.";
        if (document.getElementById("date").value) performSearch();
    } catch (error) {
        document.getElementById("busMessage").textContent =
            error.message || "Could not remove the schedule. Please try again.";
    }
}

searchForm.addEventListener("submit", function(event) {
    event.preventDefault();
    searchMessage.textContent = "";
    document.getElementById("noResultsActions").hidden = true;
    performSearch();
});

function adjustSearchDate(days) {
    const dateInput = document.getElementById("date");
    if (!dateInput.value) return;
    const date = new Date(dateInput.value + "T12:00:00");
    date.setDate(date.getDate() + days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    dateInput.value = year + "-" + month + "-" + day;
    performSearch();
}

document.getElementById("searchPreviousDay").addEventListener("click", function() {
    adjustSearchDate(-1);
});

document.getElementById("searchNextDay").addEventListener("click", function() {
    adjustSearchDate(1);
});

document.getElementById("searchPopularRoutes").addEventListener("click", function(event) {
    event.preventDefault();
    const popularRoutes = document.getElementById("popularRoutes");
    if (popularRoutes.hidden) {
        document.querySelector(".planned-route-list")?.scrollIntoView({ block: "start" });
    } else {
        popularRoutes.scrollIntoView({ block: "start" });
    }
});

const searchSummary = document.getElementById("searchSummary");
const searchSummaryText = document.getElementById("searchSummaryText");
const changeSearchButton = document.getElementById("changeSearch");

function collapseSearchForm(from, to, date, requestedSeats) {
    searchForm.hidden = true;
    searchSummary.hidden = false;
    const passengerLabel = requestedSeats === 1 ? "1 passenger" : requestedSeats + " passengers";
    searchSummaryText.textContent =
        routeUtils.formatRoute(from, to) + " · " + formatDate(date) + " · " + passengerLabel;
}

function expandSearchForm() {
    searchForm.hidden = false;
    searchSummary.hidden = true;
    setBookingProgress(1);
    window.requestAnimationFrame(function() {
        document.getElementById("from").focus({ preventScroll: true });
    });
}

changeSearchButton.addEventListener("click", expandSearchForm);

function setBookingProgress(step) {
    document.querySelectorAll("[data-booking-step]").forEach(function(item) {
        const isCurrent = Number(item.dataset.bookingStep) === step;
        item.classList.toggle("is-current", isCurrent);
        if (isCurrent) {
            item.setAttribute("aria-current", "step");
        } else {
            item.removeAttribute("aria-current");
        }
    });
}

heroSearchForm.addEventListener("submit", function(event) {
    event.preventDefault();
    const count = Number(document.getElementById("heroPassengers").value);
    const names = Array.from(document.querySelectorAll("#heroPassengerNames input")).map(function(input) {
        return input.value.trim();
    });
    if (!validatePassengerNames(names, count)) {
        const firstInvalid = Array.from(document.querySelectorAll("#heroPassengerNames input")).find(function(input) {
            return !input.value.trim();
        });
        if (firstInvalid) {
            firstInvalid.setCustomValidity("Enter this passenger's full name.");
            firstInvalid.reportValidity();
            firstInvalid.focus();
        }
        return;
    }
    passengerNames = names;
    try {
        sessionStorage.setItem("wayline-passenger-names", JSON.stringify(passengerNames));
    } catch (error) {
        console.error("Could not save passenger names for refresh.", error);
    }
    document.getElementById("from").value = document.getElementById("heroFrom").value.trim();
    document.getElementById("to").value = document.getElementById("heroTo").value.trim();
    document.getElementById("date").value = document.getElementById("heroDate").value;
    document.getElementById("seatCount").value = document.getElementById("heroPassengers").value;
    companyFilter.value = "";
    navigateToPage("booking");
    window.requestAnimationFrame(function() {
        searchForm.requestSubmit();
    });
});

const heroPassengers = document.getElementById("heroPassengers");
const heroPassengerNames = document.getElementById("heroPassengerNames");
let heroNameDrafts = passengerNames.slice();

function syncHeroPassengerFields() {
    const count = Number(heroPassengers.value);
    if (!Number.isInteger(count) || count < 1) return;
    const safeCount = Math.min(count, 20);
    Array.from(heroPassengerNames.querySelectorAll("input")).forEach(function(input, index) {
        heroNameDrafts[index] = input.value;
    });
    heroPassengerNames.replaceChildren();
    for (let index = 1; index <= safeCount; index++) {
        const field = document.createElement("div");
        field.className = "field hero-passenger-field";
        const label = document.createElement("label");
        label.htmlFor = "heroPassengerName" + index;
        label.textContent = "Passenger " + index + " full name";
        const input = document.createElement("input");
        input.type = "text";
        input.id = "heroPassengerName" + index;
        input.name = "heroPassengerName" + index;
        input.autocomplete = "name";
        input.maxLength = 80;
        input.required = true;
        input.placeholder = "Passenger " + index + " full name";
        input.value = heroNameDrafts[index - 1] || (passengerNames[index - 1] || "");
        input.addEventListener("input", function() {
            heroNameDrafts[index - 1] = input.value;
            input.setCustomValidity("");
        });
        field.append(label, input);
        heroPassengerNames.appendChild(field);
    }
}

heroPassengers.addEventListener("change", syncHeroPassengerFields);
heroPassengers.addEventListener("input", syncHeroPassengerFields);
syncHeroPassengerFields();

document.getElementById("homeRouteHighlights").addEventListener("click", function(event) {
    const route = event.target.closest(".home-route-card");
    if (!route) return;
    document.getElementById("heroFrom").value = route.dataset.from;
    document.getElementById("heroTo").value = route.dataset.to;
    document.getElementById("heroDate").value = route.dataset.date;
    document.getElementById("heroPassengers").value = "1";
    heroSearchForm.requestSubmit();
});

busForm.addEventListener("submit", async function(event) {
    event.preventDefault();
    if (!currentUser) {
        document.getElementById("busMessage").textContent =
            "Create and verify a company account, then sign in to publish schedules.";
        return;
    }
    const company = document.getElementById("company").value.trim();
    const name = document.getElementById("busName").value.trim();
    const from = document.getElementById("busFrom").value.trim();
    const to = document.getElementById("busTo").value.trim();
    const date = document.getElementById("busDate").value;
    const plateNumber = document.getElementById("busPlateNumber").value.trim();
    const insuranceExpiry = document.getElementById("busInsuranceExpiry").value;
    const technicalInspectionExpiry = document.getElementById("busInspectionExpiry").value;
    const departureTime = document.getElementById("departureTime").value;
    const totalSeats = Number(document.getElementById("seatNumber").value);
    const routeDistanceKm = Number(document.getElementById("routeDistance").value);
    const estimatedDurationMinutes = Number(document.getElementById("estimatedDuration").value);
    const intermediateStops = routeUtils.parseStops(
        document.getElementById("intermediateStops").value
    ).join(", ");
    const enteredSegmentDistances = routeSegmentDistancesInput.value.trim();
    const fareCategory = document.getElementById("fareCategory").value;
    const logoFile = document.getElementById("companyLogo").files[0];
    const busMessage = document.getElementById("busMessage");

    if (!company || !name || !from || !to || !date || !departureTime) {
        busMessage.textContent = "Complete every schedule field with a value.";
        return;
    }
    if (routeUtils.normalizeCity(from) === routeUtils.normalizeCity(to)) {
        busMessage.textContent = "Choose two different cities for the bus route.";
        return;
    }
    const rwandaNow = getRwandaDateTime();
    if (!plateNumber || !insuranceExpiry || !technicalInspectionExpiry ||
        insuranceExpiry < date || technicalInspectionExpiry < date ||
        insuranceExpiry < rwandaNow.date || technicalInspectionExpiry < rwandaNow.date) {
        busMessage.textContent = "Enter the vehicle plate and insurance and technical inspection expiry dates covering the trip.";
        return;
    }
    if (date < rwandaNow.date || (date === rwandaNow.date && departureTime <= rwandaNow.time)) {
        busMessage.textContent = "A bus departure must be in the future in Rwanda time.";
        return;
    }
    if (!Number.isInteger(totalSeats) || totalSeats < 1 || totalSeats > 100 ||
        !Number.isFinite(routeDistanceKm) || routeDistanceKm < 0.1 || routeDistanceKm > 1000 ||
        (document.getElementById("estimatedDuration").value &&
            (!Number.isInteger(estimatedDurationMinutes) || estimatedDurationMinutes < 1 || estimatedDurationMinutes > 1440)) ||
        !ruraFarePerKm[fareCategory]) {
        busMessage.textContent = "Enter 1 to 100 seats, a route distance from 0.1 to 1,000 km, and a RURA fare area.";
        return;
    }
    if (!document.getElementById("routeActualChecked").checked) {
        busMessage.textContent = "Check the actual bus route and confirm it before publishing the fare.";
        document.getElementById("routeActualChecked").focus();
        return;
    }
    let routeSegments = null;
    if (enteredSegmentDistances) {
        const distances = enteredSegmentDistances.split(/[;,\n]/).map(function(value) {
            return Number(value.trim());
        });
        routeSegments = routeUtils.buildRouteSegments(from, to, intermediateStops, distances);
        if (!routeSegments) {
            busMessage.textContent = "Enter one valid distance from 0.1 to 1,000 km for every consecutive route leg.";
            routeSegmentDistancesInput.focus();
            return;
        }
        const segmentDistanceTotal = routeSegments.reduce(function(total, segment) {
            return total + segment.distanceKm;
        }, 0);
        if (Math.abs(segmentDistanceTotal - routeDistanceKm) > 0.1) {
            busMessage.textContent = "The leg distances must add up to the verified full-route distance.";
            routeSegmentDistancesInput.focus();
            return;
        }
    } else if (editingBus && (editingBus.routeSegments || []).length) {
        routeSegments = [];
    }
    const editingBus = editingBusId
        ? buses.find(function(item) { return item.id === editingBusId; })
        : null;
    if (editingBus && totalSeats < editingBus.totalSeats - editingBus.availableSeats) {
        busMessage.textContent = "Total seats cannot be lower than the " +
            (editingBus.totalSeats - editingBus.availableSeats) + " seats already reserved.";
        return;
    }
    const hasBookings = editingBus && bookings.some(function(booking) {
        return booking.busId === editingBus.id;
    });
    const itineraryChanged = editingBus && (
        name !== editingBus.name ||
        from !== editingBus.from ||
        to !== editingBus.to ||
        date !== editingBus.date ||
        departureTime !== editingBus.departureTime
    );
    if (hasBookings && itineraryChanged && !window.confirm(
        "This schedule has existing reservations. They will be kept with their original booking details. Contact affected passengers directly using the passenger manifest. Continue with these changes?"
    )) {
        return;
    }
    if (logoFile && !["image/png", "image/jpeg", "image/webp"].includes(logoFile.type)) {
        busMessage.textContent = "Choose a PNG, JPG, or WebP image for the company logo.";
        return;
    }
    if (logoFile && logoFile.size > 2 * 1024 * 1024) {
        busMessage.textContent = "The company image must be 2 MB or smaller.";
        return;
    }

    let logo = "";
    if (logoFile) {
        try {
            logo = await resizeCompanyLogo(logoFile);
        } catch (error) {
            busMessage.textContent = error.message;
            return;
        }
    }

    const bus = {
        company: company,
        name: name,
        from: routeUtils.canonicalCity(from),
        to: routeUtils.canonicalCity(to),
        date: date,
        plateNumber: plateNumber,
        insuranceExpiry: insuranceExpiry,
        technicalInspectionExpiry: technicalInspectionExpiry,
        departureTime: departureTime,
        totalSeats: totalSeats,
        routeDistanceKm: routeDistanceKm,
        estimatedDurationMinutes: estimatedDurationMinutes || 0,
        intermediateStops: intermediateStops,
        fareCategory: fareCategory,
        routeSegments: routeSegments
    };
    try {
        if (editingBusId) {
            await window.WaylineDatabase.updateSchedule(editingBusId, bus, logo);
        } else {
            const savedBus = await window.WaylineDatabase.createSchedule(bus, logo);
            buses.unshift(savedBus);
        }
        if (logo) setCompanyProfilePicture(logo);
        document.getElementById("dashboardCompanyName").textContent = company;
        document.getElementById("dashboardWelcome").textContent = "Welcome back, " + company;
        await refreshAppData();
    } catch (error) {
        busMessage.textContent = error.message ||
            (editingBusId ? "Could not update this schedule. Please try again." : "Could not save this schedule. Please try again.");
        return;
    }

    const wasEditing = Boolean(editingBusId);
    resetScheduleEditor();
    busMessage.textContent = wasEditing
        ? hasBookings
            ? "Schedule updated. Existing reservations were kept with their original booking details. Contact affected passengers directly."
            : "Schedule updated. The fare is recalculated using the selected RURA tariff."
        : "Bus schedule added. The fare is calculated automatically using the RURA tariff.";
    updateCompanyOptions();
    if (document.getElementById("date").value) performSearch();
});

const recoveryError = new URLSearchParams(window.location.hash.slice(1));
if (recoveryError.get("error_code") === "otp_expired") {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    showPartnerLoginForm();
    setPartnerFormMode(false);
    loginMessage.textContent =
        "This email link has expired or was already used. Request a fresh confirmation or password-reset email, then open the newest link once. Use Create a company account for email confirmation or Forgot your password for a reset.";
    partnerLoginScreen.showModal();
}

initializeApp().catch(function(error) {
    setPartnerPreview(false);
    searchMessage.textContent =
        "Could not connect to the shared booking database. Check your internet connection and reload the page.";
    console.error(error);
});