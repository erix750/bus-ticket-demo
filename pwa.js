(function() {
    const installButton = document.getElementById("installApp");
    if (!installButton) return;

    let installGuide = document.getElementById("installGuide");
    if (!installGuide) {
        installGuide = document.createElement("dialog");
        installGuide.className = "checkout-dialog install-dialog";
        installGuide.id = "installGuide";
        installGuide.setAttribute("aria-labelledby", "installGuideTitle");

        const content = document.createElement("div");
        content.className = "checkout-content";

        const closeButton = document.createElement("button");
        closeButton.className = "dialog-close";
        closeButton.id = "closeInstallGuide";
        closeButton.type = "button";
        closeButton.setAttribute("aria-label", "Close install instructions");
        closeButton.innerHTML = "&times;";

        const eyebrow = document.createElement("p");
        eyebrow.className = "eyebrow";
        eyebrow.textContent = "INSTALL WAYLINE";

        const title = document.createElement("h2");
        title.id = "installGuideTitle";
        title.textContent = "Add Wayline to your phone";

        const intro = document.createElement("p");
        intro.id = "installGuideIntro";
        intro.className = "checkout-route";

        const steps = document.createElement("ol");
        steps.id = "installGuideSteps";
        steps.className = "install-steps";

        const actions = document.createElement("div");
        actions.className = "checkout-actions";
        const doneButton = document.createElement("button");
        doneButton.className = "button button-primary";
        doneButton.id = "doneInstallGuide";
        doneButton.type = "button";
        doneButton.textContent = "Got it";
        actions.appendChild(doneButton);

        content.append(closeButton, eyebrow, title, intro, steps, actions);
        installGuide.appendChild(content);
        document.body.appendChild(installGuide);
    }
    const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(navigator.userAgent);
    let installPrompt = null;
    const isInstalled = window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true;

    installButton.hidden = isInstalled || !(isAppleMobile || isAndroid);

    window.addEventListener("beforeinstallprompt", function(event) {
        event.preventDefault();
        installPrompt = event;
        if (!isInstalled) installButton.hidden = false;
    });

    installButton.addEventListener("click", async function() {
        if (!installPrompt) {
            document.getElementById("installGuideIntro").textContent = isAppleMobile
                ? "On your iPhone or iPad, add this website to your Home Screen from Safari."
                : isAndroid
                    ? "On your Android phone, add this website to your Home Screen from Chrome."
                    : "Open this website in your phone browser, then use its Add to Home Screen option.";
            const steps = isAppleMobile
                ? [
                    "Open this page in Safari.",
                    "Tap the Share button (the square with an upward arrow).",
                    "Scroll down and tap Add to Home Screen, then tap Add."
                ]
                : [
                    "Open this page in Chrome.",
                    "Tap the three-dot menu in the top corner.",
                    "Tap Install app or Add to Home screen and follow the prompt."
                ];
            document.getElementById("installGuideSteps").replaceChildren(
                ...steps.map(function(step) {
                    const item = document.createElement("li");
                    item.textContent = step;
                    return item;
                })
            );
            installGuide.showModal();
            return;
        }

        installButton.disabled = true;
        try {
            await installPrompt.prompt();
            const choice = await installPrompt.userChoice;
            installPrompt = null;
            if (choice.outcome === "accepted") {
                installButton.hidden = true;
            }
        } catch (error) {
            console.error("Could not open the app installation prompt.", error);
        } finally {
            installButton.disabled = false;
        }
    });

    function closeInstallGuide() {
        installGuide.close();
    }

    document.getElementById("closeInstallGuide").addEventListener("click", closeInstallGuide);
    document.getElementById("doneInstallGuide").addEventListener("click", closeInstallGuide);

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
