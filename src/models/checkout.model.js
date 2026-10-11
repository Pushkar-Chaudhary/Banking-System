const mongoose = require('mongoose');

// One claim document per checkout submission. The _id doubles as the
// idempotency key so a retried/double-clicked checkout cannot create
// duplicate orders or double-decrement stock.
const checkoutSchema = new mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: false
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: true,
      index: true
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 60 * 60 * 24 * 7
    }
  },
  {
    _id: false,
    versionKey: false
  }
);

module.exports = mongoose.model('Checkout', checkoutSchema);
