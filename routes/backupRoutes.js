const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { runBackupNow, listBackups, getLatestBackup } = require('../controllers/backupController');

// Admin Middleware
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(401).json({ message: 'Not authorized as admin' });
  }
};

router.post('/run', protect, admin, runBackupNow);
router.get('/latest', protect, admin, getLatestBackup);
router.get('/', protect, admin, listBackups);

module.exports = router;
