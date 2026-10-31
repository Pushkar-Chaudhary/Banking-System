const test = require('node:test');
const assert = require('node:assert/strict');
const emailService = require('../src/services/email.service');

const emailEnvironmentKeys = [
  'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_PASSWORD', 'CLIENT_ID', 'CLIENT_SECRET',
  'REFRESH_TOKEN', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'
];

function clearEmailEnvironment() {
  const previous = Object.fromEntries(emailEnvironmentKeys.map((key) => [key, process.env[key]]));
  emailEnvironmentKeys.forEach((key) => delete process.env[key]);
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test('sendRegistrationOtpEmail formats email properly and executes fallback without throwing', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const restoreEmailEnvironment = clearEmailEnvironment();
  process.env.NODE_ENV = 'test';
  try {
    const result = await emailService.sendRegistrationOtpEmail('test@example.com', 'Test User', '123456');
    assert.ok(result);
    assert.ok(result.messageId);
  } finally {
    restoreEmailEnvironment();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('email delivery fails clearly when production has no configured provider', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const restoreEmailEnvironment = clearEmailEnvironment();
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(
      emailService.sendRegistrationOtpEmail('test@example.com', 'Test User', '123456'),
      /Email transport is not configured for production/
    );
  } finally {
    restoreEmailEnvironment();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('sendOrderConfirmationToBuyer formats buyer order confirmation email without throwing', async () => {
  const mockOrder = {
    _id: '507f1f77bcf86cd799439011',
    items: [
      { productName: 'Handmade Pashmina Shawl', quantity: 2, price: 2500, subtotal: 5000 }
    ],
    shippingCost: 200,
    total: 5200,
    paymentMethod: 'cash_on_delivery'
  };

  const mockAddress = {
    fullName: 'Ram Bahadur',
    phone: '9841234567',
    addressLine1: 'New Road, Ward 22',
    city: 'Kathmandu',
    state: 'Bagmati',
    country: 'Nepal'
  };

  const result = await emailService.sendOrderConfirmationToBuyer({
    buyerEmail: 'buyer@example.com',
    buyerName: 'Ram Bahadur',
    orders: [mockOrder],
    shippingAddress: mockAddress,
    paymentMethod: 'cash_on_delivery',
    checkoutTotal: 5200
  });

  assert.ok(result);
  assert.ok(result.messageId);
});

test('sendOrderNotificationToSeller formats full seller order notification without throwing', async () => {
  const mockOrder = {
    _id: '507f1f77bcf86cd799439011',
    paymentMethod: 'esewa',
    paymentStatus: 'PAID',
    shippingCost: 0
  };

  const mockSellerItems = [
    { productName: 'Nepali Organic Green Tea', quantity: 3, price: 450, subtotal: 1350 }
  ];

  const mockBuyerInfo = {
    name: 'Sita Sharma',
    email: 'sita@example.com',
    phone: '9801234567'
  };

  const mockAddress = {
    fullName: 'Sita Sharma',
    phone: '9801234567',
    addressLine1: 'Lakeside, Ward 6',
    city: 'Pokhara',
    state: 'Gandaki',
    country: 'Nepal'
  };

  const result = await emailService.sendOrderNotificationToSeller({
    sellerEmail: 'seller@example.com',
    sellerName: 'Himalayan Organic Store',
    order: mockOrder,
    sellerItems: mockSellerItems,
    buyerInfo: mockBuyerInfo,
    shippingAddress: mockAddress
  });

  assert.ok(result);
  assert.ok(result.messageId);
});
