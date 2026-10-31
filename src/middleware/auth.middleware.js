const jwt = require('jsonwebtoken');
const userModel = require('../models/user.model');

async function protect(req, res, next) {
  let token;

  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ message: 'Authentication service is not configured' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userModel.findById(decoded.id).select('-password +sessionVersion');

    if (!user) {
      return res.status(401).json({ message: 'User no longer exists' });
    }

    if (decoded.sessionVersion !== (user.sessionVersion || 0)) {
      return res.status(401).json({ message: 'Session expired. Please sign in again.' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ message: 'User account is suspended' });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden: insufficient permissions' });
    }

    return next();
  };
}

module.exports = { protect, authorize };
