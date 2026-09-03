const archiver = require('archiver');
const { BSON } = require('bson');
const mongoose = require('mongoose');
const { cloudinary } = require('../config/cloudinary');
const Backup = require('../models/Backup');

// ---------------------------------------------------------------------------
// Configuration (env-driven, with sane defaults)
// ---------------------------------------------------------------------------
const THROTTLE_MS = Number(process.env.BACKUP_THROTTLE_MINUTES || 10) * 60 * 1000;
const RETENTION_COUNT = Number(process.env.BACKUP_RETENTION_COUNT || 30);
const CLOUDINARY_FOLDER = process.env.BACKUP_CLOUDINARY_FOLDER || 'masalaflow_backups';
const BATCH_SIZE = Number(process.env.BACKUP_BATCH_SIZE || 500);

// ---------------------------------------------------------------------------
// Throttle — at most one backup per THROTTLE_MS. A burst of shipments
// produces one backup, not ten. A backup already in flight also blocks
// new ones (the dump iterates cursors over the live connection).
// ---------------------------------------------------------------------------
let lastBackupAt = 0;
let backupInFlight = false;

const throttledRecently = () => Date.now() - lastBackupAt < THROTTLE_MS;

// ---------------------------------------------------------------------------
// Dump one collection into the archive as <name>.bson — raw concatenated
// BSON documents, the exact format mongorestore expects for a .bson file.
// The DB is small (single business); buffering per collection is fine.
// ---------------------------------------------------------------------------
const dumpCollectionInto = async (archive, name) => {
  const collection = mongoose.connection.db.collection(name);
  const cursor = collection.find({}).batchSize(BATCH_SIZE);

  const parts = [];
  for await (const doc of cursor) {
    parts.push(BSON.serialize(doc));
  }

  if (parts.length === 0) {
    archive.append(Buffer.alloc(0), { name: `${name}.bson` });
    return;
  }
  archive.append(Buffer.concat(parts), { name: `${name}.bson` });
};

// ---------------------------------------------------------------------------
// Main backup routine: dump every collection -> zip -> upload to Cloudinary.
// Never throws to the caller — failures are logged and recorded as failed
// Backup documents so a silent-failure backup can't masquerade as success.
// ---------------------------------------------------------------------------
const runBackup = async (trigger = 'manual') => {
  const startedAt = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const fileName = `masalaflow-backup-${stamp}.zip`;

  try {
    if (backupInFlight) {
      return { skipped: true, reason: 'backup already in flight' };
    }
    backupInFlight = true;

    const collections = await mongoose.connection.db
      .listCollections({}, { nameOnly: true })
      .toArray()
      .then((cs) => cs.map((c) => c.name))
      // Skip our own metadata collection — a backup of backups is noise.
      .then((names) => names.filter((n) => n !== 'backups'));

    if (collections.length === 0) {
      throw new Error('No collections found to back up');
    }

    // Build the zip in memory (small DB) and hand it to Cloudinary.
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', (c) => chunks.push(c));
    const archiveDone = new Promise((resolve, reject) => {
      archive.on('end', () => resolve());
      archive.on('error', reject);
    });

    for (const name of collections) {
      await dumpCollectionInto(archive, name);
    }
    archive.finalize();
    await archiveDone;

    const zipBuffer = Buffer.concat(chunks);
    if (zipBuffer.length === 0) {
      throw new Error('Archive is empty');
    }

    // Upload as a raw file. resource_type: 'raw' keeps Cloudinary from
    // treating the zip as an image/video asset.
    const b64 = `data:application/zip;base64,${zipBuffer.toString('base64')}`;
    const result = await cloudinary.uploader.upload(b64, {
      folder: CLOUDINARY_FOLDER,
      resource_type: 'raw',
      // Timestamped names are unique; invalidate CDN caches just in case.
      public_id: fileName.replace(/\.zip$/, ''),
      invalidate: true
    });

    lastBackupAt = Date.now();

    const record = await Backup.create({
      fileName,
      cloudinaryPublicId: result.public_id,
      downloadUrl: result.secure_url,
      sizeBytes: zipBuffer.length,
      collections,
      trigger,
      status: 'success'
    });

    console.log(`[BACKUP] ${fileName} (${(zipBuffer.length / 1024).toFixed(1)} KB, ` +
      `${collections.length} collections, ${Date.now() - startedAt} ms, trigger: ${trigger})`);

    // Retention: keep only the newest RETENTION_COUNT successful backups.
    pruneOldBackups().catch((e) => console.error('[BACKUP] prune failed:', e.message));

    return { skipped: false, record };
  } catch (error) {
    console.error(`[BACKUP] failed (${trigger}):`, error.message);
    try {
      await Backup.create({
        fileName,
        cloudinaryPublicId: '-',
        downloadUrl: '-',
        trigger,
        status: 'failed',
        error: error.message
      });
    } catch (_) { /* recording a failure must never throw */ }
    return { skipped: false, failed: true, error: error.message };
  } finally {
    backupInFlight = false;
  }
};

// ---------------------------------------------------------------------------
// Fire-and-forget wrapper for business flows (shipment creation).
// Same contract as notifyAdmins: never blocks, never throws.
// ---------------------------------------------------------------------------
const maybeBackupAfterShipment = () => {
  if (throttledRecently()) {
    return; // A backup happened moments ago; skip quietly.
  }
  runBackup('shipment').catch(() => {});
};

// Keep the newest RETENTION_COUNT successful backups; delete older files
// from Cloudinary AND their Backup records.
const pruneOldBackups = async () => {
  const old = await Backup.find({ status: 'success' })
    .sort({ createdAt: -1 })
    .skip(RETENTION_COUNT)
    .lean();

  for (const b of old) {
    try {
      await cloudinary.uploader.destroy(b.cloudinaryPublicId, { resource_type: 'raw' });
      await Backup.deleteOne({ _id: b._id });
    } catch (e) {
      console.error(`[BACKUP] prune of ${b.fileName} failed:`, e.message);
    }
  }
};

module.exports = { runBackup, maybeBackupAfterShipment };
