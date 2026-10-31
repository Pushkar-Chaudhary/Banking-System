require('dotenv').config();
const app = require('../src/app');
const connectDB = require('../src/config/db');
const { ensureDefaultCategories } = require('../src/services/catalog.service');
const { expirePendingEsewaOrders } = require('../src/services/inventory.service');
const { getProductionConfigErrors } = require('../src/config/production-env');

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
  if (req.method === 'GET' && req.url?.split('?')[0] === '/health/live') {
    return app(req, res);
  }

  const productionConfigErrors = getProductionConfigErrors();
  if (productionConfigErrors.length) {
    console.error('Vercel API production configuration is invalid:', productionConfigErrors);
    return res.status(503).json({ message: 'API production configuration is incomplete.' });
  }

  try {
    await connectDB();
    if (!categoriesInitialized) {
      await ensureDefaultCategories();
      categoriesInitialized = true;
    }
    scheduleExpiredPaymentCleanup();
  } catch (err) {
    console.error('Vercel API initialization failed:', err.message);
    return res.status(500).json({
      message: 'The API could not connect to MongoDB or initialize marketplace data. Check MONGO_URI and database availability.'
    });
  }

  return app(req, res);
};
