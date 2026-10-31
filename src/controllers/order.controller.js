const mongoose = require('mongoose');
const Order = require('../models/order.model');
const Product = require('../models/product.model');
const Checkout = require('../models/checkout.model');
const userModel = require('../models/user.model');
const emailService = require('../services/email.service');
const { releaseOrderStock } = require('../services/inventory.service');
const { serverError } = require('../services/http.service');
const { PROVINCES } = require('../constants/nepal');
const { decryptSellerSecret } = require('../services/seller-payment.service');
const { parsePagination } = require('../services/pagination.service');

function calculateShipping(subtotal) {
  return subtotal >= 5000 ? 0 : 200;
}

function normalizeShippingAddress(shippingAddress) {
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  return {
    fullName: text(shippingAddress.fullName),
    phone: text(shippingAddress.phone),
    addressLine1: text(shippingAddress.addressLine1),
    addressLine2: text(shippingAddress.addressLine2),
    city: text(shippingAddress.city),
    state: text(shippingAddress.state),
    postalCode: text(shippingAddress.postalCode),
    country: text(shippingAddress.country)
  };
}

async function findCheckoutOrders(checkoutId, buyerId) {
  return Order.find({ checkoutId, buyer: buyerId }).sort({ createdAt: 1 }).lean();
}

async function createOrder(req, res) {
  const session = await mongoose.startSession();
  let orderDocs = [];
  let checkoutId;

  try {
    const { items, paymentMethod } = req.body;
    const shippingAddress = normalizeShippingAddress(req.body.shippingAddress || {});

    const requestedCheckoutId = typeof req.body.checkoutId === 'string' ? req.body.checkoutId.trim() : '';
    if (requestedCheckoutId && !mongoose.isValidObjectId(requestedCheckoutId)) {
      return res.status(400).json({ message: 'The checkout reference is invalid' });
    }

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      return res.status(400).json({ message: 'Provide between 1 and 50 order items' });
    }

    const addressFields = ['fullName', 'phone', 'addressLine1', 'city', 'state', 'country'];
    if (addressFields.some((field) => !shippingAddress[field] || shippingAddress[field].length > 160)) {
      return res.status(400).json({ message: 'Complete shipping information is required' });
    }
    if (shippingAddress.country !== 'Nepal'
      || !PROVINCES.includes(shippingAddress.state)) {
      return res.status(400).json({ message: 'Delivery is currently available only within Nepal' });
    }

    if (!['cash_on_delivery', 'esewa'].includes(paymentMethod)) {
      return res.status(400).json({ message: 'Choose a supported payment method' });
    }

    const quantities = new Map();
    for (const item of items) {
      if (!mongoose.isValidObjectId(item.productId)) {
        return res.status(400).json({ message: 'An order item has an invalid product ID' });
      }
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return res.status(400).json({ message: 'Product quantities must be between 1 and 99' });
      }
      const id = String(item.productId);
      quantities.set(id, (quantities.get(id) || 0) + quantity);
    }

    const productIds = [...quantities.keys()];
    const products = await Product.find({
      _id: { $in: productIds },
      isActive: true,
      sellerModeActive: true,
      'location.country': 'Nepal'
    }).session(session).lean();

    if (products.length !== productIds.length) {
      return res.status(400).json({ message: 'One or more products are unavailable' });
    }

    const productMap = new Map(products.map((product) => [String(product._id), product]));
    const normalizedItems = [];
    const sellerItems = new Map();
    for (const [productId, quantity] of quantities) {
      const product = productMap.get(productId);
      if (!product) {
        return res.status(400).json({ message: 'One or more products are unavailable' });
      }

      if (product.stock < quantity) {
        return res.status(400).json({ message: `Insufficient stock for ${product.name}` });
      }

      const itemSubtotal = product.price * quantity;
      normalizedItems.push({
        product: product._id,
        seller: product.seller,
        productName: product.name,
        price: product.price,
        quantity,
        subtotal: itemSubtotal
      });
      const sellerId = String(product.seller);
      if (!sellerItems.has(sellerId)) sellerItems.set(sellerId, []);
      sellerItems.get(sellerId).push(normalizedItems[normalizedItems.length - 1]);
    }

    const sellers = await userModel.find({
      _id: { $in: [...sellerItems.keys()] },
      role: 'seller',
      isActive: { $ne: false }
    }).select('name email phone paymentSettings.esewa.merchantCode +paymentSettings.esewa.secretCiphertext')
      .session(session)
      .lean();
    if (paymentMethod === 'esewa') {
      const unavailableSeller = sellers.find((seller) => {
        const esewa = seller.paymentSettings?.esewa;
        if (!esewa?.merchantCode || !esewa?.secretCiphertext) return true;
        try {
          decryptSellerSecret(esewa.secretCiphertext);
        } catch {
          return true;
        }
        return false;
      });
      if (sellers.length !== sellerItems.size || unavailableSeller) {
        return res.status(409).json({
          message: unavailableSeller
            ? `${unavailableSeller.name} has no usable eSewa merchant connection`
            : 'One or more sellers are unavailable for online payment'
        });
      }
    } else if (sellers.length !== sellerItems.size) {
      return res.status(409).json({ message: 'One or more sellers are unavailable' });
    }

    checkoutId = requestedCheckoutId
      ? new mongoose.Types.ObjectId(requestedCheckoutId)
      : new mongoose.Types.ObjectId();
    const orderInputs = [];
    for (const [sellerId, itemsForSeller] of sellerItems) {
      const sellerSubtotal = itemsForSeller.reduce((sum, item) => sum + item.subtotal, 0);
      const shippingCost = calculateShipping(sellerSubtotal);
      orderInputs.push({
        checkoutId,
        buyer: req.user._id,
        items: itemsForSeller,
        shippingAddress,
        paymentMethod,
        paymentStatus: 'PENDING',
        orderStatus: paymentMethod === 'cash_on_delivery' ? 'CONFIRMED' : 'PENDING',
        subtotal: sellerSubtotal,
        shippingCost,
        discount: 0,
        total: sellerSubtotal + shippingCost,
        paymentExpiresAt: paymentMethod === 'esewa' ? new Date(Date.now() + 30 * 60 * 1000) : null
      });
    }

    await session.withTransaction(async () => {
      await Checkout.create([{ _id: checkoutId, buyer: req.user._id }], { session });

      for (const item of normalizedItems) {
        const result = await Product.updateOne(
          {
            _id: item.product,
            isActive: true,
            sellerModeActive: true,
            'location.country': 'Nepal',
            stock: { $gte: item.quantity }
          },
          { $inc: { stock: -item.quantity } },
          { session }
        );
        if (result.modifiedCount !== 1) {
          throw new Error(`Insufficient stock for ${item.productName}`);
        }
      }

      orderDocs = await Order.create(orderInputs, { session });

      await userModel.updateOne({ _id: req.user._id }, { $set: { cart: [] } }, { session });
    });

    const buyer = await userModel.findById(req.user._id).lean();
    const checkoutTotal = orderDocs.reduce((sum, order) => sum + order.total, 0);

    // 1. Send detailed order confirmation email to the buyer
    try {
      await emailService.sendOrderConfirmationToBuyer({
        buyerEmail: buyer.email,
        buyerName: buyer.name,
        orders: orderDocs,
        shippingAddress,
        paymentMethod,
        checkoutTotal
      });
    } catch (emailError) {
      console.error('Order confirmation email to buyer failed:', emailError.message);
    }

    // 2. Send detailed order notification emails to each seller
    const sellerMap = new Map(sellers.map((s) => [String(s._id), s]));
    for (const order of orderDocs) {
      const firstItem = order.items[0];
      const sellerId = String(firstItem?.seller);
      const seller = sellerMap.get(sellerId);
      if (seller && seller.email) {
        try {
          await emailService.sendOrderNotificationToSeller({
            sellerEmail: seller.email,
            sellerName: seller.name,
            order,
            sellerItems: order.items,
            buyerInfo: {
              name: buyer.name,
              email: buyer.email,
              phone: shippingAddress.phone || buyer.phone
            },
            shippingAddress
          });
        } catch (sellerEmailError) {
          console.error(`Order notification email to seller ${seller.email} failed:`, sellerEmailError.message);
        }
      }
    }

    return res.status(201).json({
      message: 'Seller orders created successfully',
      checkoutId,
      orders: orderDocs,
      order: orderDocs[0]
    });
  } catch (error) {
    if (error && error.code === 11000 && checkoutId) {
      // The checkout was already submitted (double click or network retry).
      // Return the existing orders instead of creating duplicates.
      const existingOrders = await findCheckoutOrders(checkoutId, req.user._id);
      if (existingOrders.length) {
        return res.status(200).json({
          message: 'These orders were already placed for this checkout',
          checkoutId,
          orders: existingOrders,
          order: existingOrders[0],
          duplicate: true
        });
      }
      return res.status(409).json({ message: 'This checkout reference was already used' });
    }
    const clientError = typeof error?.message === 'string' && error.message.startsWith('Insufficient stock');
    if (clientError) {
      return res.status(409).json({ message: error.message });
    }
    return serverError(res, 'Failed to create order', error);
  } finally {
    await session.endSession();
  }
}

async function getCheckoutOrders(req, res) {
  if (!mongoose.isValidObjectId(req.params.checkoutId)) {
    return res.status(400).json({ message: 'Invalid checkout ID' });
  }
  try {
    const orders = await Order.find({
      checkoutId: req.params.checkoutId,
      buyer: req.user._id
    }).populate('items.seller', 'name')
      .sort({ createdAt: 1 })
      .lean();
    if (!orders.length) return res.status(404).json({ message: 'Checkout not found' });
    return res.json({
      checkoutId: req.params.checkoutId,
      orders: orders.map((order) => ({
        _id: order._id,
        total: order.total,
        subtotal: order.subtotal,
        shippingCost: order.shippingCost,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        paymentExpiresAt: order.paymentExpiresAt,
        paymentStarted: Boolean(order.transactionId),
        canPay: order.paymentStatus === 'PENDING'
          && !order.transactionId
          && !order.stockReleased
          && (!order.paymentExpiresAt || order.paymentExpiresAt > new Date()),
        sellerName: order.items[0]?.seller?.name || 'Local seller'
      }))
    });
  } catch (error) {
    return serverError(res, 'Failed to fetch checkout orders', error);
  }
}

async function getMyOrders(req, res) {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const [orders, total] = await Promise.all([
      Order.find({ buyer: req.user._id }).sort({ createdAt: -1 }).populate('items.product', 'name images').skip(skip).limit(limit).lean(),
      Order.countDocuments({ buyer: req.user._id })
    ]);
    return res.json({ orders, page, pages: Math.ceil(total / limit) || 1, total });
  } catch (error) {
    return serverError(res, 'Failed to fetch orders', error);
  }
}

async function getOrderById(req, res) {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product', 'name images')
      .populate('buyer', 'name email phone')
      .lean();
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const isBuyer = String(order.buyer?._id || order.buyer) === String(req.user._id);
    const isSeller = order.items.some((item) => String(item.seller) === String(req.user._id));
    const isAdmin = req.user.role === 'admin';

    if (!isBuyer && !isSeller && !isAdmin) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (isSeller && !isBuyer && !isAdmin) {
      order.items = order.items.filter((item) => String(item.seller) === String(req.user._id));
      // Keep buyer and shipping details so the seller has full customer info to fulfill the order
    }
    return res.json({ order });
  } catch (error) {
    return serverError(res, 'Failed to fetch order', error);
  }
}

async function updateOrderStatus(req, res) {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins may update an order-level status' });
    }

    const { orderStatus } = req.body;
    const allowedStatuses = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
    if (!allowedStatuses.includes(orderStatus)) {
      return res.status(400).json({ message: 'Invalid order status' });
    }
    if (orderStatus === 'CANCELLED' && order.paymentStatus === 'PAID') {
      return res.status(409).json({ message: 'A paid order must be refunded through the payment provider before cancellation' });
    }
    if (orderStatus === 'CANCELLED' && order.paymentMethod === 'esewa'
      && order.paymentStatus === 'PENDING' && order.transactionId
      && order.paymentExpiresAt > new Date()) {
      return res.status(409).json({ message: 'Wait for the pending eSewa attempt to finish or expire before cancellation' });
    }
    if (orderStatus === 'CANCELLED' && !order.stockReleased) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const currentOrder = await Order.findById(order._id).session(session);
          if (currentOrder && !currentOrder.stockReleased) {
            await releaseOrderStock(currentOrder, session);
          }
        });
      } finally {
        await session.endSession();
      }
      return res.json({ message: 'Order cancelled and reserved stock released', order: await Order.findById(order._id) });
    }
    order.orderStatus = orderStatus;

    await order.save();
    return res.json({ message: 'Order status updated successfully', order });
  } catch (error) {
    return serverError(res, 'Failed to update order status', error);
  }
}

async function updateSellerFulfillment(req, res) {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.stockReleased || order.orderStatus === 'CANCELLED') {
      return res.status(409).json({ message: 'Cancelled orders cannot be fulfilled' });
    }
    if (order.paymentMethod === 'esewa' && order.paymentStatus !== 'PAID') {
      return res.status(409).json({ message: 'eSewa orders can only be fulfilled after payment is confirmed' });
    }

    const item = order.items.id(req.params.itemId);
    if (!item || String(item.seller) !== String(req.user._id)) {
      return res.status(404).json({ message: 'Order item not found for this seller' });
    }

    const allowedStatuses = ['PROCESSING', 'SHIPPED', 'DELIVERED'];
    if (!allowedStatuses.includes(req.body.fulfillmentStatus)) {
      return res.status(400).json({ message: 'Invalid fulfillment status' });
    }

    item.fulfillmentStatus = req.body.fulfillmentStatus;
    if (order.items.every((orderItem) => orderItem.fulfillmentStatus === 'DELIVERED')) {
      order.orderStatus = 'DELIVERED';
      if (order.paymentMethod === 'cash_on_delivery') {
        order.paymentStatus = 'PAID';
      }
    } else if (order.items.some((orderItem) => orderItem.fulfillmentStatus === 'SHIPPED')) {
      order.orderStatus = 'SHIPPED';
    } else if (order.items.some((orderItem) => orderItem.fulfillmentStatus === 'PROCESSING')) {
      order.orderStatus = 'PROCESSING';
    }
    await order.save();
    return res.json({ message: 'Fulfillment status updated', order });
  } catch (error) {
    return serverError(res, 'Failed to update fulfillment status', error);
  }
}

async function getSellerOrders(req, res) {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const sellerFilter = { 'items.seller': req.user._id };
    const [orders, total, sales] = await Promise.all([
      Order.find(sellerFilter)
        .sort({ createdAt: -1 })
        .populate('items.product', 'name images')
        .populate('buyer', 'name email phone')
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(sellerFilter),
      Order.aggregate([
        {
          $match: {
            'items.seller': req.user._id,
            $or: [
              { paymentStatus: 'PAID' },
              { paymentMethod: 'cash_on_delivery', orderStatus: 'DELIVERED' }
            ]
          }
        },
        { $unwind: '$items' },
        { $match: { 'items.seller': req.user._id } },
        { $group: { _id: null, total: { $sum: '$items.subtotal' } } }
      ])
    ]);

    const sellerOrders = orders.map((order) => {
      const myItems = order.items.filter((item) => String(item.seller) === String(req.user._id));
      const sellerSubtotal = myItems.reduce((sum, item) => sum + item.subtotal, 0);
      return {
        ...order,
        items: myItems,
        sellerSubtotal
      };
    });
    return res.json({
      orders: sellerOrders,
      page,
      pages: Math.ceil(total / limit) || 1,
      total,
      salesTotal: sales[0]?.total || 0
    });
  } catch (error) {
    return serverError(res, 'Failed to fetch seller orders', error);
  }
}

module.exports = {
  createOrder,
  getCheckoutOrders,
  getMyOrders,
  getOrderById,
  updateOrderStatus,
  updateSellerFulfillment,
  getSellerOrders
};
