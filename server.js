require('dotenv').config();
const { getProductionConfigErrors } = require('./src/config/production-env');
const productionConfigErrors = getProductionConfigErrors();
if (productionConfigErrors.length) {
  throw new Error(`Invalid production configuration:\n- ${productionConfigErrors.join('\n- ')}`);
}

const app = require('./src/app');
const connectDB = require('./src/config/db');
const { expirePendingEsewaOrders } = require('./src/services/inventory.service');
const { ensureDefaultCategories } = require('./src/services/catalog.service');
const mongoose = require('mongoose');

const PORT = process.env.PORT || 3000;
let httpServer;

connectDB().then(async () => {
  await ensureDefaultCategories();
  const cleanupExpiredPayments = () => expirePendingEsewaOrders().catch((error) => {
    console.error('Expired eSewa order cleanup failed:', error.message);
  });
  cleanupExpiredPayments();
  const cleanupTimer = setInterval(cleanupExpiredPayments, 60 * 1000);
  cleanupTimer.unref();

  httpServer = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}).catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`${signal} received; closing server`);
  if (!httpServer) {
    process.exit(0);
  }
  httpServer.close(() => {
    mongoose.disconnect()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('Database shutdown failed:', error.message);
        process.exit(1);
      });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));