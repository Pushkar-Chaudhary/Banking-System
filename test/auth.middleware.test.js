const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const userModel = require('../src/models/user.model');
const { protect } = require('../src/middleware/auth.middleware');

async function checkToken(sessionVersion, user) {
  const secret = 'middleware-test-secret-with-at-least-thirty-two-characters';
  const token = jwt.sign({ id: 'user-id', role: 'admin', sessionVersion }, secret, { expiresIn: '1h' });
  const originalSecret = process.env.JWT_SECRET;
  const originalFindById = userModel.findById;
  process.env.JWT_SECRET = secret;
  userModel.findById = () => ({ select: async () => user });

  const res = {
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
  let nextCalled = false;
  const req = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
  try {
    await protect(
      req,
      res,
      () => { nextCalled = true; }
    );
    return { req, res, nextCalled };
  } finally {
    userModel.findById = originalFindById;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
}

test('authentication rejects tokens issued before a password reset', async () => {
  const { res, nextCalled } = await checkToken(0, { sessionVersion: 1, role: 'buyer' });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.message, 'Session expired. Please sign in again.');
  assert.equal(nextCalled, false);
});

test('authentication loads the current role from the database, not the token', async () => {
  const user = { _id: 'user-id', sessionVersion: 2, role: 'buyer' };
  const { req, res, nextCalled } = await checkToken(2, user);
  assert.equal(res.statusCode, 200);
  assert.equal(nextCalled, true);
  assert.equal(req.user.role, 'buyer');
});
