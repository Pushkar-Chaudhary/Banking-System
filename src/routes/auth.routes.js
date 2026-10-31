const express = require("express");
const { register, sendRegistrationOtp, userLoginController, getCurrentUser, logoutUser, forgotPassword, resetPassword } = require("../controllers/auth.controller");
const { protect } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/send-registration-otp", sendRegistrationOtp);
router.post("/register", register);
router.post("/login", userLoginController);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/me", protect, getCurrentUser);
router.post("/logout", protect, logoutUser);

module.exports = router;