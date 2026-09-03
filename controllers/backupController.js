const Backup = require('../models/Backup');
const { runBackup } = require('../services/backupService');

// @desc    Trigger a backup now (Admin only)
// @route   POST /api/backups/run
const runBackupNow = async (req, res) => {
  const result = await runBackup('manual');
  if (result.skipped) {
    return res.status(409).json({ message: result.reason });
  }
  if (result.failed) {
    return res.status(500).json({ message: 'Backup failed', error: result.error });
  }
  res.status(201).json(result.record);
};

// @desc    List backups, newest first (Admin only)
// @route   GET /api/backups
const listBackups = async (req, res) => {
  try {
    const backups = await Backup.find({ status: 'success' })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(backups);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get latest backup info (Admin only)
// @route   GET /api/backups/latest
const getLatestBackup = async (req, res) => {
  try {
    const latest = await Backup.findOne({ status: 'success' }).sort({ createdAt: -1 });
    if (!latest) {
      return res.status(404).json({ message: 'No backups yet' });
    }
    res.json(latest);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { runBackupNow, listBackups, getLatestBackup };
