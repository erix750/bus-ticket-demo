(function() {
    const menuButton = document.getElementById("siteMenuToggle");
    const menuPanel = document.getElementById("siteMenuPanel");
    if (!menuButton || !menuPanel) return;

    const themeToggle = document.getElementById("themeToggle");
    const themeIcon = document.getElementById("themeToggleIcon");
    const themeColor = document.querySelector('meta[name="theme-color"]');
    let activeTheme = "light";

    try {
        activeTheme = localStorage.getItem("wayline-theme") === "dark" ? "dark" : "light";
    } catch (error) {
        console.error("Could not read the Wayline color theme preference.", error);
    }

    function setTheme(theme, persist) {
        activeTheme = theme === "dark" ? "dark" : "light";
        const isDark = activeTheme === "dark";
        document.documentElement.dataset.theme = activeTheme;
        if (themeToggle) {
            themeToggle.setAttribute("aria-pressed", String(isDark));
            themeToggle.setAttribute("aria-label", "Dark mode");
            themeToggle.title = "Dark mode";
        }
        if (themeIcon) themeIcon.textContent = isDark ? "☀" : "☾";
        if (themeColor) themeColor.content = isDark ? "#0d1620" : "#173f70";
        if (persist) {
            try {
                localStorage.setItem("wayline-theme", activeTheme);
            } catch (error) {
                console.error("Could not save the Wayline color theme preference.", error);
            }
        }
    }

    function closeMenu(restoreFocus) {
        if (menuPanel.hidden) return;
        menuPanel.hidden = true;
        menuButton.setAttribute("aria-expanded", "false");
        if (restoreFocus) menuButton.focus();
    }

    function updateCurrentPage() {
        const path = window.location.pathname.toLowerCase();
        const fragment = window.location.hash.slice(1);
        const homePage = path.endsWith("/") || path.endsWith("/index.html");
        const currentPage = path.endsWith("/admin.html")
            ? "company"
            : path.endsWith("/booking.html")
                ? "booking"
                : ["home", "booking", "company", "about", "contact"].includes(fragment)
                    ? fragment
                    : homePage ? "home" : "";
        menuPanel.querySelectorAll("[data-site-page], [data-page-link]").forEach(function(link) {
            const page = link.dataset.sitePage || link.dataset.pageLink;
            const isCurrent = page === currentPage;
            link.classList.toggle("is-active", isCurrent);
            if (isCurrent) link.setAttribute("aria-current", "page");
            else link.removeAttribute("aria-current");
        });
    }

    setTheme(activeTheme, false);
    updateCurrentPage();
    window.addEventListener("hashchange", updateCurrentPage);

    menuButton.addEventListener("click", function() {
        const willOpen = menuPanel.hidden;
        menuPanel.hidden = !willOpen;
        menuButton.setAttribute("aria-expanded", String(willOpen));
        if (willOpen) {
            const firstLink = menuPanel.querySelector("a[href]");
            firstLink?.focus();
        } else {
            menuButton.focus();
        }
    });

    document.addEventListener("pointerdown", function(event) {
        if (!menuPanel.hidden && !event.target.closest(".site-header")) {
            const clickedControl = event.target.closest(
                "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1']), label[for], [contenteditable='true']"
            );
            closeMenu(false);
            if (!clickedControl) window.setTimeout(function() { menuButton.focus(); }, 0);
        }
    });

    document.addEventListener("keydown", function(event) {
        if (event.key === "Escape" && !menuPanel.hidden) {
            event.preventDefault();
            closeMenu(true);
        }
    });

    menuPanel.addEventListener("click", function(event) {
        const link = event.target.closest("a[href]");
        if (link) closeMenu(true);
    });

    themeToggle?.addEventListener("click", function() {
        setTheme(activeTheme === "dark" ? "light" : "dark", true);
    });
})();
