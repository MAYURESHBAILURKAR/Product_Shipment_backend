const Shipment = require('../models/Shipment');
const Product = require('../models/Product');
const User = require('../models/User');
const { notifyAdmins, notifyUser } = require('./notificationController');
const { maybeBackupAfterShipment } = require('../services/backupService');

// @desc    Validate items and price them at the sender's current rate.
//          Shared by createShipment and the draft endpoints so a draft is
//          always re-priced fresh at save/edit/send time.
// @throws  { statusCode, message } on validation failure — callers forward it.
const buildShipmentItems = async (userId, items) => {
  const user = await User.findById(userId);
  const pricePerUnit = user ? user.priceAllotted || 0 : 0;

  let totalQuantity = 0;
  const shipmentItems = [];

  for (const item of items) {
    const product = await Product.findById(item.productId);

    if (!product) {
      throw { statusCode: 404, message: `Product not found: ${item.productId}` };
    }

    // Check ownership
    if (product.user.toString() !== userId.toString()) {
      throw { statusCode: 401, message: 'Not authorized to ship this product' };
    }

    totalQuantity += Number(item.quantity);

    shipmentItems.push({
      product: product._id,
      productName: product.name,
      quantity: item.quantity,
      pricePerUnit: pricePerUnit
    });
  }

  return {
    shipmentItems,
    totalQuantity,
    // Round to 2 decimals to avoid float artifacts (e.g. 6000.0000000015)
    totalAmount: Math.round(totalQuantity * pricePerUnit * 100) / 100
  };
};

// @desc    Create a new shipment
// @route   POST /api/shipments

const createShipment = async (req, res) => {
  const { items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ message: 'No items in shipment' });
  }

  try {
    // 1. Validate items and calculate totals at the user's current rate
    const { shipmentItems, totalQuantity, totalAmount } =
      await buildShipmentItems(req.user._id, items);

    // 2. Create Shipment Record
    const shipment = new Shipment({
      sender: req.user._id,
      items: shipmentItems,
      totalQuantity,
      totalAmount,
      status: 'pending',
      paymentStatus: 'unpaid'
    });

    const createdShipment = await shipment.save();

    // Push notify admins (fire-and-forget — never blocks the response).
    notifyAdmins(
      'New Shipment',
      `${req.user.name} shipped ${totalQuantity} units · ₹${totalAmount}`,
      { shipmentId: createdShipment._id.toString() }
    );

    // Back up the DB after every new shipment (fire-and-forget, throttled).
    maybeBackupAfterShipment();

    // TODO: Send SMS/WhatsApp Notification to Admin here

    console.log(`[SMS SYSTEM] Sending SMS to Admin:`);
    console.log(`New Shipment from ${req.user.name}: ${totalQuantity} items. Value: ${totalAmount}`);
    console.log(`[WHATSAPP SYSTEM] Sending WhatsApp template msg_shipment_created to Admin.`);

    res.status(201).json(createdShipment);

  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error(error);
    res.status(500).json({ message: 'Shipment failed', error: error.message });
  }
};

// @desc    Save a shipment as a draft — a private working copy. No admin
//          notification, no backup, invisible in admin lists and reports
//          until it is sent.
// @route   POST /api/shipments/draft

const saveShipmentDraft = async (req, res) => {
  const { items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ message: 'No items in shipment' });
  }

  try {
    const { shipmentItems, totalQuantity, totalAmount } =
      await buildShipmentItems(req.user._id, items);

    const draft = new Shipment({
      sender: req.user._id,
      items: shipmentItems,
      totalQuantity,
      totalAmount,
      status: 'draft',
      paymentStatus: 'unpaid'
    });

    const createdDraft = await draft.save();
    res.status(201).json(createdDraft);

  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error(error);
    res.status(500).json({ message: 'Draft failed', error: error.message });
  }
};

// @desc    Send a saved draft — re-prices with the current allotted rate,
//          stamps a fresh shippedAt and graduates it into the normal flow.
// @route   PUT /api/shipments/:id/send

const sendShipmentDraft = async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
      return res.status(404).json({ message: 'Shipment not found' });
    }

    if (shipment.sender.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    if (shipment.status !== 'draft') {
      return res.status(400).json({ message: 'Only drafts can be sent' });
    }

    // Re-validate + re-price at send time — the rate may have changed (or a
    // product deleted) since the draft was saved.
    const { shipmentItems, totalQuantity, totalAmount } =
      await buildShipmentItems(
        req.user._id,
        shipment.items.map(i => ({ productId: i.product, quantity: i.quantity }))
      );

    shipment.items = shipmentItems;
    shipment.totalQuantity = totalQuantity;
    shipment.totalAmount = totalAmount;
    shipment.status = 'pending';
    shipment.shippedAt = Date.now();

    const updatedShipment = await shipment.save();

    notifyAdmins(
      'New Shipment',
      `${req.user.name} shipped ${totalQuantity} units · ₹${totalAmount}`,
      { shipmentId: updatedShipment._id.toString() }
    );

    maybeBackupAfterShipment();

    res.json(updatedShipment);

  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error(error);
    res.status(500).json({ message: 'Sending draft failed', error: error.message });
  }
};

// @desc    Delete a draft. Drafts only — sent shipments are history.
// @route   DELETE /api/shipments/:id

const deleteShipmentDraft = async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
      return res.status(404).json({ message: 'Shipment not found' });
    }

    if (shipment.sender.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    if (shipment.status !== 'draft') {
      return res.status(400).json({ message: 'Only drafts can be deleted' });
    }

    await shipment.deleteOne();
    res.json({ message: 'Draft deleted' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get my shipment history
// @route   GET /api/shipments/myshipments
const getMyShipments = async (req, res) => {
  try {
    const shipments = await Shipment.find({ sender: req.user._id })
      .sort({ shippedAt: -1 }); 
    res.json(shipments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get ALL shipments (Admin only)
// @route   GET /api/shipments
const getAllShipments = async (req, res) => {
  try {
    // Populate sender name so Admin knows who sent it.
    // Drafts are private working copies — never shown to admins.
    const shipments = await Shipment.find({ status: { $ne: 'draft' } })
      .populate('sender', 'name email')
      .sort({ shippedAt: -1 });
    res.json(shipments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update shipment status (Received/Paid)
// @route   PUT /api/shipments/:id

const updateShipmentStatus = async (req, res) => {
  const { status, paymentStatus } = req.body;

  try {
    const shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
      return res.status(404).json({ message: 'Shipment not found' });
    }

    // Drafts are pre-send working copies — they graduate via /send (or are
    // deleted), never by a direct status flip.
    if (shipment.status === 'draft') {
      return res.status(400).json({ message: 'Cannot update a draft — send it first' });
    }

    const isAdmin = req.user && req.user.role === 'admin';
    const isOwner = shipment.sender.toString() === req.user._id.toString();

    // Non-admins may only touch their own shipments, and of the status
    // values only 'received' — the confirm-receipt action the app also
    // offers to owners. Any other status change stays admin-only.
    if (!isAdmin) {
      if (!isOwner) {
        return res.status(401).json({ message: 'Not authorized to update this shipment' });
      }
      if (status && status !== 'received') {
        return res.status(401).json({ message: 'Only admins can update shipment status' });
      }
    }

    // Track what changed so we can push-notify afterwards (fire-and-forget).
    let statusChangedTo = null;
    let paidNow = false;

    if (status) {
      statusChangedTo = status;
      shipment.status = status;
      if (status === 'received') shipment.receivedAt = Date.now();
    }

    if (paymentStatus) {
      const wasUnpaid = shipment.paymentStatus !== 'paid';
      shipment.paymentStatus = paymentStatus;
      if (paymentStatus === 'paid') {
        paidNow = wasUnpaid;
        shipment.paidAt = Date.now();
        // A payout only happens after the warehouse accepted the goods,
        // so paying it out implies the shipment was received.
        if (shipment.status === 'pending') {
          statusChangedTo = statusChangedTo || 'received';
          shipment.status = 'received';
          shipment.receivedAt = Date.now();
        }
      }
    }

    const updatedShipment = await shipment.save();

    // Push notifications to the sender (fire-and-forget).
    const shipmentId = updatedShipment._id.toString();
    if (statusChangedTo === 'received') {
      notifyUser(
        updatedShipment.sender,
        'Shipment Received',
        `Your shipment of ${updatedShipment.totalQuantity} units was accepted.`,
        { shipmentId }
      );
    } else if (statusChangedTo === 'rejected') {
      notifyUser(
        updatedShipment.sender,
        'Shipment Rejected',
        `Your shipment of ${updatedShipment.totalQuantity} units was rejected.`,
        { shipmentId }
      );
    }
    if (paidNow) {
      notifyUser(
        updatedShipment.sender,
        'Payment Sent',
        `₹${updatedShipment.totalAmount} for your shipment has been paid.`,
        { shipmentId }
      );
    }

    res.json(updatedShipment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get Aggregated Reports (Admin)
// @route   GET /api/shipments/reports?period=monthly

const getShipmentReports = async (req, res) => {
  const { period } = req.query; 
  
  let startDate = new Date();
  
  if (period === 'weekly') {
    startDate.setDate(startDate.getDate() - 7);
  } else if (period === 'monthly') {
    startDate.setMonth(startDate.getMonth() - 1);
  } else if (period === 'yearly') {
    startDate.setFullYear(startDate.getFullYear() - 1);
  } else {
    // Default to all time (or a very old date)
    startDate = new Date(0); 
  }

  try {
    const stats = await Shipment.aggregate([
      // 1. Filter by Date and Status 
      { 
        $match: { 
          shippedAt: { $gte: startDate },
          status: { $ne: 'draft' }
        } 
      },
      // 2. Group by Sender
      {
        $group: {
          _id: "$sender",
          totalQuantity: { $sum: "$totalQuantity" },
          totalAmount: { $sum: "$totalAmount" },
          count: { $sum: 1 }
        }
      },
      // 3. Join with User table to get Name
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userDetails"
        }
      },
      // 4. Flatten the userDetails array
      { $unwind: "$userDetails" },
      // 5. Format Output
      {
        $project: {
          name: "$userDetails.name",
          totalQuantity: 1,
          totalAmount: 1,
          count: 1
        }
      },
      // 6. Sort by highest amount
      { $sort: { totalAmount: -1 } }
    ]);

    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Edit a pending shipment
// @route   PUT /api/shipments/:id/edit

const updateShipment = async (req, res) => {
  const { items } = req.body; 

  try {
    const shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
      return res.status(404).json({ message: 'Shipment not found' });
    }

    // 1. Check Status — pending and draft shipments are editable; a draft
    //    edit keeps its draft status (only /send graduates it).
    if (shipment.status !== 'pending' && shipment.status !== 'draft') {
      return res.status(400).json({ message: 'Cannot edit processed shipments' });
    }
    const wasDraft = shipment.status === 'draft';

    // 2. Check Authorization
    if (shipment.sender.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(401).json({ message: 'Not authorized' });
    }

    // 3. Revert Old Stock — pending edits only. Drafts never deducted
    //    stock, so reverting would inflate currentStock.
    if (!wasDraft) {
      for (const oldItem of shipment.items) {
        const product = await Product.findById(oldItem.product);
        if (product) {
          product.currentStock += oldItem.quantity;
          await product.save();
        }
      }
    }

    // 4. Process New Items — validate + price at the sender's current rate
    //    (also re-checks product ownership, which the old inline loop skipped)
    const {
      shipmentItems: newShipmentItems,
      totalQuantity,
      totalAmount
    } = await buildShipmentItems(shipment.sender, items);

    // 5. Update Shipment Record (status untouched — draft stays draft)
    shipment.items = newShipmentItems;
    shipment.totalQuantity = totalQuantity;
    shipment.totalAmount = totalAmount;

    const updatedShipment = await shipment.save();
    res.json(updatedShipment);

  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get production stats for the last 7 days
// @route   GET /api/shipments/stats/weekly

const getWeeklyProductionStats = async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const stats = await Shipment.aggregate([
      { $match: { shippedAt: { $gte: sevenDaysAgo }, status: { $ne: 'draft' } } },
      {
        $group: {
          _id: { $dayOfWeek: "$shippedAt" },
          totalQuantity: { $sum: "$totalQuantity" }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get single shipment by ID
// @route   GET /api/shipments/:id

const getShipmentById = async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id)
      .populate("sender", "name email") 
      .populate("items.product", "name brand photoUrl");

    if (!shipment) {
      return res.status(404).json({ message: "Shipment not found" });
    }

    // SECURITY CHECK:
    // If user is NOT admin AND the shipment doesn't belong to them -> Reject
    if (
      req.user.role !== "admin" &&
      shipment.sender._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Not authorized to view this shipment" });
    }

    res.json(shipment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};

// Export it
module.exports = {
  createShipment, getMyShipments, getAllShipments, updateShipmentStatus, getShipmentReports,
  updateShipment, getWeeklyProductionStats, getShipmentById,
  saveShipmentDraft, sendShipmentDraft, deleteShipmentDraft
};