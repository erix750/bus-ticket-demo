document.querySelectorAll("[data-current-year]").forEach(function(element) {
    const year = String(new Date().getFullYear());
    element.textContent = year;
    element.setAttribute("datetime", year);
});

const helpSearch = document.getElementById("footerHelpSearch");
const helpList = document.getElementById("footerFaqList");
if (helpSearch && helpList) {
    const helpItems = Array.from(helpList.querySelectorAll(".faq-item"));
    const helpCount = document.getElementById("footerHelpCount");
    const helpEmpty = document.getElementById("footerHelpEmpty");
    const normalizeHelpText = function(value) {
        return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
    };

    helpSearch.addEventListener("input", function() {
        const terms = normalizeHelpText(helpSearch.value.trim()).split(/\s+/).filter(Boolean);
        let visibleCount = 0;
        helpItems.forEach(function(item) {
            const text = normalizeHelpText(item.textContent);
            const matches = terms.every(function(term) { return text.includes(term); });
            item.hidden = !matches;
            if (matches) visibleCount += 1;
        });
        helpCount.textContent = visibleCount + (visibleCount === 1 ? " suggestion" : " suggestions");
        helpEmpty.hidden = visibleCount > 0;
    });
}
