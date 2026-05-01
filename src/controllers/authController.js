const User = require("../models/User");
const Transaction = require("../models/Transaction");
const axios = require("axios");
const nodemailer = require("nodemailer");
const { sendTokenResponse } = require("../utils/token");
const { AppError } = require("../middleware/errorHandler");
const { getFileUrl, deleteFile } = require("../middleware/upload");
const path = require("path");

// Helper to generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Helper to send OTP via Email
const sendOTP = async (email, otp, subject = "Verify your EduTrade Account") => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      host: "smtp.gmail.com",
      port: 465,
      secure: true, // use SSL
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"EduTrade Support" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: subject,
      html: `
        <div style="background-color: #f8fafc; padding: 40px 20px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
          <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 25px rgba(99, 102, 241, 0.1);">
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 40px; text-align: center;">
              <div style="font-size: 32px; font-weight: 800; color: white; letter-spacing: -1px; margin-bottom: 8px;">EduTrade</div>
              <div style="color: rgba(255,255,255,0.8); font-size: 14px; font-weight: 600; text-transform: uppercase; tracking: 1px;">Secure Campus Marketplace</div>
            </div>
            
            <!-- Body -->
            <div style="padding: 40px;">
              <h1 style="font-size: 24px; font-weight: 700; color: #1e293b; margin-top: 0; margin-bottom: 16px;">Verify your identity</h1>
              <p style="color: #64748b; font-size: 16px; line-height: 24px; margin-bottom: 32px;">
                Hello! Someone is trying to sign in or register with your email. Use the security code below to complete the process.
              </p>
              
              <!-- OTP Box -->
              <div style="background: #f1f5f9; border-radius: 16px; padding: 32px; text-align: center; margin-bottom: 32px;">
                <div style="color: #64748b; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 1px;">Your Verification Code</div>
                <div style="font-size: 48px; font-weight: 800; color: #6366f1; letter-spacing: 10px; margin-left: 10px;">${otp}</div>
              </div>
              
              <p style="color: #ef4444; font-size: 13px; font-weight: 600; text-align: center; margin-bottom: 0;">
                This code expires in 10 minutes. Do not share it with anyone.
              </p>
            </div>
            
            <!-- Footer -->
            <div style="background: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                &copy; 2026 EduTrade. All rights reserved. <br/>
                Empowering students to trade smarter.
              </p>
            </div>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email OTP Sent Successfully to ${email}`);
  } catch (error) {
    console.error(`❌ NODEMAILER ERROR:`, error.message);
    console.log(`🔢 SERVER LOG OTP (Email failed): ${otp}\n`);
  }
};

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { name, email, password, phone, college, department, year } =
      req.body;

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    
    if (existingUser) {
      if (existingUser.isVerified) {
        return res.status(409).json({
          success: false,
          message: "An account with this email already exists. Please log in.",
        });
      } else {
        // If user exists but is NOT verified, remove them so we can re-register freshly
        await User.deleteOne({ _id: existingUser._id });
      }
    }

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Auto-assign admin role if email matches ADMIN_EMAIL in .env
    const role = email === process.env.ADMIN_EMAIL ? "admin" : "user";

    const user = await User.create({
      name,
      email,
      password,
      phone,
      college: college || "EduTrade University",
      department,
      year,
      otp,
      otpExpires,
      isVerified: false, 
      role, // Set role here
    });

    sendOTP(email, otp);

    res.status(201).json({
      success: true,
      message: "Registration successful! Please verify the OTP sent to your email. 📧",
      data: { 
        userId: user._id,
        email: user.email 
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
      // If not verified, send a new OTP and tell them to verify
      const otp = generateOTP();
      user.otp = otp;
      user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
      await user.save({ validateBeforeSave: false });
      sendOTP(user.email, otp);

      return res.status(403).json({
        success: false,
        message: "Your account is not verified. A new OTP has been sent to your email. 📧",
        data: { userId: user._id, email: user.email }
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
        const oldPath = path.join(
          process.cwd(),
          process.env.UPLOAD_PATH || "uploads/",
          path.basename(oldUser.avatar)
        );
        deleteFile(oldPath);
      }
      updateData.avatar = getFileUrl(req, req.file.filename);
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

    // Find user by ID or Email
    const query = userId ? { _id: userId } : { email: email.toLowerCase() };
    const user = await User.findOne(query);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: "Account is already verified. Please login." });
    }

    // Check if OTP matches and is not expired
    if (user.otp !== otp) {
      return res.status(400).json({ success: false, message: "Invalid verification code" });
    }

    if (user.otpExpires < new Date()) {
      return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
    }

    // Mark as verified and clear OTP
    user.isVerified = true;
    user.otp = null;
    user.otpExpires = null;
    await user.save({ validateBeforeSave: false });

    sendTokenResponse(user, 200, res, "Account verified successfully! Welcome to EduTrade 🎓");
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

    // Find user by ID or Email
    const query = userId ? { _id: userId } : { email: email.toLowerCase() };
    const user = await User.findOne(query);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: "Account is already verified" });
    }

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    sendOTP(user.email, otp);

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

    sendOTP(user.email, otp, "EduTrade - Password Reset Request");

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
      message: "Password reset successful! You can now login with your new password. 🔐",
    });
  } catch (error) {
    next(error);
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
};
