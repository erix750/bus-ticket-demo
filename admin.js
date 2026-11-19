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
        ["Business registration", application.business_registration],
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
        application.license_not_applicable ? "Licence marked not applicable" : "Open transport licence"
    );
    card.appendChild(documents);

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
    const badge = appendText(heading, "span", company.approval_status, "status-badge");
    badge.dataset.status = company.approval_status;
    card.appendChild(heading);
    appendText(card, "p", "Company account: " + company.id, "field-hint");

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

async function loadAdminDashboard() {
    adminDashboardMessage.textContent = "Loading applications and activity...";
    const results = await Promise.all([
        adminDatabase.getAdminApplications(),
        adminDatabase.getAdminCompanies(),
        adminDatabase.getAdminActivityLog()
    ]);
    const applicationList = document.getElementById("adminApplicationList");
    const companyList = document.getElementById("adminCompanyList");
    const activityList = document.getElementById("adminActivityList");
    applicationList.replaceChildren();
    companyList.replaceChildren();
    activityList.replaceChildren();
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
