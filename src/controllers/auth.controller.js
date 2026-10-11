const userModel = require("../models/user.model");
const Otp = require("../models/otp.model");
const jwt = require("jsonwebtoken");
const emailService = require("../services/email.service");
const { serverError } = require("../services/http.service");

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function sanitizeUser(user) {
  const userResponse = user.toObject ? user.toObject() : { ...user };
  delete userResponse.password;
  return userResponse;
}

function passwordError(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password cannot exceed ${MAX_PASSWORD_LENGTH} characters`;
  }
  return null;
}

function authCookieOptions() {
  const frontendOrigin = safeOrigin(process.env.FRONTEND_URL);
  const apiOrigin = safeOrigin(process.env.API_PUBLIC_URL);
  const crossSite = Boolean(frontendOrigin && apiOrigin && frontendOrigin !== apiOrigin);
  return {
    httpOnly: true,
    sameSite: crossSite ? "none" : "lax",
    secure: process.env.NODE_ENV === "production"
  };
}

function safeOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendRegistrationOtp(req, res) {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const email = normalizeEmail(req.body.email);

  if (!email) {
    return res.status(400).json({ message: "Please provide a valid email address" });
  }

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: "Invalid email format" });
  }

  try {
    const existingUser = await userModel.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "An account with this email already exists" });
    }

    const otpCode = generateOtp();

    // Store or replace OTP for this email
    await Otp.findOneAndUpdate(
      { email, purpose: 'registration' },
      { otp: otpCode, createdAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
      await emailService.sendRegistrationOtpEmail(email, name, otpCode);
    } catch (emailError) {
      console.error("Failed to send OTP email:", emailError.message);
      // In development or if SMTP is down, return helpful message
      if (process.env.NODE_ENV !== 'production') {
        return res.status(200).json({
          message: "Verification code generated (Check server console for code in dev mode)",
          devOtp: otpCode
        });
      }
      return res.status(500).json({ message: "Unable to send verification email. Please check your email address or try again later." });
    }

    return res.status(200).json({
      message: "Verification code sent to your email",
      email
    });
  } catch (error) {
    return serverError(res, "Failed to send verification code", error);
  }
}

async function register(req, res) {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const role = req.body.role || 'buyer';
  const otp = typeof req.body.otp === "string" ? req.body.otp.trim() : "";

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Please provide name, email and password" });
  }
  const badPassword = passwordError(password);
  if (badPassword) {
    return res.status(400).json({ message: badPassword });
  }
  if (!['buyer', 'seller'].includes(role)) {
    return res.status(400).json({ message: "Choose buyer or seller for your account" });
  }
  if (!otp) {
    return res.status(400).json({ message: "Please provide the 6-digit verification code sent to your email" });
  }

  if (!process.env.JWT_SECRET || !process.env.JWT_EXPIRES_IN) {
    return res.status(500).json({ message: "JWT configuration is missing" });
  }

  try {
    const existingUser = await userModel.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Verify OTP
    const validOtp = await Otp.findOne({ email, purpose: 'registration' });
    if (!validOtp || validOtp.otp !== otp) {
      return res.status(400).json({ message: "Invalid or expired verification code. Please request a new code." });
    }

    // Remove used OTP
    await Otp.deleteOne({ _id: validOtp._id });

    const newUser = await userModel.create({ name, email, password, role });

    try {
      await emailService.sendRegistrationEmail(newUser.email, newUser.name);
    } catch (emailError) {
      console.error("Welcome email failed:", emailError.message);
    }

    const token = jwt.sign({ id: newUser._id, role: newUser.role }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN
    });

    const userResponse = sanitizeUser(newUser);

    res.cookie("token", token, authCookieOptions());

    res.status(201).json({
      message: "User registered successfully",
      user: userResponse,
      token
    });
  } catch (error) {
    return serverError(res, error.code === 11000 ? "User already exists" : "Server error", error, error.code === 11000 ? 409 : 500);
  }
}

async function userLoginController(req, res) {
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!email || !password) {
    return res.status(400).json({ message: "Please provide email and password" });
  }

  if (!process.env.JWT_SECRET || !process.env.JWT_EXPIRES_IN) {
    return res.status(500).json({ message: "JWT configuration is missing" });
  }

  try {
    const user = await userModel.findOne({ email }).select("+password");
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN
    });

    const userResponse = sanitizeUser(user);

    res.cookie("token", token, authCookieOptions());

    res.json({ message: "Login successful", user: userResponse, token });
  } catch (error) {
    return serverError(res, "Server error", error);
  }
}

async function forgotPassword(req, res) {
  const email = normalizeEmail(req.body.email);
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const genericResponse = {
    message: "If an account exists for that email, a password reset code has been sent."
  };

  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ message: "Please provide a valid email address" });
  }

  try {
    const user = await userModel.findOne({ email, isActive: { $ne: false } });
    if (!user) {
      return res.status(200).json(genericResponse);
    }

    const otpCode = generateOtp();
    await Otp.findOneAndUpdate(
      { email, purpose: 'password_reset' },
      { otp: otpCode, createdAt: new Date(), purpose: 'password_reset' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
      await emailService.sendPasswordResetOtpEmail(email, user.name, otpCode);
    } catch (emailError) {
      console.error("Failed to send password reset email:", emailError.message);
      if (process.env.NODE_ENV !== 'production') {
        return res.status(200).json({ ...genericResponse, devOtp: otpCode });
      }
      return res.status(500).json({ message: "Unable to send the reset email right now. Please try again later." });
    }

    return res.status(200).json(genericResponse);
  } catch (error) {
    return serverError(res, "Failed to start password reset", error);
  }
}

async function resetPassword(req, res) {
  const email = normalizeEmail(req.body.email);
  const otp = typeof req.body.otp === "string" ? req.body.otp.trim() : "";
  const newPassword = typeof req.body.newPassword === "string" ? req.body.newPassword : "";

  if (!email || !otp) {
    return res.status(400).json({ message: "Please provide your email and the reset code" });
  }
  const badPassword = passwordError(newPassword);
  if (badPassword) {
    return res.status(400).json({ message: badPassword });
  }

  try {
    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset code. Please request a new one." });
    }

    const validOtp = await Otp.findOne({ email, purpose: 'password_reset' });
    if (!validOtp || validOtp.otp !== otp) {
      return res.status(400).json({ message: "Invalid or expired reset code. Please request a new one." });
    }

    user.password = newPassword;
    await user.save();
    await Otp.deleteOne({ _id: validOtp._id });

    return res.status(200).json({ message: "Password updated. You can now sign in with your new password." });
  } catch (error) {
    return serverError(res, "Failed to reset password", error);
  }
}

module.exports = {
  sendRegistrationOtp,
  register,
  userLoginController,
  forgotPassword,
  resetPassword
};
