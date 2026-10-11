require('dotenv').config();
const app = require('../src/app');
const connectDB = require('../src/config/db');
const { ensureDefaultCategories } = require('../src/services/catalog.service');
const { expirePendingEsewaOrders } = require('../src/services/inventory.service');

let categoriesInitialized = false;
let lastCleanupAt = 0;

// Serverless instances have no background timers, so expired eSewa
// reservations are released opportunistically on incoming requests.
function scheduleExpiredPaymentCleanup() {
  const now = Date.now();
  if (now - lastCleanupAt < 60 * 1000) return;
  lastCleanupAt = now;
  expirePendingEsewaOrders()
    .then((count) => {
      if (count) console.log(`Released expired eSewa reservations for ${count} order(s)`);
    })
    .catch((error) => console.error('Expired eSewa order cleanup failed:', error.message));
}

module.exports = async (req, res) => {
  try {
    await connectDB();
    if (!categoriesInitialized) {
      await ensureDefaultCategories().catch((e) => console.warn('Categories init warning:', e.message));
      categoriesInitialized = true;
    }
    scheduleExpiredPaymentCleanup();
  } catch (err) {
    console.error('Database connection error in Vercel serverless function:', err.message);
    return res.status(500).json({
      message: 'Database connection failed. Please ensure MONGO_URI is configured correctly in Vercel environment variables.'
    });
  }

  return app(req, res);
};
