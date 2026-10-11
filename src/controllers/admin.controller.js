const userModel = require('../models/user.model');
const Product = require('../models/product.model');
const Order = require('../models/order.model');
const Category = require('../models/category.model');
const mongoose = require('mongoose');
const { serverError } = require('../services/http.service');
const { applyMarketplaceRole } = require('../services/role.service');
const { parsePagination } = require('../services/pagination.service');

async function getDashboardStats(req, res) {
  try {
    const [totalUsers, buyers, sellers, totalProducts, totalOrders] = await Promise.all([
      userModel.countDocuments(),
      userModel.countDocuments({ role: 'buyer' }),
      userModel.countDocuments({ role: 'seller' }),
      Product.countDocuments(),
      Order.countDocuments()
    ]);

    const revenue = await Order.aggregate([
      {
        $match: {
          $or: [
            { paymentStatus: 'PAID' },
            { paymentMethod: 'cash_on_delivery', orderStatus: 'DELIVERED' }
          ]
        }
      },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);

    return res.json({
      stats: {
        totalUsers,
        buyers,
        sellers,
        totalProducts,
        totalOrders,
        revenue: revenue[0]?.total || 0
      }
    });
  } catch (error) {
    return serverError(res, 'Failed to fetch dashboard stats', error);
  }
}

async function getUsers(req, res) {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const [users, total] = await Promise.all([
      userModel.find().select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      userModel.countDocuments()
    ]);
    return res.json({ users, page, pages: Math.ceil(total / limit) || 1, total });
  } catch (error) {
    return serverError(res, 'Failed to fetch users', error);
  }
}

async function updateUserStatus(req, res) {
  const { role, isActive } = req.body;
  if (role !== undefined && !['buyer', 'seller', 'admin'].includes(role)) {
    return res.status(400).json({ message: 'Choose a valid account role' });
  }
  if (isActive !== undefined && typeof isActive !== 'boolean') {
    return res.status(400).json({ message: 'isActive must be true or false' });
  }

  const session = await mongoose.startSession();
  try {
    let user;
    await session.withTransaction(async () => {
      user = await userModel.findById(req.params.userId).session(session);
      if (!user) {
        const error = new Error('User not found');
        error.code = 'USER_NOT_FOUND';
        throw error;
      }
      if (String(user._id) === String(req.user._id)) {
        const error = new Error('You cannot change your own administrator account here');
        error.code = 'ADMIN_SELF_UPDATE';
        throw error;
      }
      if (role && role !== user.role) {
        await applyMarketplaceRole(user, role, session);
      }
      if (typeof isActive === 'boolean') user.isActive = isActive;
      await user.save({ session });
    });

    const safeUser = user.toObject();
    delete safeUser.password;
    return res.json({ message: 'User updated successfully', user: safeUser });
  } catch (error) {
    if (error.code === 'USER_NOT_FOUND') return res.status(404).json({ message: error.message });
    if (error.code === 'ADMIN_SELF_UPDATE') return res.status(400).json({ message: error.message });
    if (error.code === 'OPEN_SELLER_ORDERS') return res.status(409).json({ message: error.message });
    return serverError(res, 'Failed to update user', error);
  } finally {
    await session.endSession();
  }
}

async function getAllProducts(req, res) {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const [products, total] = await Promise.all([
      Product.find().populate('seller', 'name email').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Product.countDocuments()
    ]);
    return res.json({ products, page, pages: Math.ceil(total / limit) || 1, total });
  } catch (error) {
    return serverError(res, 'Failed to fetch products', error);
  }
}

async function getAllOrders(req, res) {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const [orders, total] = await Promise.all([
      Order.find().sort({ createdAt: -1 }).populate('items.product', 'name images').skip(skip).limit(limit).lean(),
      Order.countDocuments()
    ]);
    return res.json({ orders, page, pages: Math.ceil(total / limit) || 1, total });
  } catch (error) {
    return serverError(res, 'Failed to fetch orders', error);
  }
}

async function updateProductVisibility(req, res) {
  try {
    if (typeof req.body.isActive !== 'boolean') {
      return res.status(400).json({ message: 'isActive must be true or false' });
    }
    const product = await Product.findByIdAndUpdate(
      req.params.productId,
      { $set: { isActive: req.body.isActive } },
      { new: true, runValidators: true }
    );
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    return res.json({ message: 'Product visibility updated', product });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update product visibility' });
  }
}

async function getCategories(req, res) {
  try {
    const categories = await Category.find().sort({ name: 1 }).lean();
    return res.json({ categories });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch categories' });
  }
}

async function createCategory(req, res) {
  const name = typeof req.body.name === 'string' ? req.body.name.trim().toLowerCase() : '';
  if (!name || name.length > 80) {
    return res.status(400).json({ message: 'Category name must contain 1 to 80 characters' });
  }
  try {
    const category = await Category.create({ name });
    return res.status(201).json({ category });
  } catch (error) {
    return res.status(error.code === 11000 ? 409 : 500).json({
      message: error.code === 11000 ? 'This category already exists' : 'Failed to create category'
    });
  }
}

async function updateCategory(req, res) {
  if (typeof req.body.isActive !== 'boolean') {
    return res.status(400).json({ message: 'isActive must be true or false' });
  }
  try {
    const category = await Category.findByIdAndUpdate(
      req.params.categoryId,
      { $set: { isActive: req.body.isActive } },
      { new: true, runValidators: true }
    );
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    return res.json({ category });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update category' });
  }
}

module.exports = {
  getDashboardStats,
  getUsers,
  updateUserStatus,
  getAllProducts,
  getAllOrders,
  updateProductVisibility,
  getCategories,
  createCategory,
  updateCategory
};
