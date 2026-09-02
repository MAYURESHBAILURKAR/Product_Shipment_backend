const Product = require('../models/Product');
const { cloudinary } = require('../config/cloudinary');

// @desc    Get logged in user's products
// @route   GET /api/products/myproducts
const getMyProducts = async (req, res) => {
  try {
    const products = await Product.find({ user: req.user._id });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a new product
// @route   POST /api/products
const createProduct = async (req, res) => {
  const { name, brand } = req.body;

  const photoUrl = req.file ? req.file.path : '';
  const cloudinaryId = req.file ? req.file.filename : '';

  try {
    // Same product (name + brand) can't be added twice by the same owner.
    const trimmed = (v) => (v || '').toString().trim();
    const existing = await Product.findOne({
      user: req.user._id,
      name: { $regex: `^${escapeRegex(trimmed(name))}$`, $options: 'i' },
      brand: { $regex: `^${escapeRegex(trimmed(brand))}$`, $options: 'i' },
    });
    if (existing) {
      return res.status(409).json({
        message: `You already have "${trimmed(name)}" (${trimmed(brand)}) in your products.`,
      });
    }

    const product = new Product({
      user: req.user._id,
      name: trimmed(name),
      brand: trimmed(brand),
      photoUrl,
      cloudinaryId,
      currentStock: 0,
    });

    const createdProduct = await product.save();
    res.status(201).json(createdProduct);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Escapes user input for safe use inside a $regex.
const escapeRegex = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    Delete a product
// @route   DELETE /api/products/:id
const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }


    if (product.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    // 1. Delete image from Cloudinary
    if (product.cloudinaryId) {
      await cloudinary.uploader.destroy(product.cloudinaryId);
    }

    // 2. Delete from MongoDB
    await product.deleteOne();

    res.json({ message: 'Product removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private
const updateProduct = async (req, res) => {
  const { name, brand } = req.body;

  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (product.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    // Renaming into an existing name+brand pair (of the same owner) is a duplicate.
    const trimmed = (v) => (v || '').toString().trim();
    const nextName = trimmed(name) || product.name;
    const nextBrand = trimmed(brand) || product.brand;
    const clash = await Product.findOne({
      _id: { $ne: product._id },
      user: req.user._id,
      name: { $regex: `^${escapeRegex(nextName)}$`, $options: 'i' },
      brand: { $regex: `^${escapeRegex(nextBrand)}$`, $options: 'i' },
    });
    if (clash) {
      return res.status(409).json({
        message: `You already have "${nextName}" (${nextBrand}) in your products.`,
      });
    }

    // Update text fields
    product.name = nextName;
    product.brand = nextBrand;

    // If a new image is uploaded
    if (req.file) {
      // 1. Delete old image
      if (product.cloudinaryId) {
        await cloudinary.uploader.destroy(product.cloudinaryId);
      }
      // 2. Set new image
      product.photoUrl = req.file.path;
      product.cloudinaryId = req.file.filename;
    }

    const updatedProduct = await product.save();
    res.json(updatedProduct);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get ALL products (Admin only)
// @route   GET /api/products/admin/all
// @access  Admin
const getAllProductsAdmin = async (req, res) => {
  try {
    // Populate 'user' to see who owns the stock
    const products = await Product.find({})
      .populate('user', 'name locality mobile')
      .sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { 
  getMyProducts, 
  createProduct, 
  deleteProduct, 
  updateProduct,
  getAllProductsAdmin
};