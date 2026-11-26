const adminDatabase = window.WaylineDatabase;
const adminLoginPanel = document.getElementById("adminLoginPanel");
const adminDashboard = document.getElementById("adminDashboard");
const adminLoginMessage = document.getElementById("adminLoginMessage");
const adminDashboardMessage = document.getElementById("adminDashboardMessage");
const adminMfaPanel = document.getElementById("adminMfaPanel");
let adminClient;
let adminMfaFactorId = null;
let adminMfaSetupFactorId = null;

function setAdminView(isAdmin) {
    adminLoginPanel.hidden = isAdmin;
    adminDashboard.hidden = !isAdmin;
    adminMfaPanel.hidden = true;
}

function showAdminMfa(mode, message) {
    adminLoginPanel.hidden = true;
    adminDashboard.hidden = true;
    adminMfaPanel.hidden = false;
    document.getElementById("adminMfaEnrollPrompt").hidden = mode !== "enroll";
    document.getElementById("adminMfaEnrollSetup").hidden = mode !== "enroll-code";
    document.getElementById("adminMfaChallengeForm").hidden = mode !== "challenge";
    document.getElementById("adminMfaMessage").textContent = message || "";
}

async function prepareAdminMfa() {
    const factorsResult = await adminClient.auth.mfa.listFactors();
    if (factorsResult.error) throw new Error(factorsResult.error.message);
    const verifiedFactor = (factorsResult.data.totp || []).find(function(factor) {
        return factor.status === "verified";
    });
    if (verifiedFactor) {
        adminMfaFactorId = verifiedFactor.id;
        showAdminMfa("challenge", "Administrator access requires a verified authenticator factor.");
        return;
    }
    showAdminMfa("enroll", "Set up an authenticator before accessing administrator features.");
}

async function verifyAdminMfaCode(factorId, code) {
    const challengeResult = await adminClient.auth.mfa.challenge({ factorId: factorId });
    if (challengeResult.error) throw new Error(challengeResult.error.message);
    const verifyResult = await adminClient.auth.mfa.verify({
        factorId: factorId,
        challengeId: challengeResult.data.id,
        code: code
    });
    if (verifyResult.error) throw new Error(verifyResult.error.message);
}

function appendText(parent, tagName, text, className) {
    const element = document.createElement(tagName);
    element.textContent = text || "";
    if (className) element.className = className;
    parent.appendChild(element);
    return element;
}

function formatAdminDate(value) {
    if (!value) return "Not available";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

function addDocumentButton(parent, path, label) {
    if (!path) {
        appendText(parent, "span", "Not provided", "field-hint");
        return;
    }

    const button = document.createElement("button");
    button.className = "button button-secondary";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async function() {
        const downloadWindow = window.open("about:blank", "_blank");
        if (!downloadWindow) {
            adminDashboardMessage.textContent = "Allow pop-ups to open a secure company document.";
            return;
        }
        downloadWindow.opener = null;
        button.disabled = true;
        adminDashboardMessage.textContent = "";
        try {
            const url = await adminDatabase.getCompanyDocumentUrl(path);
            downloadWindow.location.replace(url);
        } catch (error) {
            downloadWindow.close();
            adminDashboardMessage.textContent = error.message || "Could not create a secure document link.";
        } finally {
            button.disabled = false;
        }
    });
    parent.appendChild(button);
}

function addReviewAction(actions, application, status, label, notes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = status === "approved" ? "button button-primary" : "button button-secondary";
    button.textContent = label;
    button.addEventListener("click", async function() {
        const note = notes.value.trim();
        if (["under_review", "rejected", "suspended"].includes(status) && note.length < 3) {
            notes.setCustomValidity("Add a short reason or request before changing this status.");
            notes.reportValidity();
            return;
        }
        notes.setCustomValidity("");
        button.disabled = true;
        adminDashboardMessage.textContent = "";
        try {
            if (status === "suspended") {
                await adminDatabase.setCompanyAccessStatus(application.company_id, status, note);
            } else {
                await adminDatabase.reviewCompanyApplication(application.id, status, note);
            }
            adminDashboardMessage.textContent = application.company_name + " was updated to " + status.replace("_", " ") + ".";
            await loadAdminDashboard();
        } catch (error) {
            adminDashboardMessage.textContent = error.message || "Could not update this application.";
        } finally {
            button.disabled = false;
        }
    });
    actions.appendChild(button);
}

function renderApplication(application) {
    const card = document.createElement("article");
    card.className = "admin-application-card";
    const heading = document.createElement("div");
    heading.className = "admin-application-heading";
    appendText(heading, "h3", application.company_name);
    const badge = appendText(heading, "span", application.status.replace("_", " "), "status-badge");
    badge.dataset.status = application.status;
    card.appendChild(heading);

    const details = document.createElement("dl");
    details.className = "admin-application-details";
    [
        ["Representative", application.representative_name],
        ["Official email", application.official_email],
        ["Contact phone", application.contact_phone],
        ["Address", application.company_address],
        ["Location", application.company_location],
        ["RDB registration", application.rdb_registration_number || application.business_registration],
        ["TIN", application.tin],
        ["Transport licence number", application.transport_license_number],
        ["Licence type", application.transport_license_type],
        ["Licence issued", formatAdminDate(application.transport_license_issue_date)],
        ["Licence expires", formatAdminDate(application.transport_license_expiry_date)],
        ["Allowed routes / areas", application.allowed_routes_areas],
        ["Verified by", application.verification_reviewer_name],
        ["Verification date", formatAdminDate(application.verification_date)],
        ["Submitted", formatAdminDate(application.submitted_at)]
    ].forEach(function(entry) {
        const row = document.createElement("div");
        appendText(row, "dt", entry[0]);
        appendText(row, "dd", entry[1] || "Not provided");
        details.appendChild(row);
    });
    card.appendChild(details);

    const documents = document.createElement("div");
    documents.className = "admin-document-actions";
    addDocumentButton(documents, application.business_document_path, "Open business registration");
    addDocumentButton(
        documents,
        application.transport_license_path,
        "Open transport licence"
    );
    addDocumentButton(documents, application.representative_id_document_path, "Open representative ID");
    card.appendChild(documents);

    const expiry = application.transport_license_expiry_date;
    if (expiry) {
        const daysRemaining = Math.floor(
            (new Date(expiry + "T00:00:00Z").getTime() - new Date().setUTCHours(0, 0, 0, 0)) / 86400000
        );
        if (daysRemaining <= 30) {
            appendText(
                card,
                "p",
                daysRemaining < 0
                    ? "Licence expired " + Math.abs(daysRemaining) + " days ago. Company selling is blocked."
                    : "Licence expires in " + daysRemaining + " days.",
                "license-expiry-warning"
            );
        }
    } else {
        appendText(card, "p", "No current structured licence record; company selling is blocked.", "license-expiry-warning");
    }

    const checklist = document.createElement("fieldset");
    checklist.className = "admin-verification-checklist";
    appendText(checklist, "legend", "Manual verification checklist");
    [
        ["registration_checked", "Registration checked against RDB"],
        ["tin_valid", "TIN checked and valid"],
        ["rura_license_valid", "RURA transport licence checked and valid"],
        ["documents_match", "Documents match the company and representative"]
    ].forEach(function(item) {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = item[0];
        input.checked = application[item[0]] === true;
        label.append(input, document.createTextNode(item[1]));
        checklist.appendChild(label);
    });
    const saveChecklistButton = document.createElement("button");
    saveChecklistButton.type = "button";
    saveChecklistButton.className = "button button-secondary";
    saveChecklistButton.textContent = "Save verification checklist";
    saveChecklistButton.addEventListener("click", async function() {
        saveChecklistButton.disabled = true;
        adminDashboardMessage.textContent = "";
        try {
            await adminDatabase.saveCompanyVerificationChecklist(application.id, {
                    registrationChecked: checklist.querySelector('[name="registration_checked"]').checked,
                    tinValid: checklist.querySelector('[name="tin_valid"]').checked,
                    ruraLicenseValid: checklist.querySelector('[name="rura_license_valid"]').checked,
                    documentsMatch: checklist.querySelector('[name="documents_match"]').checked
            });
            adminDashboardMessage.textContent = "Verification checklist saved. Approval still requires all four checks and a current licence.";
            await loadAdminDashboard();
        } catch (error) {
            adminDashboardMessage.textContent = error.message || "Could not save the verification checklist.";
        } finally {
            saveChecklistButton.disabled = false;
        }
    });
    checklist.appendChild(saveChecklistButton);
    card.appendChild(checklist);

    if (application.review_notes) {
        appendText(card, "p", "Previous review note: " + application.review_notes, "admin-review-note");
    }

    const notes = document.createElement("textarea");
    notes.className = "admin-review-input";
    notes.rows = 3;
    notes.maxLength = 2000;
    notes.placeholder = "Add a reason, review note, or request for additional information.";
    notes.setAttribute("aria-label", "Review note for " + application.company_name);
    notes.addEventListener("input", function() { notes.setCustomValidity(""); });
    card.appendChild(notes);

    const actions = document.createElement("div");
    actions.className = "admin-review-actions";
    if (application.status === "pending") {
        addReviewAction(actions, application, "under_review", "Mark under review", notes);
        addReviewAction(actions, application, "approved", "Approve company", notes);
        addReviewAction(actions, application, "rejected", "Reject application", notes);
    } else if (application.status === "under_review") {
        addReviewAction(actions, application, "approved", "Approve company", notes);
        addReviewAction(actions, application, "rejected", "Reject / request changes", notes);
    } else if (application.status === "rejected") {
        addReviewAction(actions, application, "under_review", "Review resubmission", notes);
        addReviewAction(actions, application, "approved", "Approve company", notes);
    } else if (application.status === "approved") {
        addReviewAction(actions, application, "suspended", "Suspend company", notes);
    } else if (application.status === "suspended") {
        addReviewAction(actions, application, "approved", "Reactivate company", notes);
    }
    card.appendChild(actions);
    return card;
}

function renderCompanyAccount(company) {
    const card = document.createElement("article");
    card.className = "admin-application-card";
    const heading = document.createElement("div");
    heading.className = "admin-application-heading";
    appendText(heading, "h3", company.name);
    const licenseCurrent = company.wayline_verified === true &&
        company.transport_license_valid_until &&
        company.transport_license_valid_until >= new Date().toISOString().slice(0, 10);
    const badge = appendText(
        heading,
        "span",
        licenseCurrent ? "verified" : "unverified · schedules blocked",
        "status-badge"
    );
    badge.dataset.status = company.approval_status;
    card.appendChild(heading);
    appendText(card, "p", "Company account: " + company.id, "field-hint");
    if (company.transport_license_valid_until) {
        const daysRemaining = Math.floor(
            (new Date(company.transport_license_valid_until + "T00:00:00Z").getTime() -
                new Date().setUTCHours(0, 0, 0, 0)) / 86400000
        );
        if (daysRemaining <= 30) {
            appendText(card, "p", daysRemaining < 0
                ? "Licence expired. Ticket sales are blocked."
                : "Licence expires in " + daysRemaining + " days.", "license-expiry-warning");
        }
    }

    const notes = document.createElement("textarea");
    notes.className = "admin-review-input";
    notes.rows = 2;
    notes.maxLength = 2000;
    notes.placeholder = company.approval_status === "approved"
        ? "Required reason for suspension."
        : "Optional reactivation note.";
    notes.setAttribute("aria-label", "Access-management note for " + company.name);
    const actions = document.createElement("div");
    actions.className = "admin-review-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.className = company.approval_status === "approved"
        ? "button button-secondary"
        : "button button-primary";
    button.textContent = company.approval_status === "approved" ? "Suspend company" : "Reactivate company";
    button.addEventListener("click", async function() {
        const status = company.approval_status === "approved" ? "suspended" : "approved";
        const reason = notes.value.trim();
        if (status === "suspended" && reason.length < 3) {
            notes.setCustomValidity("Add a suspension reason of at least 3 characters.");
            notes.reportValidity();
            return;
        }
        notes.setCustomValidity("");
        button.disabled = true;
        adminDashboardMessage.textContent = "";
        try {
            await adminDatabase.setCompanyAccessStatus(company.id, status, reason);
            adminDashboardMessage.textContent = company.name + " was " +
                (status === "suspended" ? "suspended." : "reactivated.");
            await loadAdminDashboard();
        } catch (error) {
            adminDashboardMessage.textContent = error.message || "Could not change company access.";
        } finally {
            button.disabled = false;
        }
    });
    actions.appendChild(button);
    card.append(notes, actions);
    return card;
}

function renderActivity(entry) {
    const row = document.createElement("article");
    row.className = "admin-activity-row";
    appendText(row, "strong", entry.event_type.replace(/_/g, " "));
    appendText(row, "time", formatAdminDate(entry.created_at));
    appendText(row, "p", "Company: " + (entry.company_id || "System") +
        (entry.actor_id ? " · Actor: " + entry.actor_id : ""));
    if (entry.details && Object.keys(entry.details).length) {
        appendText(row, "code", JSON.stringify(entry.details));
    }
    return row;
}

function renderCompanyReport(report) {
    const card = document.createElement("article");
    card.className = "admin-application-card";
    const heading = document.createElement("div");
    heading.className = "admin-application-heading";
    appendText(heading, "h3", report.category + " report");
    const badge = appendText(heading, "span", report.status, "status-badge");
    badge.dataset.status = report.status;
    card.appendChild(heading);
    appendText(card, "p", report.details);
    appendText(card, "p", "Company: " + report.company_id + " · Booking: " + report.booking_id, "field-hint");
    appendText(card, "time", formatAdminDate(report.created_at));
    const notes = document.createElement("textarea");
    notes.className = "admin-review-input";
    notes.rows = 2;
    notes.maxLength = 2000;
    notes.placeholder = "Optional private review note.";
    notes.setAttribute("aria-label", "Private review note for " + report.id);
    card.appendChild(notes);
    const actions = document.createElement("div");
    actions.className = "admin-review-actions";
    ["reviewing", "resolved", "dismissed"].forEach(function(status) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = status === "resolved" ? "button button-primary" : "button button-secondary";
        button.textContent = status === "reviewing" ? "Mark reviewing" : status === "resolved" ? "Resolve" : "Dismiss";
        button.addEventListener("click", async function() {
            button.disabled = true;
            adminDashboardMessage.textContent = "";
            try {
                await adminDatabase.reviewCompanyReport(report.id, status, notes.value.trim());
                await loadAdminDashboard();
            } catch (error) {
                adminDashboardMessage.textContent = error.message || "Could not update this report.";
            } finally {
                button.disabled = false;
            }
        });
        actions.appendChild(button);
    });
    card.appendChild(actions);
    return card;
}

async function loadAdminDashboard() {
    adminDashboardMessage.textContent = "Loading applications and activity...";
    const results = await Promise.all([
        adminDatabase.getAdminApplications(),
        adminDatabase.getAdminCompanies(),
        adminDatabase.getAdminActivityLog(),
        adminDatabase.getAdminCompanyReports()
    ]);
    const applicationList = document.getElementById("adminApplicationList");
    const companyList = document.getElementById("adminCompanyList");
    const activityList = document.getElementById("adminActivityList");
    const reportList = document.getElementById("adminReportList");
    applicationList.replaceChildren();
    companyList.replaceChildren();
    activityList.replaceChildren();
    reportList.replaceChildren();
    if (!results[0].length) {
        appendText(applicationList, "p", "There are no submitted applications to review.", "field-hint");
    } else {
        results[0].forEach(function(application) {
            applicationList.appendChild(renderApplication(application));
        });
    }
    if (!results[1].length) {
        appendText(companyList, "p", "There are no approved or suspended company accounts.", "field-hint");
    } else {
        results[1].forEach(function(company) {
            companyList.appendChild(renderCompanyAccount(company));
        });
    }
    if (!results[2].length) {
        appendText(activityList, "p", "No recorded company activity yet.", "field-hint");
    } else {
        results[2].forEach(function(entry) {
            activityList.appendChild(renderActivity(entry));
        });
    }
    if (!results[3].length) {
        appendText(reportList, "p", "There are no passenger company reports.", "field-hint");
    } else {
        results[3].forEach(function(report) {
            reportList.appendChild(renderCompanyReport(report));
        });
    }
    adminDashboardMessage.textContent = "";
}

async function verifyAdminAndShowDashboard() {
    const assuranceResult = await adminClient.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceResult.error) throw new Error(assuranceResult.error.message);
    if (assuranceResult.data.currentLevel !== "aal2") {
        await prepareAdminMfa();
        return false;
    }

    const authorized = await adminDatabase.isWaylineAdmin();
    if (!authorized) {
        await adminDatabase.signOut();
        adminMfaPanel.hidden = true;
        setAdminView(false);
        adminLoginMessage.textContent = "This account is not authorized to access Wayline administration.";
        return false;
    }
    setAdminView(true);
    await loadAdminDashboard();
    return true;
}

document.getElementById("beginAdminMfaSetup").addEventListener("click", async function() {
    this.disabled = true;
    const message = document.getElementById("adminMfaMessage");
    message.textContent = "";
    try {
        const result = await adminClient.auth.mfa.enroll({
            factorType: "totp",
            issuer: "Wayline"
        });
        if (result.error) throw new Error(result.error.message);
        adminMfaSetupFactorId = result.data.id;
        document.getElementById("adminMfaQrCode").src = result.data.totp.qr_code;
        document.getElementById("adminMfaSecret").textContent = result.data.totp.secret;
        showAdminMfa("enroll-code", "Scan the QR code and verify a code to finish setup.");
    } catch (error) {
        message.textContent = error.message || "Could not set up administrator MFA.";
    } finally {
        this.disabled = false;
    }
});

document.getElementById("adminMfaEnrollForm").addEventListener("submit", async function(event) {
    event.preventDefault();
    const button = this.querySelector("button[type='submit']");
    button.disabled = true;
    const message = document.getElementById("adminMfaMessage");
    message.textContent = "";
    try {
        await verifyAdminMfaCode(
            adminMfaSetupFactorId,
            document.getElementById("adminMfaEnrollCode").value.trim()
        );
        await verifyAdminAndShowDashboard();
    } catch (error) {
        message.textContent = error.message || "Could not verify the authenticator code.";
    } finally {
        button.disabled = false;
    }
});

document.getElementById("adminMfaChallengeForm").addEventListener("submit", async function(event) {
    event.preventDefault();
    const button = this.querySelector("button[type='submit']");
    button.disabled = true;
    const message = document.getElementById("adminMfaMessage");
    message.textContent = "";
    try {
        await verifyAdminMfaCode(
            adminMfaFactorId,
            document.getElementById("adminMfaChallengeCode").value.trim()
        );
        await verifyAdminAndShowDashboard();
    } catch (error) {
        message.textContent = error.message || "Could not verify the authenticator code.";
    } finally {
        button.disabled = false;
    }
});

document.getElementById("adminMfaSignOut").addEventListener("click", async function() {
    this.disabled = true;
    try {
        await adminDatabase.signOut();
        adminMfaPanel.hidden = true;
        setAdminView(false);
        adminLoginMessage.textContent = "You have signed out.";
    } catch (error) {
        document.getElementById("adminMfaMessage").textContent = error.message || "Could not sign out.";
    } finally {
        this.disabled = false;
    }
});

document.getElementById("adminLoginForm").addEventListener("submit", async function(event) {
    event.preventDefault();
    const button = document.getElementById("adminSignIn");
    button.disabled = true;
    adminLoginMessage.textContent = "";
    try {
        await adminDatabase.signIn(
            document.getElementById("adminEmail").value.trim(),
            document.getElementById("adminPassword").value
        );
        await verifyAdminAndShowDashboard();
    } catch (error) {
        adminLoginMessage.textContent = error.message || "Could not sign in to the administrator portal.";
        setAdminView(false);
    } finally {
        button.disabled = false;
    }
});

document.getElementById("refreshAdminData").addEventListener("click", function() {
    loadAdminDashboard().catch(function(error) {
        adminDashboardMessage.textContent = error.message || "Could not load administrator data.";
    });
});

document.getElementById("adminSignOut").addEventListener("click", async function() {
    this.disabled = true;
    try {
        await adminDatabase.signOut();
        setAdminView(false);
        adminLoginMessage.textContent = "You have signed out.";
    } catch (error) {
        adminDashboardMessage.textContent = error.message || "Could not sign out.";
    } finally {
        this.disabled = false;
    }
});

async function initializeAdminPortal() {
    adminClient = await adminDatabase.open();
    adminClient.auth.onAuthStateChange(function(event) {
        if (event === "SIGNED_OUT") {
            setAdminView(false);
            adminLoginMessage.textContent = "Your administrator session has ended. Sign in again.";
        }
    });
    const sessionResult = await adminClient.auth.getSession();
    if (sessionResult.error) throw new Error(sessionResult.error.message);
    if (!sessionResult.data.session) {
        setAdminView(false);
        return;
    }
    await verifyAdminAndShowDashboard();
}

initializeAdminPortal().catch(function(error) {
    setAdminView(false);
    adminLoginMessage.textContent = error.message || "Could not initialize the administrator portal.";
    console.error("Could not initialize the Wayline administrator portal.", error);
});
