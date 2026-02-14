const User = require('../models/User');
const Shipment = require('../models/Shipment');
const bcrypt = require('bcryptjs');

// @desc    Get all production users
// @route   GET /api/users
const getUsers = async (req, res) => {
  try {
    const users = await User.find({ role: 'production' }).select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a new production user
// @route   POST /api/users
const createUser = async (req, res) => {
  const { name, email, password, mobile, priceAllotted } = req.body;
  
  try {
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User already exists' });

    const user = await User.create({
      name, email, password, mobile, priceAllotted, role: 'production'
    });

    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    await user.deleteOne();
    res.json({ message: 'User removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update User Profile (Self-Service)
// @route   PUT /api/users/profile

const updateUserProfile = async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;
    user.mobile = req.body.mobile || user.mobile;
    
    // Only update password if sent
    if (req.body.password) {
      // Hash handled by pre-save middleware in User model
      user.password = req.body.password; 
    }

    const updatedUser = await user.save();
    
    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      mobile: updateUser.mobile,
      token: req.token 
    });
  } else {
    res.status(404).json({ message: 'User not found' });
  }
};

// @desc    Update User by Admin (Full Control)
// @route   PUT /api/users/:id
const updateUser = async (req, res) => {
  const user = await User.findById(req.params.id);

  if (user) {
    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;
    user.mobile = req.body.mobile || user.mobile;
    user.locality = req.body.locality || user.locality;
    user.priceAllotted = req.body.priceAllotted !== undefined ? req.body.priceAllotted : user.priceAllotted;
    user.isActive = req.body.isActive !== undefined ? req.body.isActive : user.isActive;

    if (req.body.password && req.body.password.trim() !== '') {
      user.password = req.body.password;
    }

    const updatedUser = await user.save();
    res.json(updatedUser);
  } else {
    res.status(404).json({ message: 'User not found' });
  }
};


module.exports = { 
  getUsers, createUser, updateUser, deleteUser, updateUserProfile 
};