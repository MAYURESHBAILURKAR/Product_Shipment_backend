const express = require('express');
const router = express.Router();
const { getUsers, createUser, updateUser, deleteUser, updateUserProfile } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');


const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(401).json({ message: 'Not authorized as an admin' });
  }
};

router.route('/')
  .get(protect, admin, getUsers)
  .post(protect, admin, createUser);

router.put('/profile', protect, updateUserProfile);

router.route('/:id')
  .put(protect, admin, updateUser)
  .delete(protect, admin, deleteUser);

module.exports = router;