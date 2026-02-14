const express = require('express');
const router = express.Router();
const { 
  createShipment, 
  getMyShipments, 
  getAllShipments, 
  updateShipmentStatus, 
  getShipmentReports,
  updateShipment,
  getWeeklyProductionStats,
  getShipmentById
} = require('../controllers/shipmentController');
const { protect } = require('../middleware/authMiddleware');

// Admin Middleware
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(401).json({ message: 'Not authorized as admin' });
  }
};

router.post('/', protect, createShipment);
router.get('/reports', protect, admin, getShipmentReports);
router.get('/stats/weekly', protect, admin, getWeeklyProductionStats);
router.get('/myshipments', protect, getMyShipments);
router.get("/:id", protect, getShipmentById);
router.get('/', protect, admin, getAllShipments);
router.put('/:id', protect, admin, updateShipmentStatus);
router.put('/:id/edit', protect, updateShipment);

module.exports = router;