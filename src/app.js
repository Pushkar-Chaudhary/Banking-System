require('dotenv').config();
const express = require('express');
const authRouter = require('./routes/auth.routes');
const productRouter = require('./routes/product.routes');
const userRouter = require('./routes/user.routes');
const orderRouter = require('./routes/order.routes');
const paymentRouter = require('./routes/payment.routes');
const adminRouter = require('./routes/admin.routes');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const cors = require('cors');

const app = express();
const frontendBuild = path.join(__dirname, '..', 'dist');

app.disable('x-powered-by');
// Trust exactly the configured number of proxy hops so rate limiting sees real client IPs.
// Unset or non-numeric values disable trust so spoofed X-Forwarded-For headers cannot bypass rate limits.
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY, 10);
app.set('trust proxy', Number.isInteger(trustProxyHops) && trustProxyHops > 0 ? trustProxyHops : false);

function parseOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const allowedOrigins = new Set(
  [process.env.FRONTEND_URL, process.env.API_PUBLIC_URL].map(parseOrigin).filter(Boolean)
);
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.add('http://localhost:5173');
  allowedOrigins.add('http://localhost:3000');
  allowedOrigins.add('http://localhost:4173');
}

app.use(cors({
  origin: (origin, callback) => {
    // No origin header: same-origin GETs, curl, or native apps.
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    // Accept scheme variations (http/https) of an allowlisted host.
    try {
      const requestedHost = new URL(origin).host;
      if ([...allowedOrigins].some((allowed) => new URL(allowed).host === requestedHost)) {
        return callback(null, true);
      }
    } catch {
      // Fall through to rejection for malformed origins.
    }
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': ["'self'", 'data:', 'https:'],
      'form-action': ["'self'", 'https://epay.esewa.com.np', 'https://rc-epay.esewa.com.np']
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many authentication attempts. Please try again later.' }
});
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down and try again shortly.' }
});

app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);
app.use('/api/v1/auth/send-registration-otp', authLimiter);
app.use('/api/v1/auth/forgot-password', authLimiter);
app.use('/api/v1/auth/reset-password', authLimiter);
app.use('/api/v1/orders', (req, res, next) => (req.method === 'POST' ? sensitiveLimiter(req, res, next) : next()));
app.use('/api/v1/payments/esewa/initiate', sensitiveLimiter);

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/products', productRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/orders', orderRouter);
app.use('/api/v1/payments', paymentRouter);
app.use('/api/v1/admin', adminRouter);

app.get('/health', (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  return res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' });
});

app.get('/health/live', (req, res) => {
  res.json({ status: 'ok' });
});

if (fs.existsSync(frontendBuild)) {
  app.use(express.static(frontendBuild, { index: false, maxAge: '1d' }));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    return res.sendFile(path.join(frontendBuild, 'index.html'));
  });
}

app.use('/api', (req, res) => {
  res.status(404).json({ message: 'API endpoint not found' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body contains invalid JSON' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large' });
  }

  console.error('Unhandled app error:', error);
  return res.status(500).json({
    message: 'Something went wrong on the server',
    error: process.env.NODE_ENV === 'production' ? undefined : error.message
  });
});

module.exports = app;