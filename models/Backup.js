const mongoose = require('mongoose');

const backupSchema = new mongoose.Schema({
  fileName: { type: String, required: true },        // e.g. masalaflow-backup-2026-09-03_14-30-05.zip
  cloudinaryPublicId: { type: String, required: true }, // Cloudinary asset public_id
  downloadUrl: { type: String, required: true },      // Secure URL to the zip on Cloudinary
  sizeBytes: { type: Number, default: 0 },
  collections: [String],                             // Collection names included in the dump
  trigger: { type: String, enum: ['shipment', 'manual', 'scheduled'], default: 'manual' },
  status: { type: String, enum: ['success', 'failed'], default: 'success' },
  error: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Backup', backupSchema);
