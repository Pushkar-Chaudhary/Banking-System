const test = require('node:test');
const assert = require('node:assert/strict');
const userModel = require('../src/models/user.model');
const Otp = require('../src/models/otp.model');
const emailService = require('../src/services/email.service');
const {
  register,
  sendRegistrationOtp,
  userLoginController,
  logoutUser,
  forgotPassword,
  resetPassword,
  authCookieOptions
} = require('../src/controllers/auth.controller');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    cookie(name, value, options) {
      this.cookieValue = { name, value, options };
      return this;
    },
    clearCookie(name, options) {
      this.clearedCookie = { name, options };
      return this;
    }
  };
}

test('login issues a persistent HttpOnly cookie without returning the JWT to JavaScript', async () => {
  const originalFindOne = userModel.findOne;
  const originalSecret = process.env.JWT_SECRET;
  const originalExpiresIn = process.env.JWT_EXPIRES_IN;
  const user = {
    _id: 'user-id',
    role: 'buyer',
    sessionVersion: 3,
    comparePassword: async () => true,
    toObject: () => ({ _id: 'user-id', role: 'buyer', sessionVersion: 3 })
  };
  userModel.findOne = () => ({ select: async () => user });
  process.env.JWT_SECRET = 'test-secret-with-at-least-thirty-two-characters';
  process.env.JWT_EXPIRES_IN = '1h';
  try {
    const res = responseRecorder();
    await userLoginController({ body: { email: 'sita@example.com', password: 'correct-password' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.role, 'buyer');
    assert.equal(Object.hasOwn(res.body, 'token'), false);
    assert.equal(res.cookieValue.name, 'token');
    assert.equal(res.cookieValue.options.httpOnly, true);
    assert.equal(res.cookieValue.options.sameSite, 'lax');
    assert.equal(res.cookieValue.options.path, '/');
    assert.ok(res.cookieValue.options.maxAge > 0);
    assert.equal(Object.hasOwn(res.body.user, 'sessionVersion'), false);
  } finally {
    userModel.findOne = originalFindOne;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalExpiresIn === undefined) delete process.env.JWT_EXPIRES_IN;
    else process.env.JWT_EXPIRES_IN = originalExpiresIn;
  }
});

test('cross-site authentication cookies require HTTPS and SameSite=None', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalApiUrl = process.env.API_PUBLIC_URL;
  process.env.NODE_ENV = 'development';
  process.env.FRONTEND_URL = 'https://store.example';
  process.env.API_PUBLIC_URL = 'https://api.example';
  try {
    const options = authCookieOptions();
    assert.equal(options.sameSite, 'none');
    assert.equal(options.secure, true);
    assert.equal(options.httpOnly, true);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
    if (originalApiUrl === undefined) delete process.env.API_PUBLIC_URL;
    else process.env.API_PUBLIC_URL = originalApiUrl;
  }
});

test('registration creates a browser session without exposing its JWT', async () => {
  const originalFindOne = userModel.findOne;
  const originalCreate = userModel.create;
  const originalOtpFindOneAndDelete = Otp.findOneAndDelete;
  const originalSendWelcomeEmail = emailService.sendRegistrationEmail;
  const originalSecret = process.env.JWT_SECRET;
  const originalExpiresIn = process.env.JWT_EXPIRES_IN;
  let consumedOtp;
  userModel.findOne = async () => null;
  Otp.findOneAndDelete = async (filter) => {
    consumedOtp = filter;
    return { _id: 'otp-id' };
  };
  userModel.create = async () => ({
    _id: 'user-id',
    role: 'buyer',
    sessionVersion: 0,
    toObject: () => ({ _id: 'user-id', role: 'buyer', sessionVersion: 0 })
  });
  emailService.sendRegistrationEmail = async () => {};
  process.env.JWT_SECRET = 'test-secret-with-at-least-thirty-two-characters';
  process.env.JWT_EXPIRES_IN = '1h';
  try {
    const res = responseRecorder();
    await register({
      body: {
        name: 'Sita Sharma',
        email: 'Sita@Example.com',
        password: 'a-secure-password',
        role: 'buyer',
        otp: '123456'
      }
    }, res);
    assert.equal(res.statusCode, 201);
    assert.deepEqual(consumedOtp, { email: 'sita@example.com', purpose: 'registration', otp: '123456' });
    assert.equal(res.cookieValue.name, 'token');
    assert.equal(res.cookieValue.options.httpOnly, true);
    assert.equal(Object.hasOwn(res.body, 'token'), false);
    assert.equal(Object.hasOwn(res.body.user, 'sessionVersion'), false);
  } finally {
    userModel.findOne = originalFindOne;
    userModel.create = originalCreate;
    Otp.findOneAndDelete = originalOtpFindOneAndDelete;
    emailService.sendRegistrationEmail = originalSendWelcomeEmail;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalExpiresIn === undefined) delete process.env.JWT_EXPIRES_IN;
    else process.env.JWT_EXPIRES_IN = originalExpiresIn;
  }
});

test('logout revokes existing sessions and clears the authentication cookie', async () => {
  const originalUpdateOne = userModel.updateOne;
  let update;
  userModel.updateOne = async (...args) => { update = args; };
  try {
    const res = responseRecorder();
    await logoutUser({ user: { _id: 'user-id' } }, res);
    assert.deepEqual(update, [{ _id: 'user-id' }, { $inc: { sessionVersion: 1 } }]);
    assert.equal(res.clearedCookie.name, 'token');
    assert.equal(res.clearedCookie.options.path, '/');
    assert.equal(res.body.message, 'Logout successful');
  } finally {
    userModel.updateOne = originalUpdateOne;
  }
});

test('registration OTPs use cryptographic randomness and are not exposed in production email errors', async () => {
  const originalFindOne = userModel.findOne;
  const originalOtpUpdate = Otp.findOneAndUpdate;
  const originalSendEmail = emailService.sendRegistrationOtpEmail;
  const originalNodeEnv = process.env.NODE_ENV;
  userModel.findOne = async () => null;
  Otp.findOneAndUpdate = async () => {};
  emailService.sendRegistrationOtpEmail = async () => { throw new Error('mail unavailable'); };
  process.env.NODE_ENV = 'production';
  try {
    const res = responseRecorder();
    await sendRegistrationOtp({ body: { name: 'Sita', email: 'sita@example.com' } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(Object.hasOwn(res.body, 'devOtp'), false);
  } finally {
    userModel.findOne = originalFindOne;
    Otp.findOneAndUpdate = originalOtpUpdate;
    emailService.sendRegistrationOtpEmail = originalSendEmail;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test('simulated registration email exposes its OTP only outside production', async () => {
  const originalFindOne = userModel.findOne;
  const originalOtpUpdate = Otp.findOneAndUpdate;
  const originalSendEmail = emailService.sendRegistrationOtpEmail;
  const originalNodeEnv = process.env.NODE_ENV;
  let storedOtp;
  userModel.findOne = async () => null;
  Otp.findOneAndUpdate = async (_filter, update) => { storedOtp = update.otp; };
  emailService.sendRegistrationOtpEmail = async () => ({ simulated: true });
  process.env.NODE_ENV = 'development';
  try {
    const res = responseRecorder();
    await sendRegistrationOtp({ body: { name: 'Sita', email: 'sita@example.com' } }, res);
    assert.equal(res.statusCode, 200);
    assert.match(storedOtp, /^\d{6}$/);
    assert.equal(res.body.devOtp, storedOtp);
  } finally {
    userModel.findOne = originalFindOne;
    Otp.findOneAndUpdate = originalOtpUpdate;
    emailService.sendRegistrationOtpEmail = originalSendEmail;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test('registration rejects passwords shorter than 8 characters before touching the database', async () => {
  const res = responseRecorder();
  await register({
    body: { name: 'Sita', email: 'sita@example.com', password: 'short', role: 'buyer', otp: '123456' }
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /at least 8 characters/);
});

test('forgot password responds generically for unknown emails to avoid account enumeration', async () => {
  const originalFindOne = userModel.findOne;
  userModel.findOne = async () => null;
  try {
    const res = responseRecorder();
    await forgotPassword({ body: { email: 'nobody@example.com' } }, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body.message, /If an account exists/);
    assert.equal(Object.hasOwn(res.body, 'devOtp'), false);
  } finally {
    userModel.findOne = originalFindOne;
  }
});

test('forgot password rejects malformed email addresses', async () => {
  const res = responseRecorder();
  await forgotPassword({ body: { email: 'not-an-email' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /valid email/);
});

test('forgot password stores a reset code and emails it for a real account', async () => {
  const originalFindOne = userModel.findOne;
  const originalOtpUpdate = Otp.findOneAndUpdate;
  const originalSendEmail = emailService.sendPasswordResetOtpEmail;
  let stored;
  let emailed;
  userModel.findOne = async () => ({ _id: 'user-id', name: 'Sita', email: 'sita@example.com' });
  Otp.findOneAndUpdate = async (filter, update) => {
    stored = { filter, update };
  };
  emailService.sendPasswordResetOtpEmail = async (email, name, otp) => {
    emailed = { email, name, otp };
  };
  try {
    const res = responseRecorder();
    await forgotPassword({ body: { email: 'Sita@Example.com' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(stored.filter.email, 'sita@example.com');
    assert.equal(stored.filter.purpose, 'password_reset');
    assert.equal(stored.update.purpose, 'password_reset');
    assert.match(stored.update.otp, /^\d{6}$/);
    assert.equal(emailed.email, 'sita@example.com');
    assert.equal(emailed.otp, stored.update.otp);
    assert.equal(res.body.message, 'If an account exists for that email, a password reset code has been sent.');
  } finally {
    userModel.findOne = originalFindOne;
    Otp.findOneAndUpdate = originalOtpUpdate;
    emailService.sendPasswordResetOtpEmail = originalSendEmail;
  }
});

test('reset password rejects an incorrect code without changing the password', async () => {
  const originalFindOne = userModel.findOne;
  const originalOtpFindOneAndDelete = Otp.findOneAndDelete;
  let saved = false;
  userModel.findOne = async () => ({ _id: 'user-id', save: async () => { saved = true; } });
  Otp.findOneAndDelete = async () => null;
  try {
    const res = responseRecorder();
    await resetPassword({
      body: { email: 'sita@example.com', otp: '999999', newPassword: 'brand-new-password' }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Invalid or expired reset code/);
    assert.equal(saved, false);
  } finally {
    userModel.findOne = originalFindOne;
    Otp.findOneAndDelete = originalOtpFindOneAndDelete;
  }
});

test('reset password updates the password and consumes the reset code', async () => {
  const originalFindOne = userModel.findOne;
  const originalOtpFindOneAndDelete = Otp.findOneAndDelete;
  let consumed;
  const user = { _id: 'user-id', password: 'old-password', save: async () => { user.saved = true; } };
  userModel.findOne = async () => user;
  Otp.findOneAndDelete = async (filter) => {
    consumed = filter;
    return { _id: 'otp-id' };
  };
  try {
    const res = responseRecorder();
    await resetPassword({
      body: { email: 'sita@example.com', otp: '123456', newPassword: 'brand-new-password' }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(user.password, 'brand-new-password');
    assert.equal(user.sessionVersion, 1);
    assert.equal(user.saved, true);
    assert.deepEqual(consumed, { email: 'sita@example.com', purpose: 'password_reset', otp: '123456' });
  } finally {
    userModel.findOne = originalFindOne;
    Otp.findOneAndDelete = originalOtpFindOneAndDelete;
  }
});
