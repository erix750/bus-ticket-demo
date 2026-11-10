document.querySelectorAll("[data-current-year]").forEach(function(element) {
    const year = String(new Date().getFullYear());
    element.textContent = year;
    element.setAttribute("datetime", year);
});
