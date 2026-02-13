const express = require('express');
const router = express.Router();
const { 
  getMyProducts, 
  createProduct, 
  deleteProduct, 
  updateProduct,
  getAllProductsAdmin
} = require('../controllers/productController');
const { protect } = require('../middleware/authMiddleware');
const multer = require('multer');
const { storage } = require('../config/cloudinary');
const upload = multer({ storage });

// Define Admin Middleware (if not already imported)
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(401).json({ message: 'Not authorized as admin' });
  }
};

router.get('/myproducts', protect, getMyProducts);
router.post('/', protect, upload.single('image'), createProduct);


router.delete('/:id', protect, deleteProduct);
router.put('/:id', protect, upload.single('image'), updateProduct);
router.get('/admin/all', protect, admin, getAllProductsAdmin);

module.exports = router;