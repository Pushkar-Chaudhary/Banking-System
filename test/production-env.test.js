const test = require('node:test');
const assert = require('node:assert/strict');
const { getProductionConfigErrors } = require('../src/config/production-env');

function validProductionEnvironment() {
  return {
    NODE_ENV: 'production',
    MONGO_URI: 'mongodb+srv://database.example/sajilo',
    JWT_SECRET: 'a'.repeat(32),
    JWT_EXPIRES_IN: '7d',
    API_PUBLIC_URL: 'https://shop.example',
    FRONTEND_URL: 'https://shop.example',
    TRUST_PROXY: '1',
    SELLER_PAYMENT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    SMTP_HOST: 'smtp.example',
    SMTP_USER: 'mailer@example',
    SMTP_PASS: 'provider-secret'
  };
}

test('production configuration accepts valid required settings', () => {
  assert.deepEqual(getProductionConfigErrors(validProductionEnvironment()), []);
});

test('production configuration reports missing and invalid required settings', () => {
  const errors = getProductionConfigErrors({
    ...validProductionEnvironment(),
    JWT_SECRET: 'short',
    API_PUBLIC_URL: 'http://shop.example',
    TRUST_PROXY: '0',
    SELLER_PAYMENT_ENCRYPTION_KEY: 'invalid',
    SMTP_HOST: ''
  });

  assert.match(errors.join('\n'), /JWT_SECRET/);
  assert.match(errors.join('\n'), /API_PUBLIC_URL/);
  assert.match(errors.join('\n'), /TRUST_PROXY/);
  assert.match(errors.join('\n'), /SELLER_PAYMENT_ENCRYPTION_KEY/);
  assert.match(errors.join('\n'), /production email/);
  assert.doesNotMatch(errors.join('\n'), /provider-secret|short|invalid/);
});

test('development configuration is not subject to production requirements', () => {
  assert.deepEqual(getProductionConfigErrors({ NODE_ENV: 'development' }), []);
});