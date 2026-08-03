const express = require("express");

const authController = require("../controllers/auth.controller");
const tokenRateLimit = require("../middleware/token-rate-limit.middleware");

const router = express.Router();

router.post("/token", tokenRateLimit, authController.issueToken);

module.exports = router;
