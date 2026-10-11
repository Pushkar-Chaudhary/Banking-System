const Order = require('../models/order.model');
const {
  createEsewaForm,
  verifyEsewaResponse,
  verifyEsewaTransaction
} = require('../services/payment.service');
const mongoose = require('mongoose');
const { releaseOrderStock } = require('../services/inventory.service');
const userModel = require('../models/user.model');
const { decryptSellerSecret } = require('../services/seller-payment.service');

function frontendUrl(path) {
  const baseUrl = (process.env.FRONTEND_URL || process.env.API_PUBLIC_URL || 'http://localhost:5173').replace(/\/+$/, '');
  return `${baseUrl}${path}`;
}

async function initiateEsewaPayment(req, res) {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ message: 'Order ID is required' });
    }

    const order = await Order.findOne({ _id: orderId, buyer: req.user._id });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    if (order.paymentMethod !== 'esewa') {
      return res.status(400).json({ message: 'This order is not set up for eSewa payment' });
    }
    if (order.paymentStatus === 'PAID') {
      return res.status(409).json({ message: 'This order has already been paid' });
    }
    if (order.orderStatus !== 'PENDING' || order.stockReleased) {
      return res.status(409).json({ message: 'This order is no longer eligible for payment' });
    }
    if (order.paymentExpiresAt && order.paymentExpiresAt <= new Date()) {
      return res.status(409).json({ message: 'The payment reservation expired. Please place the order again.' });
    }
    if (order.transactionId && order.paymentStatus === 'PENDING') {
      return res.status(409).json({ message: 'A payment attempt is already in progress for this order' });
    }
    if (process.env.NODE_ENV === 'production'
      && (!process.env.API_PUBLIC_URL || !process.env.API_PUBLIC_URL.startsWith('https://'))) {
      return res.status(503).json({ message: 'Set API_PUBLIC_URL to the public HTTPS API origin before enabling live payments' });
    }

    const sellerId = order.items[0]?.seller;
    if (!sellerId || order.items.some((item) => String(item.seller) !== String(sellerId))) {
      return res.status(409).json({ message: 'eSewa payment must be for one seller order' });
    }
    const seller = await userModel.findOne({ _id: sellerId, role: 'seller', isActive: { $ne: false } })
      .select('paymentSettings.esewa.merchantCode +paymentSettings.esewa.secretCiphertext')
      .lean();
    const merchantCode = seller?.paymentSettings?.esewa?.merchantCode;
    const encryptedSecret = seller?.paymentSettings?.esewa?.secretCiphertext;
    if (!merchantCode || !encryptedSecret) {
      return res.status(409).json({ message: 'This seller has not connected an eSewa merchant account' });
    }
    const merchantSecret = decryptSellerSecret(encryptedSecret);
    const transactionUuid = require('crypto').randomUUID();
    const apiBase = (process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const callback = `${apiBase}/api/v1/payments/esewa/callback`;
    const payment = createEsewaForm({
      amount: order.total,
      transactionUuid,
      productCode: merchantCode,
      successUrl: callback,
      failureUrl: callback,
      merchantSecret
    });

    // Claim the order for this attempt atomically so two parallel
    // initiations cannot both hand the buyer a usable payment form.
    const claimed = await Order.findOneAndUpdate(
      {
        _id: order._id,
        paymentStatus: 'PENDING',
        stockReleased: false,
        orderStatus: 'PENDING',
        $or: [{ transactionId: '' }, { transactionId: { $exists: false } }, { transactionId: null }]
      },
      {
        $set: {
          transactionId: transactionUuid,
          paymentProductCode: merchantCode,
          paymentSecretCiphertext: encryptedSecret,
          paymentExpiresAt: new Date(Date.now() + 30 * 60 * 1000)
        }
      },
      { new: true }
    );
    if (!claimed) {
      return res.status(409).json({ message: 'A payment attempt is already in progress for this order' });
    }

    return res.json({
      message: 'eSewa payment initialized',
      ...payment,
      transactionId: transactionUuid,
      orderId: order._id
    });
  } catch (error) {
    console.error('eSewa payment initiation failed:', error.message);
    return res.status(500).json({ message: 'Failed to initialize eSewa payment' });
  }
}

async function processEsewaCallback(req, res) {
  try {
    const encodedData = typeof req.query.data === 'string' ? req.query.data : '';
    if (!encodedData || encodedData.length > 10000) {
      return res.redirect(frontendUrl('/payment/result?status=unverified'));
    }

    const payload = JSON.parse(Buffer.from(encodedData.replace(/ /g, '+'), 'base64').toString('utf8'));
    const order = await Order.findOne({ transactionId: payload.transaction_uuid })
      .select('+paymentSecretCiphertext');
    if (!order || order.paymentMethod !== 'esewa') {
      return res.redirect(frontendUrl('/payment/result?status=unverified'));
    }

    const sellerSecret = order.paymentSecretCiphertext
      ? decryptSellerSecret(order.paymentSecretCiphertext)
      : process.env.ESEWA_MERCHANT_SECRET;
    const merchantCode = order.paymentProductCode || process.env.ESEWA_MERCHANT_CODE;
    const signatureValid = verifyEsewaResponse(payload, sellerSecret);
    const valuesMatch = payload.product_code === merchantCode
      && String(payload.transaction_uuid) === String(order.transactionId)
      && Number(payload.total_amount) === Number(order.total);

    if (!signatureValid || !valuesMatch || order.stockReleased) {
      console.error('eSewa callback failed signature or order validation');
      return res.redirect(frontendUrl(`/payment/result?orderId=${order._id}&status=unverified`));
    }

    const verification = await verifyEsewaTransaction({
      totalAmount: order.total,
      transactionUuid: order.transactionId,
      productCode: merchantCode
    });

    const providerConfirmed = verification.status === 'COMPLETE'
      && verification.product_code === merchantCode
      && String(verification.transaction_uuid) === String(order.transactionId)
      && Number(verification.total_amount) === Number(order.total);

    if (providerConfirmed) {
      const session = await mongoose.startSession();
      let confirmed = false;
      try {
        await session.withTransaction(async () => {
          const currentOrder = await Order.findOne({
            _id: order._id,
            paymentStatus: 'PENDING',
            stockReleased: false,
            transactionId: payload.transaction_uuid
          }).session(session);
          if (!currentOrder) return;

          currentOrder.paymentStatus = 'PAID';
          currentOrder.orderStatus = 'CONFIRMED';
          currentOrder.paymentExpiresAt = null;
          currentOrder.transactionReference = verification.ref_id || payload.transaction_code || '';
          await currentOrder.save({ session });
          confirmed = true;
        });
      } finally {
        await session.endSession();
      }
      const finalStatus = confirmed || order.paymentStatus === 'PAID' ? 'paid' : 'pending';
      const destination = order.checkoutId
        ? `/checkout/payments?checkoutId=${order.checkoutId}&status=${finalStatus}`
        : `/payment/result?orderId=${order._id}&status=${finalStatus}`;
      return res.redirect(frontendUrl(destination));
    }

    if (['NOT_FOUND', 'CANCELED'].includes(verification.status)) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const currentOrder = await Order.findOne({
            _id: order._id,
            paymentStatus: 'PENDING',
            stockReleased: false,
            transactionId: payload.transaction_uuid
          }).session(session);
          if (currentOrder) await releaseOrderStock(currentOrder, session);
        });
      } finally {
        await session.endSession();
      }
    }

    const destination = order.checkoutId
      ? `/checkout/payments?checkoutId=${order.checkoutId}&status=pending`
      : `/payment/result?orderId=${order._id}&status=pending`;
    return res.redirect(frontendUrl(destination));
  } catch (error) {
    console.error('eSewa callback verification failed:', error.message);
    return res.redirect(frontendUrl('/payment/result?status=unverified'));
  }
}

module.exports = {
  initiateEsewaPayment,
  processEsewaCallback
};
