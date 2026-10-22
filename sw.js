const CACHE_NAME = "wayline-shell-v2";
const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css",
    "./config.js",
    "./database.js",
    "./script.js",
    "./pwa.js",
    "./bus-background.jpg",
    "./manifest.webmanifest",
    "./icons/wayline-192.png",
    "./icons/wayline-512.png",
    "./icons/wayline-maskable-512.png"
];

self.addEventListener("install", function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) { return cache.addAll(APP_SHELL); })
            .then(function() { return self.skipWaiting(); })
    );
});

self.addEventListener("activate", function(event) {
    event.waitUntil(
        caches.keys()
            .then(function(cacheNames) {
                return Promise.all(cacheNames
                    .filter(function(cacheName) {
                        return cacheName.startsWith("wayline-shell-") && cacheName !== CACHE_NAME;
                    })
                    .map(function(cacheName) { return caches.delete(cacheName); }));
            })
            .then(function() { return self.clients.claim(); })
    );
});

self.addEventListener("fetch", function(event) {
    const request = event.request;
    if (request.method !== "GET") return;

    const requestUrl = new URL(request.url);
    if (requestUrl.origin !== self.location.origin) return;

    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then(function(response) {
                    if (response.ok) {
                        const responseCopy = response.clone();
                        caches.open(CACHE_NAME).then(function(cache) {
                            return cache.put(request, responseCopy);
                        });
                    }
                    return response;
                })
                .catch(function() {
                    return caches.match(request, { ignoreSearch: true })
                        .then(function(cachedPage) {
                            return cachedPage || caches.match("./index.html");
                        });
                })
        );
        return;
    }

    if (!["document", "style", "script", "image", "font"].includes(request.destination)) return;

    event.respondWith(
        fetch(request)
            .then(function(response) {
                if (response.ok && response.type === "basic") {
                    const responseCopy = response.clone();
                    caches.open(CACHE_NAME).then(function(cache) {
                        return cache.put(request, responseCopy);
                    });
                }
                return response;
            })
            .catch(function() {
                return caches.match(request, { ignoreSearch: true });
            })
    );
});
