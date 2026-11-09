const express = require("express");

module.exports = function createUssdRoutes(options) {
    const router = express.Router();
    router.post(
        "/",
        options.security.authenticate,
        options.security.rateLimit,
        options.security.validateCallback,
        options.controller
    );
    return router;
};
