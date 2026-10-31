function isHttpsOrigin(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && url.pathname === '/'
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function getProductionConfigErrors(env = process.env) {
  if (env.NODE_ENV !== 'production') return [];

  const errors = [];
  if (!env.MONGO_URI) errors.push('MONGO_URI is required');
  if (!env.JWT_SECRET || Buffer.byteLength(env.JWT_SECRET) < 32) {
    errors.push('JWT_SECRET must be at least 32 bytes');
  }
  if (!env.JWT_EXPIRES_IN) errors.push('JWT_EXPIRES_IN is required');
  if (!isHttpsOrigin(env.API_PUBLIC_URL)) errors.push('API_PUBLIC_URL must be an HTTPS origin');
  if (!isHttpsOrigin(env.FRONTEND_URL)) errors.push('FRONTEND_URL must be an HTTPS origin');

  const trustProxy = Number(env.TRUST_PROXY);
  if (!Number.isInteger(trustProxy) || trustProxy < 1) {
    errors.push('TRUST_PROXY must be a positive integer in production');
  }

  const encryptionKey = env.SELLER_PAYMENT_ENCRYPTION_KEY || '';
  const decodedEncryptionKey = Buffer.from(encryptionKey, 'base64');
  if (decodedEncryptionKey.length !== 32 || decodedEncryptionKey.toString('base64') !== encryptionKey) {
    errors.push('SELLER_PAYMENT_ENCRYPTION_KEY must be base64 encoding of exactly 32 bytes');
  }

  const emailPassword = env.SMTP_PASS || env.EMAIL_PASS || env.EMAIL_PASSWORD;
  const hasSmtp = Boolean(env.SMTP_HOST && (env.SMTP_USER || env.EMAIL_USER) && emailPassword);
  const hasAppPassword = Boolean(env.EMAIL_USER && (env.EMAIL_PASS || env.EMAIL_PASSWORD));
  const hasOAuth = Boolean(env.EMAIL_USER && env.CLIENT_ID && env.CLIENT_SECRET && env.REFRESH_TOKEN);
  if (!hasSmtp && !hasAppPassword && !hasOAuth) {
    errors.push('Configure SMTP, an email app password, or Gmail OAuth for production email');
  }

  return errors;
}

module.exports = { getProductionConfigErrors };