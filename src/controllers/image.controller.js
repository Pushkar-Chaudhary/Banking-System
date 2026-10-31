const { uploadProductImage, detectImageMimeType } = require('../services/image.service');

async function uploadProductImageController(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: 'Choose an image file to upload' });
  }
  if (detectImageMimeType(req.file.buffer) !== req.file.mimetype) {
    return res.status(400).json({ message: 'The image contents do not match the selected file type' });
  }

  try {
    const image = await uploadProductImage(req.file.buffer);
    return res.status(201).json({ image });
  } catch (error) {
    console.error('Product image upload failed:', error.message);
    return res.status(503).json({
      message: error.message === 'Product image storage is not configured'
        ? error.message
        : 'Image upload failed. Please try again.'
    });
  }
}

module.exports = { uploadProductImageController };
