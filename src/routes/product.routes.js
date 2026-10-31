const express = require('express');
const multer = require('multer');
const { protect, authorize } = require('../middleware/auth.middleware');
const { getProducts, getCategories, getLocations, getProductById, createProduct, updateProduct, deleteProduct, getSellerProducts } = require('../controllers/product.controller');
const { uploadProductImageController } = require('../controllers/image.controller');

const router = express.Router();
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.mimetype)) {
      return callback(new Error('Only JPEG, PNG, WebP and AVIF images are supported'));
    }
    return callback(null, true);
  }
});
const uploadOneImage = (req, res, next) => imageUpload.single('image')(req, res, (error) => {
  if (error) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ message: error.message });
  }
  return next();
});

router.get('/', getProducts);
router.get('/categories', getCategories);
router.get('/locations', getLocations);
router.get('/:id', getProductById);

router.use(protect);
router.post('/', authorize('seller'), createProduct);
router.post('/images', authorize('seller'), uploadOneImage, uploadProductImageController);
router.get('/seller/my-products', authorize('seller'), getSellerProducts);
router.put('/:id', authorize('seller'), updateProduct);
router.delete('/:id', authorize('seller'), deleteProduct);

module.exports = router;
