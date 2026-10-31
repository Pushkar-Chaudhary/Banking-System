const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Order = require('../src/models/order.model');
const Product = require('../src/models/product.model');
const Checkout = require('../src/models/checkout.model');
const userModel = require('../src/models/user.model');
const emailService = require('../src/services/email.service');
const { createOrder, updateSellerFulfillment } = require('../src/controllers/order.controller');

const buyerId = '507f1f77bcf86cd799439011';
const sellerId = '507f1f77bcf86cd799439012';
const productId = '507f1f77bcf86cd799439013';
const checkoutId = '507f1f77bcf86cd799439014';

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

function fakeSession() {
  return {
    withTransaction: async (fn) => fn(),
    endSession: async () => {}
  };
}

function shippingAddress() {
  return {
    fullName: 'Sita Sharma',
    phone: '9800000000',
    addressLine1: 'Lakeside Road',
    addressLine2: '',
    city: 'Pokhara',
    state: 'Gandaki',
    postalCode: '',
    country: 'Nepal'
  };
}

function withPatchedMocks(patches, run) {
  const restore = [];
  for (const [target, key, value] of patches) {
    restore.push([target, key, target[key]]);
    target[key] = value;
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [target, key, original] of restore.reverse()) {
        target[key] = original;
      }
    });
}

test('create order rejects a malformed checkout reference before touching the database', async () => {
  await withPatchedMocks([
    [mongoose, 'startSession', async () => fakeSession()]
  ], async () => {
    const res = responseRecorder();
    await createOrder({
      user: { _id: buyerId },
      body: {
        checkoutId: 'not-an-object-id',
        items: [{ productId, quantity: 1 }],
        paymentMethod: 'cash_on_delivery',
        shippingAddress: shippingAddress()
      }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /checkout reference is invalid/);
  });
});

test('create order rejects quantities above the per-item limit', async () => {
  await withPatchedMocks([
    [mongoose, 'startSession', async () => fakeSession()]
  ], async () => {
    const res = responseRecorder();
    await createOrder({
      user: { _id: buyerId },
      body: {
        items: [{ productId, quantity: 150 }],
        paymentMethod: 'cash_on_delivery',
        shippingAddress: shippingAddress()
      }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /between 1 and 99/);
  });
});

test('a repeated checkout reference returns the already-created orders instead of duplicating them', async () => {
  const existingOrders = [{ _id: 'existing-order', checkoutId, total: 1400 }];
  await withPatchedMocks([
    [mongoose, 'startSession', async () => fakeSession()],
    [Product, 'find', () => ({
      session() {
        return this;
      },
      lean: async () => [{ _id: productId, name: 'Local honey', price: 1200, stock: 5, seller: sellerId }]
    })],
    [userModel, 'find', () => ({
      select() {
        return this;
      },
      session() {
        return this;
      },
      lean: async () => [{ _id: sellerId, name: 'Honey Co', email: 'honey@example.com' }]
    })],
    [Checkout, 'create', async () => {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }],
    [Order, 'find', () => ({
      sort() {
        return this;
      },
      lean: async () => existingOrders
    })]
  ], async () => {
    const res = responseRecorder();
    await createOrder({
      user: { _id: buyerId },
      body: {
        checkoutId,
        items: [{ productId, quantity: 1 }],
        paymentMethod: 'cash_on_delivery',
        shippingAddress: shippingAddress()
      }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.duplicate, true);
    assert.deepEqual(res.body.orders, existingOrders);
  });
});

test('a stock race inside the transaction reports insufficient stock instead of overselling', async () => {
  await withPatchedMocks([
    [mongoose, 'startSession', async () => fakeSession()],
    [Product, 'find', () => ({
      session() {
        return this;
      },
      lean: async () => [{ _id: productId, name: 'Local honey', price: 1200, stock: 5, seller: sellerId }]
    })],
    [userModel, 'find', () => ({
      select() {
        return this;
      },
      session() {
        return this;
      },
      lean: async () => [{ _id: sellerId, name: 'Honey Co', email: 'honey@example.com' }]
    })],
    [Checkout, 'create', async () => {}],
    [Product, 'updateOne', async () => ({ modifiedCount: 0 })]
  ], async () => {
    const res = responseRecorder();
    await createOrder({
      user: { _id: buyerId },
      body: {
        items: [{ productId, quantity: 2 }],
        paymentMethod: 'cash_on_delivery',
        shippingAddress: shippingAddress()
      }
    }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /Insufficient stock/);
  });
});

test('create order prices items server-side, claims the checkout, and reserves stock', async () => {
  const claims = [];
  const stockUpdates = [];
  await withPatchedMocks([
    [mongoose, 'startSession', async () => fakeSession()],
    [Product, 'find', () => ({
      session() {
        return this;
      },
      lean: async () => [{ _id: productId, name: 'Local honey', price: 1200, stock: 10, seller: sellerId }]
    })],
    [userModel, 'find', () => ({
      select() {
        return this;
      },
      session() {
        return this;
      },
      lean: async () => [{ _id: sellerId, name: 'Honey Co', email: 'honey@example.com' }]
    })],
    [Checkout, 'create', async (docs) => {
      claims.push(docs[0]);
    }],
    [Product, 'updateOne', async (filter, update) => {
      stockUpdates.push({ filter, update });
      return { modifiedCount: 1 };
    }],
    [Order, 'create', async (docs) => docs],
    [userModel, 'updateOne', async () => ({})],
    [userModel, 'findById', () => ({ lean: async () => ({ name: 'Sita', email: 'sita@example.com' }) })],
    [emailService, 'sendOrderConfirmationToBuyer', async () => {}],
    [emailService, 'sendOrderNotificationToSeller', async () => {}]
  ], async () => {
    const res = responseRecorder();
    await createOrder({
      user: { _id: buyerId },
      body: {
        checkoutId,
        items: [{ productId, quantity: 2 }],
        paymentMethod: 'cash_on_delivery',
        shippingAddress: shippingAddress()
      }
    }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(String(res.body.checkoutId), checkoutId);
    assert.equal(res.body.orders.length, 1);
    assert.equal(res.body.orders[0].subtotal, 2400);
    assert.equal(res.body.orders[0].shippingCost, 200);
    assert.equal(res.body.orders[0].total, 2600);
    assert.equal(res.body.orders[0].orderStatus, 'CONFIRMED');
    assert.equal(claims.length, 1);
    assert.equal(String(claims[0]._id), checkoutId);
    assert.equal(String(claims[0].buyer), buyerId);
    assert.equal(stockUpdates.length, 1);
    assert.deepEqual(stockUpdates[0].update, { $inc: { stock: -2 } });
    assert.equal(stockUpdates[0].filter.stock.$gte, 2);
  });
});

test('orders over 5000 NPR per seller ship free', async () => {
  await withPatchedMocks([
    [mongoose, 'startSession', async () => fakeSession()],
    [Product, 'find', () => ({
      session() {
        return this;
      },
      lean: async () => [{ _id: productId, name: 'Local honey', price: 2600, stock: 10, seller: sellerId }]
    })],
    [userModel, 'find', () => ({
      select() {
        return this;
      },
      session() {
        return this;
      },
      lean: async () => [{ _id: sellerId, name: 'Honey Co', email: 'honey@example.com' }]
    })],
    [Checkout, 'create', async () => {}],
    [Product, 'updateOne', async () => ({ modifiedCount: 1 })],
    [Order, 'create', async (docs) => docs],
    [userModel, 'updateOne', async () => ({})],
    [userModel, 'findById', () => ({ lean: async () => ({ name: 'Sita', email: 'sita@example.com' }) })],
    [emailService, 'sendOrderConfirmationToBuyer', async () => {}],
    [emailService, 'sendOrderNotificationToSeller', async () => {}]
  ], async () => {
    const res = responseRecorder();
    await createOrder({
      user: { _id: buyerId },
      body: {
        items: [{ productId, quantity: 2 }],
        paymentMethod: 'cash_on_delivery',
        shippingAddress: shippingAddress()
      }
    }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.orders[0].subtotal, 5200);
    assert.equal(res.body.orders[0].shippingCost, 0);
    assert.equal(res.body.orders[0].total, 5200);
  });
});

test('seller fulfillment rejects unpaid eSewa and cancelled orders', async () => {
  for (const order of [
    { paymentMethod: 'esewa', paymentStatus: 'PENDING', orderStatus: 'PENDING', stockReleased: false },
    { paymentMethod: 'cash_on_delivery', paymentStatus: 'FAILED', orderStatus: 'CANCELLED', stockReleased: true }
  ]) {
    let saved = false;
    order.items = { id: () => ({ seller: sellerId, fulfillmentStatus: 'PENDING' }), every: () => false, some: () => false };
    order.save = async () => { saved = true; };
    await withPatchedMocks([
      [Order, 'findById', async () => order]
    ], async () => {
      const res = responseRecorder();
      await updateSellerFulfillment({
        params: { orderId: '507f1f77bcf86cd799439015', itemId: '507f1f77bcf86cd799439016' },
        user: { _id: sellerId },
        body: { fulfillmentStatus: 'DELIVERED' }
      }, res);
      assert.equal(res.statusCode, 409);
      assert.equal(saved, false);
    });
  }
});
