const User = require("../models/User");
const PendingUser = require("../models/PendingUser");
const Transaction = require("../models/Transaction");
const axios = require("axios");
const nodemailer = require("nodemailer");
const { sendTokenResponse } = require("../utils/token");
const { AppError } = require("../middleware/errorHandler");
const { deleteFile } = require("../middleware/upload");
const path = require("path");

// Helper to generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// HTML template for OTP emails
const getOTPEmailHTML = (otp) => `
  <div style="background-color: #f8fafc; padding: 40px 20px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 25px rgba(99, 102, 241, 0.1);">
      <div style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 40px; text-align: center;">
        <div style="font-size: 32px; font-weight: 800; color: white; letter-spacing: -1px; margin-bottom: 8px;">CampusKart</div>
        <div style="color: rgba(255,255,255,0.8); font-size: 14px; font-weight: 600; text-transform: uppercase; tracking: 1px;">Secure Campus Marketplace</div>
      </div>
      <div style="padding: 40px;">
        <h1 style="font-size: 24px; font-weight: 700; color: #1e293b; margin-top: 0; margin-bottom: 16px;">Verify your identity</h1>
        <p style="color: #64748b; font-size: 16px; line-height: 24px; margin-bottom: 32px;">
          Hello! Use the security code below to complete your verification process on CampusKart.
        </p>
        <div style="background: #f1f5f9; border-radius: 16px; padding: 32px; text-align: center; margin-bottom: 32px;">
          <div style="color: #64748b; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 1px;">Your Verification Code</div>
          <div style="font-size: 48px; font-weight: 800; color: #6366f1; letter-spacing: 10px; margin-left: 10px;">${otp}</div>
        </div>
        <p style="color: #ef4444; font-size: 13px; font-weight: 600; text-align: center; margin-bottom: 0;">
          This code expires in 10 minutes. Do not share it with anyone.
        </p>
      </div>
      <div style="background: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">
          &copy; 2026 CampusKart. All rights reserved.
        </p>
      </div>
    </div>
  </div>
`;

// Method 1: Send email via Brevo HTTP API (works on Render/cloud - no SMTP ports needed)
const sendViaBrevo = async (email, subject, htmlContent) => {
  const response = await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: { name: "CampusKart Support", email: process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_USER },
      to: [{ email }],
      subject,
      htmlContent,
    },
    {
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }
  );
  return response.data;
};

// Method 2: Send email via Gmail SMTP (works locally, blocked on Render free tier)
const sendViaGmailSMTP = async (email, subject, htmlContent) => {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  await transporter.sendMail({
    from: `"CampusKart Support" <${process.env.EMAIL_USER}>`,
    to: email,
    subject,
    html: htmlContent,
  });
};

// Helper to send OTP via Email (tries Brevo API first, then Gmail SMTP fallback)
const sendOTP = async (email, otp, subject = "Verify your CampusKart Account") => {
  const htmlContent = getOTPEmailHTML(otp);

  // Try Method 1: Brevo HTTP API (production)
  if (process.env.BREVO_API_KEY) {
    try {
      await sendViaBrevo(email, subject, htmlContent);
      console.log(`\n📧 [EMAIL SENT via Brevo] To: ${email} | Subject: ${subject}`);
      return true;
    } catch (error) {
      console.error(`\n❌ [BREVO FAILED] Error:`, error.response?.data || error.message);
    }
  }

  // Try Method 2: Gmail SMTP (local dev fallback)
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
      await sendViaGmailSMTP(email, subject, htmlContent);
      console.log(`\n📧 [EMAIL SENT via Gmail SMTP] To: ${email} | Subject: ${subject}`);
      return true;
    } catch (error) {
      console.error(`\n❌ [GMAIL SMTP FAILED] Error:`, error.message);
    }
  }

  // Both methods failed
  console.log(`\n************************************************`);
  console.log(`🔥 [EMERGENCY OTP LOG - ALL EMAIL METHODS FAILED]`);
  console.log(`📧 User: ${email}`);
  console.log(`🔢 OTP: ${otp}`);
  console.log(`************************************************\n`);
  return false;
};

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { name, email, password, phone, college, department, year } =
      req.body;

    // Check if email already exists in verified Users
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists. Please log in.",
      });
    }

    // Remove any old pending registration for this email
    await PendingUser.deleteMany({ email: email.toLowerCase() });

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save to PendingUser (NOT to User collection)
    const pendingUser = await PendingUser.create({
      name,
      email: email.toLowerCase(),
      password,
      phone,
      college: college || "CampusKart University",
      department,
      year,
      otp,
      otpExpires,
    });

    // Send OTP email
    const emailSent = await sendOTP(email, otp);
    
    if (!emailSent) {
      await PendingUser.deleteOne({ _id: pendingUser._id });
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP email. Please try again later.",
      });
    }

    res.status(201).json({
      success: true,
      message: "OTP sent to your email! Please verify to complete registration. 📧",
      data: { 
        pendingId: pendingUser._id,
        email: pendingUser.email 
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password"
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Your account is not verified. Please register again.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "your account hasbeen banned use other accounts",
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Update lastSeen
    user.lastSeen = new Date();

    // Auto-promote to admin if email matches ADMIN_EMAIL
    if (user.email === process.env.ADMIN_EMAIL && user.role !== "admin") {
      user.role = "admin";
    }

    await user.save({ validateBeforeSave: false });

    sendTokenResponse(user, 200, res, `Welcome back, ${user.name}! 👋`);
  } catch (error) {
    next(error);
  }
};

// GET /api/auth/me
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate(
      "wishlist",
      "title price images isAvailable"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/auth/update-profile
const updateProfile = async (req, res, next) => {
  try {
    const { name, phone, college, department, year, bio } = req.body;

    // Fields not allowed to update via this route
    const restrictedFields = ["email", "password", "isActive", "isVerified"];
    for (const field of restrictedFields) {
      if (req.body[field] !== undefined) {
        return res.status(400).json({
          success: false,
          message: `Cannot update '${field}' via this endpoint`,
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (college !== undefined) updateData.college = college;
    if (department !== undefined) updateData.department = department;
    if (year !== undefined) updateData.year = year;
    if (bio !== undefined) updateData.bio = bio;

    // Handle avatar upload
    if (req.file) {
      // Delete old avatar if exists
      const oldUser = await User.findById(req.user._id);
      if (oldUser.avatar) {
        // Pass the URL directly to the new deleteFile helper
        deleteFile(oldUser.avatar);
      }
      updateData.avatar = req.file.path;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update",
      });
    }

    const user = await User.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/auth/change-password
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters",
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password",
      });
    }

    const user = await User.findById(req.user._id).select("+password");
    const isMatch = await user.comparePassword(currentPassword);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully. Please log in again.",
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/auth/user/:userId - Public profile
const getUserProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select(
      "name avatar college department year bio totalListings totalSold rating createdAt lastSeen isActive"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.isActive) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/user/:id/rate
const rateUser = async (req, res, next) => {
  try {
    const { rating } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: "Invalid rating (1-5)" });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Calculate new average
    const currentTotal = user.rating.average * user.rating.count;
    const newCount = user.rating.count + 1;
    const newAverage = (currentTotal + rating) / newCount;

    user.rating.average = newAverage;
    user.rating.count = newCount;

    await user.save({ validateBeforeSave: false });

    res.json({ success: true, message: "Rating submitted!", data: { average: newAverage, count: newCount } });
  } catch (error) { next(error); }
};

// POST /api/auth/verify-otp
const verifyOTP = async (req, res, next) => {
  try {
    const { userId, email, otp } = req.body;

    if ((!userId && !email) || !otp) {
      return res.status(400).json({ success: false, message: "User identification and OTP are required" });
    }

    // Look in PendingUser collection first (new registration flow)
    const pendingQuery = userId ? { _id: userId } : { email: email.toLowerCase() };
    const pendingUser = await PendingUser.findOne(pendingQuery);

    if (pendingUser) {
      // Check OTP
      if (pendingUser.otp !== otp) {
        return res.status(400).json({ success: false, message: "Invalid verification code" });
      }
      if (pendingUser.otpExpires < new Date()) {
        return res.status(400).json({ success: false, message: "OTP has expired. Please register again." });
      }

      // OTP is valid! Move from PendingUser to User collection
      const role = pendingUser.email === process.env.ADMIN_EMAIL ? "admin" : "user";

      // Insert directly to bypass pre-save password hashing (password is already hashed)
      const userData = {
        name: pendingUser.name,
        email: pendingUser.email,
        password: pendingUser.password, // Already hashed by PendingUser
        phone: pendingUser.phone || undefined,
        college: pendingUser.college,
        department: pendingUser.department || undefined,
        year: pendingUser.year || undefined,
        isVerified: true,
        role,
        isActive: true,
        lastSeen: new Date(),
        totalListings: 0,
        totalSold: 0,
        rating: { average: 0, count: 0 },
        wishlist: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      const result = await User.collection.insertOne(userData);
      const user = await User.findById(result.insertedId);

      // Delete from pending collection
      await PendingUser.deleteOne({ _id: pendingUser._id });

      return sendTokenResponse(user, 200, res, "Account verified successfully! Welcome to CampusKart 🎓");
    }

    // Fallback: Check in User collection (for password reset or old unverified users)
    const userQuery = userId ? { _id: userId } : { email: email.toLowerCase() };
    const user = await User.findOne(userQuery);

    if (!user) {
      return res.status(404).json({ success: false, message: "Registration expired. Please register again." });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: "Account is already verified. Please login." });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ success: false, message: "Invalid verification code" });
    }
    if (user.otpExpires < new Date()) {
      return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
    }

    user.isVerified = true;
    user.otp = null;
    user.otpExpires = null;
    await user.save({ validateBeforeSave: false });

    sendTokenResponse(user, 200, res, "Account verified successfully! Welcome to CampusKart 🎓");
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/resend-otp
const resendOTP = async (req, res, next) => {
  try {
    const { userId, email } = req.body;
    
    if (!userId && !email) {
      return res.status(400).json({ success: false, message: "User identification is required" });
    }

    // Look in PendingUser first
    const query = userId ? { _id: userId } : { email: email.toLowerCase() };
    const pendingUser = await PendingUser.findOne(query);

    if (pendingUser) {
      const otp = generateOTP();
      pendingUser.otp = otp;
      pendingUser.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
      await pendingUser.save({ validateBeforeSave: false });

      const emailSent = await sendOTP(pendingUser.email, otp);
      if (!emailSent) {
        return res.status(500).json({
          success: false,
          message: "Failed to send verification email.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "A new verification code has been sent to your email. 📧",
      });
    }

    // Fallback to User collection (for old unverified users)
    const user = await User.findOne(query);
    if (!user) {
      return res.status(404).json({ success: false, message: "Registration expired. Please register again." });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: "Account is already verified" });
    }

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    const emailSent = await sendOTP(user.email, otp);
    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: "Failed to send verification email.",
      });
    }

    res.status(200).json({
      success: true,
      message: "A new verification code has been sent to your email. 📧",
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/forgot-password
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Please provide your email" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "No account found with this email" });
    }

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    const emailSent = await sendOTP(user.email, otp, "CampusKart - Password Reset Request");
    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: "Failed to send reset email.",
      });
    }

    res.status(200).json({
      success: true,
      message: "OTP sent to your email for password reset. 📧",
      data: { userId: user._id, email: user.email }
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/reset-password
const resetPassword = async (req, res, next) => {
  try {
    const { userId, otp, newPassword } = req.body;

    if (!userId || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const user = await User.findById(userId).select("+password");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Verify OTP
    if (user.otp !== otp || user.otpExpires < new Date()) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    // Update password and clear OTP
    user.password = newPassword;
    user.otp = null;
    user.otpExpires = null;
    user.isVerified = true; // Auto-verify if they reset via OTP
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password reset successful! You can now login with your new password. \ud83d\udd10",
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/google
const googleLogin = async (req, res, next) => {
  try {
    const { access_token } = req.body;

    if (!access_token) {
      return res.status(400).json({ success: false, message: "Google access token is required" });
    }

    // Verify token with Google
    const response = await axios.get(
      `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${access_token}`
    );

    const { email, name, picture, sub: googleId } = response.data;

    // Check if user exists
    let user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Create new user (Auto-verified since they come from Google)
      const role = email === process.env.ADMIN_EMAIL ? "admin" : "user";
      
      // For Google users, we set a dummy password
      const dummyPassword = Math.random().toString(36).slice(-10) + "Aa1!";
      
      user = await User.create({
        name,
        email: email.toLowerCase(),
        password: dummyPassword,
        avatar: picture,
        isVerified: true,
        role,
        googleId,
      });
    } else {
      // If user exists but wasn't verified, verify them now
      if (!user.isVerified) {
        user.isVerified = true;
      }
      // Update googleId and avatar if not set
      if (!user.googleId) user.googleId = googleId;
      if (!user.avatar && picture) user.avatar = picture;
      
      await user.save({ validateBeforeSave: false });
    }

    sendTokenResponse(user, 200, res, `Welcome to CampusKart, ${user.name}! \ud83c\udf93`);
  } catch (error) {
    console.error("Google Login Error:", error.message);
    res.status(401).json({ success: false, message: "Google verification failed" });
  }
};

module.exports = {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  getUserProfile,
  getProfile: getUserProfile,
  rateUser,
  verifyOTP,
  resendOTP,
  forgotPassword,
  resetPassword,
  googleLogin,
};
