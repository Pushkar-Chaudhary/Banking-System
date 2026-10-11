const userModel = require('../models/user.model');
const Product = require('../models/product.model');
const mongoose = require('mongoose');
const { serverError } = require('../services/http.service');
const { applyMarketplaceRole } = require('../services/role.service');

async function getProfile(req, res) {
  try {
    const user = await userModel.findById(req.user._id).select('-password').lean();
    return res.json({ user });
  } catch (error) {
    return serverError(res, 'Failed to fetch profile', error);
  }
}

async function updateProfile(req, res) {
  try {
    const user = await userModel.findById(req.user._id);
    const { name, email, phone, address } = req.body;

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName || trimmedName.length > 120) {
        return res.status(400).json({ message: 'Provide a name between 1 and 120 characters' });
      }
      user.name = trimmedName;
    }
    if (email !== undefined) {
      user.email = String(email).trim().toLowerCase();
    }
    if (phone !== undefined) {
      user.phone = String(phone).trim().slice(0, 20);
    }
    if (address !== undefined) {
      user.address = String(address).trim().slice(0, 240);
    }

    await user.save();

    const safeUser = user.toObject();
    delete safeUser.password;
    return res.json({ message: 'Profile updated successfully', user: safeUser });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'That email address is already in use by another account' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    return serverError(res, 'Failed to update profile', error);
  }
}

async function getCart(req, res) {
  try {
    const user = await userModel.findById(req.user._id)
      .populate({
        path: 'cart.product',
        select: 'name price images stock isActive sellerModeActive location seller',
        populate: { path: 'seller', select: 'name paymentSettings.esewa.merchantCode' }
      })
      .lean();
    return res.json({ cart: user.cart || [] });
  } catch (error) {
    return serverError(res, 'Failed to fetch cart', error);
  }
}

async function addToCart(req, res) {
  try {
    const { productId, quantity = 1 } = req.body;
    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ message: 'A valid product ID is required' });
    }

    const parsedQty = Number(quantity);
    if (!Number.isInteger(parsedQty) || parsedQty <= 0 || parsedQty > 99) {
      return res.status(400).json({ message: 'Quantity must be between 1 and 99' });
    }

    const product = await Product.findOne({
      _id: productId,
      isActive: true,
      sellerModeActive: true,
      'location.country': 'Nepal'
    }).select('stock');
    if (!product || product.stock < parsedQty) {
      return res.status(409).json({ message: 'Product is unavailable or has insufficient stock' });
    }

    const user = await userModel.findById(req.user._id);
    const existingItem = user.cart.find((item) => String(item.product) === String(productId));
    if ((existingItem?.quantity || 0) + parsedQty > product.stock) {
      return res.status(409).json({ message: 'Requested cart quantity exceeds available stock' });
    }

    if (existingItem) {
      existingItem.quantity += parsedQty;
    } else {
      user.cart.push({ product: productId, quantity: parsedQty });
    }

    await user.save();
    return res.json({ message: 'Item added to cart', cart: user.cart });
  } catch (error) {
    return serverError(res, 'Failed to add item to cart', error);
  }
}

async function updateCartItem(req, res) {
  try {
    const { quantity } = req.body;
    if (!Number.isInteger(Number(quantity)) || Number(quantity) <= 0 || Number(quantity) > 99) {
      return res.status(400).json({ message: 'Quantity must be between 1 and 99' });
    }

    const user = await userModel.findById(req.user._id);
    const item = user.cart.find((cartItem) => String(cartItem.product) === String(req.params.productId));
    if (!item) {
      return res.status(404).json({ message: 'Cart item not found' });
    }

    const product = await Product.findOne({
      _id: req.params.productId,
      isActive: true,
      sellerModeActive: true,
      'location.country': 'Nepal'
    }).select('stock');
    if (!product || Number(quantity) > product.stock) {
      return res.status(409).json({ message: 'Requested cart quantity exceeds available stock' });
    }

    item.quantity = Number(quantity);
    await user.save();
    return res.json({ message: 'Cart updated successfully', cart: user.cart });
  } catch (error) {
    return serverError(res, 'Failed to update cart', error);
  }
}

async function removeCartItem(req, res) {
  try {
    const user = await userModel.findById(req.user._id);
    user.cart = user.cart.filter((item) => String(item.product) !== String(req.params.productId));
    await user.save();
    return res.json({ message: 'Item removed from cart', cart: user.cart });
  } catch (error) {
    return serverError(res, 'Failed to remove cart item', error);
  }
}

async function getWishlist(req, res) {
  try {
    const user = await userModel.findById(req.user._id)
      .populate({
        path: 'wishlist',
        match: { isActive: true, sellerModeActive: true, 'location.country': 'Nepal' },
        select: 'name price images location category stock'
      })
      .lean();
    return res.json({ wishlist: (user.wishlist || []).filter(Boolean) });
  } catch (error) {
    return serverError(res, 'Failed to fetch wishlist', error);
  }
}

async function toggleWishlist(req, res) {
  try {
    const { productId } = req.params;
    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ message: 'A valid product ID is required' });
    }
    const product = await Product.findOne({
      _id: productId,
      isActive: true,
      sellerModeActive: true,
      'location.country': 'Nepal'
    }).select('_id');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const user = await userModel.findById(req.user._id);
    const existingIndex = user.wishlist.findIndex((item) => String(item) === String(productId));

    if (existingIndex >= 0) {
      user.wishlist.splice(existingIndex, 1);
    } else {
      user.wishlist.push(productId);
    }

    await user.save();
    return res.json({ message: 'Wishlist updated successfully', wishlist: user.wishlist });
  } catch (error) {
    return serverError(res, 'Failed to update wishlist', error);
  }
}

async function switchRole(req, res) {
  const newRole = req.body.role;
  if (!['buyer', 'seller'].includes(newRole)) {
    return res.status(400).json({ message: 'Choose buyer or seller' });
  }
  if (req.user.role === 'admin') {
    return res.status(403).json({ message: 'Administrator accounts cannot switch marketplace roles' });
  }
  if (req.user.role === newRole) {
    return res.json({ message: 'You are already using this account mode', user: req.user });
  }

  const session = await mongoose.startSession();
  try {
    let updatedUser;
    await session.withTransaction(async () => {
      const user = await userModel.findById(req.user._id).session(session);
      if (!user || user.role !== req.user.role) {
        throw new Error('Account role changed; refresh and try again');
      }

      await applyMarketplaceRole(user, newRole, session);
      updatedUser = user;
    });

    const safeUser = updatedUser.toObject();
    delete safeUser.password;
    return res.json({ message: `Switched to ${newRole} mode`, user: safeUser });
  } catch (error) {
    if (error.code === 'OPEN_SELLER_ORDERS') {
      return res.status(409).json({ message: error.message });
    }
    return serverError(res, 'Failed to switch account mode', error);
  } finally {
    await session.endSession();
  }
}

module.exports = {
  getProfile,
  updateProfile,
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  getWishlist,
  toggleWishlist,
  switchRole
};
