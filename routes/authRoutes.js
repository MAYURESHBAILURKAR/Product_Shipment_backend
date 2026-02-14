const express = require('express');
const router = express.Router();
const { loginUser, resetPassword } = require('../controllers/authController');

router.post('/login', loginUser);
router.post("/reset-password", resetPassword);

module.exports = router;