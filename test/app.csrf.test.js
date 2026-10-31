const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');

test('cookie-authenticated writes allow same-origin requests and reject foreign origins', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    const sameOrigin = await fetch(`${origin}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: 'token=invalid' }
    });
    assert.equal(sameOrigin.status, 401);

    const dynamicLocalPort = await fetch(`${origin}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:5189', Cookie: 'token=invalid' }
    });
    assert.equal(dynamicLocalPort.status, 401);

    const foreignOrigin = await fetch(`${origin}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', Cookie: 'token=invalid' }
    });
    assert.equal(foreignOrigin.status, 403);
    assert.match((await foreignOrigin.json()).message, /origin is not allowed/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
