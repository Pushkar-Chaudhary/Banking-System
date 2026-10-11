const test = require('node:test');
const assert = require('node:assert/strict');
const userModel = require('../src/models/user.model');
const Otp = require('../src/models/otp.model');
const emailService = require('../src/services/email.service');
const { register, forgotPassword, resetPassword } = require('../src/controllers/auth.controller');

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
    }
  };
}

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
  const originalOtpFindOne = Otp.findOne;
  let saved = false;
  userModel.findOne = async () => ({ _id: 'user-id', save: async () => { saved = true; } });
  Otp.findOne = async () => ({ _id: 'otp-id', otp: '111111' });
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
    Otp.findOne = originalOtpFindOne;
  }
});

test('reset password updates the password and consumes the reset code', async () => {
  const originalFindOne = userModel.findOne;
  const originalOtpFindOne = Otp.findOne;
  const originalOtpDelete = Otp.deleteOne;
  let deletedId;
  const user = { _id: 'user-id', password: 'old-password', save: async () => { user.saved = true; } };
  userModel.findOne = async () => user;
  Otp.findOne = async () => ({ _id: 'otp-id', otp: '123456' });
  Otp.deleteOne = async ({ _id }) => {
    deletedId = _id;
  };
  try {
    const res = responseRecorder();
    await resetPassword({
      body: { email: 'sita@example.com', otp: '123456', newPassword: 'brand-new-password' }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(user.password, 'brand-new-password');
    assert.equal(user.saved, true);
    assert.equal(deletedId, 'otp-id');
  } finally {
    userModel.findOne = originalFindOne;
    Otp.findOne = originalOtpFindOne;
    Otp.deleteOne = originalOtpDelete;
  }
});
