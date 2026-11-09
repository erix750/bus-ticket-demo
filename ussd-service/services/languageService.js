const translations = {
    en: require("../translations/en.json"),
    rw: require("../translations/rw.json"),
    fr: require("../translations/fr.json"),
    sw: require("../translations/sw.json")
};

function createLanguageService() {
    const codes = ["en", "rw", "fr", "sw"];
    return {
        fromChoice: function(value) {
            const index = Number(value) - 1;
            return Number.isInteger(index) && index >= 0 && index < codes.length
                ? codes[index]
                : "";
        },
        text: function(language, key, values) {
            const dictionary = translations[language] || translations.en;
            let message = dictionary[key] || translations.en[key] || key;
            Object.keys(values || {}).forEach(function(name) {
                message = message.replaceAll("{" + name + "}", String(values[name]));
            });
            return message;
        },
        languagePrompt: function() {
            return "Choose language / Hitamo ururimi\n1. English\n2. Kinyarwanda\n3. Français\n4. Kiswahili";
        },
        codes: codes
    };
}

module.exports = { createLanguageService };
