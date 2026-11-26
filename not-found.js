const homeUrl = new URL("/bus-ticket-demo/", window.location.origin);
homeUrl.search = window.location.search;
homeUrl.hash = window.location.hash;
document.getElementById("homeLink").href = homeUrl.href;

const query = new URLSearchParams(window.location.search);
const fragment = new URLSearchParams(window.location.hash.slice(1));
if (query.get("error_code") === "otp_expired" || fragment.get("error_code") === "otp_expired") {
    document.getElementById("status").textContent = "EMAIL LINK EXPIRED";
    document.getElementById("title").textContent = "This email link has expired.";
    document.getElementById("message").textContent =
        "Email links can only be used once and may expire. Return to Wayline, request a fresh confirmation or password-reset email, and open the newest link.";
}
