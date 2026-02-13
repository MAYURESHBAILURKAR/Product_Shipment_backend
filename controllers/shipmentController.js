const Shipment = require('../models/Shipment');
const Product = require('../models/Product');
const User = require('../models/User');

// @desc    Create a new shipment
// @route   POST /api/shipments
// @access  Private (Production User)
const createShipment = async (req, res) => {
  const { items } = req.body; // items = [{ productId, quantity }]

  if (!items || items.length === 0) {
    return res.status(400).json({ message: 'No items in shipment' });
  }

  try {
    let totalQuantity = 0;
    let totalAmount = 0;
    const shipmentItems = [];

    // 1. Fetch User to get their specific price rate
    const user = await User.findById(req.user._id);
    const pricePerUnit = user.priceAllotted || 0;

    // 2. Loop through items to validate and calculate
    for (const item of items) {
      const product = await Product.findById(item.productId);

      if (!product) {
        return res.status(404).json({ message: `Product not found: ${item.productId}` });
      }

      // Check ownership
      if (product.user.toString() !== req.user._id.toString()) {
        return res.status(401).json({ message: 'Not authorized to ship this product' });
      }

      // Optional: Check Stock (Prevent negative stock)
    //   if (product.currentStock < item.quantity) {
    //     return res.status(400).json({ 
    //       message: `Not enough stock for ${product.name}. Current: ${product.currentStock}` 
    //     });
    //   }

      // Deduct Stock
    //   product.currentStock -= item.quantity;
    //   await product.save();

      // Add to calculation
      totalQuantity += Number(item.quantity);
      
      shipmentItems.push({
        product: product._id,
        productName: product.name, // Snapshot name in case it changes later
        quantity: item.quantity,
        pricePerUnit: pricePerUnit
      });
    }

    // 3. Calculate Final Amount
    totalAmount = totalQuantity * pricePerUnit;

    // 4. Create Shipment Record
    const shipment = new Shipment({
      sender: req.user._id,
      items: shipmentItems,
      totalQuantity,
      totalAmount,
      status: 'pending',
      paymentStatus: 'unpaid'
    });

    const createdShipment = await shipment.save();

    // TODO: Send SMS/WhatsApp Notification to Admin here

    // --- NOTIFICATION STUB ---
    console.log(`[SMS SYSTEM] Sending SMS to Admin:`);
    console.log(`New Shipment from ${req.user.name}: ${totalQuantity} items. Value: ${totalAmount}`);
    console.log(`[WHATSAPP SYSTEM] Sending WhatsApp template msg_shipment_created to Admin.`);
    // In real app: await twilioClient.messages.create(...)
    // -------------------------

    res.status(201).json(createdShipment);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Shipment failed', error: error.message });
  }
};

// @desc    Get my shipment history
// @route   GET /api/shipments/myshipments
// @access  Private
const getMyShipments = async (req, res) => {
  try {
    const shipments = await Shipment.find({ sender: req.user._id })
      .sort({ shippedAt: -1 }); // Newest first
    res.json(shipments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get ALL shipments (Admin only)
// @route   GET /api/shipments
// @access  Admin
const getAllShipments = async (req, res) => {
  try {
    // Populate sender name so Admin knows who sent it
    const shipments = await Shipment.find({})
      .populate('sender', 'name email')
      .sort({ shippedAt: -1 }); // Newest first
    res.json(shipments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update shipment status (Received/Paid)
// @route   PUT /api/shipments/:id
// @access  Admin
const updateShipmentStatus = async (req, res) => {
  const { status, paymentStatus } = req.body; // e.g. { status: 'received' } or { paymentStatus: 'paid' }

  try {
    const shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
      return res.status(404).json({ message: 'Shipment not found' });
    }

    if (status) {
      shipment.status = status;
      if (status === 'received') shipment.receivedAt = Date.now();
    }

    if (paymentStatus) {
      shipment.paymentStatus = paymentStatus;
      if (paymentStatus === 'paid') shipment.paidAt = Date.now();
    }

    const updatedShipment = await shipment.save();
    res.json(updatedShipment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get Aggregated Reports (Admin)
// @route   GET /api/shipments/reports?period=monthly
// @access  Admin
const getShipmentReports = async (req, res) => {
  const { period } = req.query; // 'weekly', 'monthly', 'yearly'
  
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
      // 1. Filter by Date and Status (only count received/approved shipments usually, but we'll count all for now)
      { 
        $match: { 
          shippedAt: { $gte: startDate } 
        } 
      },
      // 2. Group by Sender (User)
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
// @access  Private (Sender or Admin)
const updateShipment = async (req, res) => {
  const { items } = req.body; // items = [{ productId, quantity }]

  try {
    const shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
      return res.status(404).json({ message: 'Shipment not found' });
    }

    // 1. Check Status (Only Pending allowed)
    if (shipment.status !== 'pending') {
      return res.status(400).json({ message: 'Cannot edit processed shipments' });
    }

    // 2. Check Authorization (Sender or Admin)
    if (shipment.sender.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(401).json({ message: 'Not authorized' });
    }

    // 3. Revert Old Stock (Add back everything first)
    // This is the safest way to handle complex edits (remove old, add new)
    for (const oldItem of shipment.items) {
      const product = await Product.findById(oldItem.product);
      if (product) {
        product.currentStock += oldItem.quantity; // Add back
        await product.save();
      }
    }

    // 4. Process New Items & Deduct New Stock
    let totalQuantity = 0;
    let totalAmount = 0;
    const newShipmentItems = [];
    
    // Get user to find price rate (use sender from shipment to be safe if Admin is editing)
    const sender = await User.findById(shipment.sender);
    const pricePerUnit = sender.priceAllotted || 0;

    for (const newItem of items) {
      const product = await Product.findById(newItem.productId);

      if (!product) {
        return res.status(404).json({ message: `Product not found: ${newItem.productId}` });
      }

      // Check Stock (Prevent negative)
    //   if (product.currentStock < newItem.quantity) {
    //     return res.status(400).json({ 
    //       message: `Not enough stock for ${product.name}. Available: ${product.currentStock}` 
    //     });
    //   }

      // Deduct New Stock
    //   product.currentStock -= newItem.quantity;
    //   await product.save();

      totalQuantity += Number(newItem.quantity);
      
      newShipmentItems.push({
        product: product._id,
        productName: product.name,
        quantity: newItem.quantity,
        pricePerUnit: pricePerUnit
      });
    }

    // 5. Update Shipment Record
    shipment.items = newShipmentItems;
    shipment.totalQuantity = totalQuantity;
    shipment.totalAmount = totalQuantity * pricePerUnit;

    const updatedShipment = await shipment.save();
    res.json(updatedShipment);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get production stats for the last 7 days
// @route   GET /api/shipments/stats/weekly
// @access  Admin
const getWeeklyProductionStats = async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const stats = await Shipment.aggregate([
      { $match: { shippedAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dayOfWeek: "$shippedAt" }, // 1 (Sun) to 7 (Sat)
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
// @access  Private
const getShipmentById = async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id)
      .populate("sender", "name email") // Get user details
      .populate("items.product", "name brand photoUrl"); // Get product details

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
  updateShipment,getWeeklyProductionStats, getShipmentById // <--- NEW
};