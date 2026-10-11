const Product = require('../models/product.model');
const Category = require('../models/category.model');
const { serverError } = require('../services/http.service');
const { parsePagination } = require('../services/pagination.service');
const mongoose = require('mongoose');
const { PROVINCES } = require('../constants/nepal');

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeProductLocation(location) {
  if (!location || typeof location !== 'object' || Array.isArray(location)) {
    return null;
  }
  if (location.country !== undefined && location.country !== 'Nepal') {
    return null;
  }
  const province = typeof location.province === 'string' ? location.province.trim() : '';
  const district = typeof location.district === 'string' ? location.district.trim() : '';
  const municipality = typeof location.municipality === 'string' ? location.municipality.trim() : '';
  const ward = typeof location.ward === 'string' ? location.ward.trim() : '';

  if (!PROVINCES.includes(province) || !district || district.length > 80
    || !municipality || municipality.length > 100 || ward.length > 20) {
    return null;
  }
  return { country: 'Nepal', province, district, municipality, ward };
}

function buildProductQuery(query = {}) {
  const filters = { isActive: true, sellerModeActive: true, 'location.country': 'Nepal' };

  if (query.category) {
    filters.category = new RegExp(`^${escapeRegex(query.category)}$`, 'i');
  }

  if (query.search) {
    const term = String(query.search).trim().slice(0, 100);
    if (term) {
      const regex = new RegExp(escapeRegex(term), 'i');
      filters.$or = [
        { name: regex },
        { description: regex },
        { category: regex }
      ];
    }
  }

  if (query.province) {
    filters['location.province'] = new RegExp(`^${escapeRegex(query.province)}$`, 'i');
  }
  if (query.district) {
    filters['location.district'] = new RegExp(`^${escapeRegex(query.district)}$`, 'i');
  }
  if (query.municipality) {
    filters['location.municipality'] = new RegExp(`^${escapeRegex(query.municipality)}$`, 'i');
  }

  if ((query.minPrice !== undefined && query.minPrice !== '')
    || (query.maxPrice !== undefined && query.maxPrice !== '')) {
    filters.price = {};
    if (query.minPrice !== undefined && query.minPrice !== '') {
      filters.price.$gte = Number(query.minPrice);
    }
    if (query.maxPrice !== undefined && query.maxPrice !== '') {
      filters.price.$lte = Number(query.maxPrice);
    }
  }

  if (query.inStock === 'true') {
    filters.stock = { $gt: 0 };
  }

  return filters;
}

async function getProducts(req, res) {
  try {
    const filters = buildProductQuery(req.query);
    const page = Math.min(100000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.min(48, Math.max(1, Number.parseInt(req.query.limit, 10) || 24));
    const minPrice = req.query.minPrice === undefined ? undefined : Number(req.query.minPrice);
    const maxPrice = req.query.maxPrice === undefined ? undefined : Number(req.query.maxPrice);
    if ((minPrice !== undefined && (!Number.isFinite(minPrice) || minPrice < 0))
      || (maxPrice !== undefined && (!Number.isFinite(maxPrice) || maxPrice < 0))
      || (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice)) {
      return res.status(400).json({ message: 'Provide a valid non-negative price range' });
    }
    if (req.query.province && (typeof req.query.province !== 'string'
      || !PROVINCES.some((province) => province.toLowerCase() === req.query.province.toLowerCase()))) {
      return res.status(400).json({ message: 'Choose a valid Nepal province' });
    }
    if ((req.query.district !== undefined
      && (typeof req.query.district !== 'string' || req.query.district.length > 80))
      || (req.query.municipality !== undefined
        && (typeof req.query.municipality !== 'string' || req.query.municipality.length > 100))) {
      return res.status(400).json({ message: 'District or municipality filter is too long' });
    }

    const sortOptions = {
      newest: { createdAt: -1 },
      priceLow: { price: 1 },
      priceHigh: { price: -1 },
      name: { name: 1 }
    };

    const sortKey = req.query.sort || 'newest';
    const [products, total] = await Promise.all([
      Product.find(filters)
        .populate('seller', 'name')
        .sort(sortOptions[sortKey] || sortOptions.newest)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(filters)
    ]);

    return res.json({ products, page, pages: Math.ceil(total / limit), total });
  } catch (error) {
    return serverError(res, 'Failed to fetch products', error);
  }
}

async function getProductById(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid product ID' });
  }
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      isActive: true,
      sellerModeActive: true,
      'location.country': 'Nepal'
    }).populate('seller', 'name email').lean();
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    return res.json({ product });
  } catch (error) {
    return serverError(res, 'Failed to fetch product', error);
  }
}

async function getCategories(req, res) {
  try {
    const categories = await Category.find({ isActive: true }).sort({ name: 1 }).select('name').lean();
    return res.json({ categories: categories.map((category) => category.name) });
  } catch (error) {
    return serverError(res, 'Failed to fetch categories', error);
  }
}

function getLocations(req, res) {
  return res.json({ country: 'Nepal', provinces: PROVINCES });
}

async function createProduct(req, res) {
  try {
    const { name, description, price, category, stock, images, location } = req.body;

    if (typeof name !== 'string' || !name.trim() || typeof description !== 'string'
      || !description.trim() || typeof category !== 'string' || !category.trim()
      || price === undefined || stock === undefined) {
      return res.status(400).json({ message: 'Name, description, category, price and stock are required' });
    }

    const parsedPrice = Number(price);
    const parsedStock = Number(stock);

    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ message: 'Price must be a valid non-negative number' });
    }

    if (!Number.isInteger(parsedStock) || parsedStock < 0) {
      return res.status(400).json({ message: 'Stock must be a valid non-negative number' });
    }
    const productLocation = normalizeProductLocation(location);
    if (!productLocation) {
      return res.status(400).json({ message: 'Provide a valid Nepal province, district and municipality' });
    }
    const activeCategory = await Category.findOne({ name: category.trim().toLowerCase(), isActive: true }).select('_id');
    if (!activeCategory) {
      return res.status(400).json({ message: 'Choose an active category created by an administrator' });
    }

    const slug = `${String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'product'}-${require('crypto').randomBytes(3).toString('hex')}`;
    const productImages = Array.isArray(images) ? images : [];
    if (productImages.length > 8 || productImages.some((image) => typeof image !== 'string' || !/^https:\/\//i.test(image))) {
      return res.status(400).json({ message: 'Provide up to 8 valid HTTPS product image URLs' });
    }

    const product = await Product.create({
      name,
      description,
      price: parsedPrice,
      category,
      location: productLocation,
      stock: parsedStock,
      images: productImages,
      seller: req.user._id,
      slug
    });

    return res.status(201).json({ message: 'Product created successfully', product });
  } catch (error) {
    return res.status(error.code === 11000 ? 409 : 500).json({
      message: error.code === 11000 ? 'A product with this slug already exists' : 'Failed to create product'
    });
  }
}

async function updateProduct(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid product ID' });
  }
  try {
    const product = await Product.findOne({ _id: req.params.id, seller: req.user._id });
    if (!product) {
      return res.status(404).json({ message: 'Product not found or you do not own this product' });
    }

    const { name, description, price, category, stock, images, isActive, location } = req.body;

    if (name) {
      product.name = name;
      product.slug = `${String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'product'}-${require('crypto').randomBytes(3).toString('hex')}`;
    }
    if (description) product.description = description;
    if (category) {
      const activeCategory = await Category.findOne({ name: String(category).trim().toLowerCase(), isActive: true }).select('_id');
      if (!activeCategory) {
        return res.status(400).json({ message: 'Choose an active category created by an administrator' });
      }
      product.category = category;
    }
    if (location !== undefined) {
      const productLocation = normalizeProductLocation(location);
      if (!productLocation) {
        return res.status(400).json({ message: 'Provide a valid Nepal province, district and municipality' });
      }
      product.location = productLocation;
    }
    if (price !== undefined) {
      const parsedPrice = Number(price);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
        return res.status(400).json({ message: 'Price must be a valid non-negative number' });
      }
      product.price = parsedPrice;
    }
    if (stock !== undefined) {
      const parsedStock = Number(stock);
      if (!Number.isInteger(parsedStock) || parsedStock < 0) {
        return res.status(400).json({ message: 'Stock must be a valid non-negative number' });
      }
      product.stock = parsedStock;
    }
    if (images !== undefined) {
      if (!Array.isArray(images) || images.length > 8 || images.some((image) => typeof image !== 'string' || !/^https:\/\//i.test(image))) {
        return res.status(400).json({ message: 'Provide up to 8 valid HTTPS product image URLs' });
      }
      product.images = images;
    }
    if (typeof isActive === 'boolean') {
      product.isActive = isActive;
    }

    await product.save();
    return res.json({ message: 'Product updated successfully', product });
  } catch (error) {
    return serverError(res, 'Failed to update product', error);
  }
}

async function deleteProduct(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid product ID' });
  }
  try {
    const product = await Product.findOne({ _id: req.params.id, seller: req.user._id });
    if (!product) {
      return res.status(404).json({ message: 'Product not found or you do not own this product' });
    }

    product.isActive = false;
    await product.save();

    return res.json({ message: 'Product deactivated successfully' });
  } catch (error) {
    return serverError(res, 'Failed to delete product', error);
  }
}

async function getSellerProducts(req, res) {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const filters = { seller: req.user._id };
    if (req.query.search) {
      const term = String(req.query.search).trim().slice(0, 100);
      if (term) {
        const regex = new RegExp(escapeRegex(term), 'i');
        filters.$or = [
          { name: regex },
          { category: regex }
        ];
      }
    }

    const [products, total, activeCount] = await Promise.all([
      Product.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Product.countDocuments(filters),
      Product.countDocuments({ seller: req.user._id, isActive: true })
    ]);
    return res.json({ products, page, pages: Math.ceil(total / limit) || 1, total, activeCount });
  } catch (error) {
    return serverError(res, 'Failed to fetch seller products', error);
  }
}

module.exports = {
  getProducts,
  getCategories,
  getLocations,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getSellerProducts,
  buildProductQuery,
  normalizeProductLocation
};
