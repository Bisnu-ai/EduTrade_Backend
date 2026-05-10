const express = require("express");
const router = express.Router();
const {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  getUserProfile,
  getProfile,
  rateUser,
  verifyOTP,
  resendOTP,
  forgotPassword,
  resetPassword,
  googleLogin,
} = require("../controllers/authController");
const { protect } = require("../middleware/auth");
const { uploadAvatar } = require("../middleware/upload");

const { check } = require("express-validator");
const { validate } = require("../middleware/errorHandler");

router.post("/register", register);
router.post("/login", login);
router.post("/verify-otp", verifyOTP);
router.post("/resend-otp", resendOTP);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/google", googleLogin);
router.get("/me", protect, getMe);
router.get("/profile/:id", getProfile); // New public/protected profile endpoint
router.put("/update-profile", protect, uploadAvatar, updateProfile);
router.put("/change-password", protect, changePassword);
router.get("/user/:id", getUserProfile);
router.post("/user/:id/rate", protect, rateUser);

module.exports = router;
