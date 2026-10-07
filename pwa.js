(function() {
    const installButton = document.getElementById("installApp");
    if (!installButton) return;

    let installPrompt = null;
    const isInstalled = window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true;

    if (isInstalled) installButton.hidden = true;

    window.addEventListener("beforeinstallprompt", function(event) {
        event.preventDefault();
        installPrompt = event;
        installButton.hidden = false;
    });

    installButton.addEventListener("click", async function() {
        if (!installPrompt) return;

        installButton.disabled = true;
        try {
            await installPrompt.prompt();
            const choice = await installPrompt.userChoice;
            installPrompt = null;
            if (choice.outcome === "accepted" || choice.outcome === "dismissed") {
                installButton.hidden = true;
            }
        } catch (error) {
            console.error("Could not open the app installation prompt.", error);
        } finally {
            installButton.disabled = false;
        }
    });

    window.addEventListener("appinstalled", function() {
        installPrompt = null;
        installButton.hidden = true;
    });

    if ("serviceWorker" in navigator && window.isSecureContext) {
        navigator.serviceWorker.register("./sw.js")
            .catch(function(error) {
                console.error("Could not register the Wayline offline app shell.", error);
            });
    }
})();
