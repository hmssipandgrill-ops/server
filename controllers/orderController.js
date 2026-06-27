const Order = require('../models/Order')

// POST /api/orders  — place a new order (guest or logged-in)
exports.placeOrder = async (req, res) => {
  try {
    const { items, tableNumber, notes, total } = req.body

    if (!items || items.length === 0)
      return res.status(400).json({ message: 'Order must contain at least one item' })
    if (!tableNumber || !tableNumber.toString().trim())
      return res.status(400).json({ message: 'Table number is required' })
    if (!total || total <= 0)
      return res.status(400).json({ message: 'Invalid order total' })

    // Validate each item has the required fields
    for (const item of items) {
      if (!item.name || !item.qty || !item.price) {
        return res.status(400).json({ message: 'Each item must have a name, quantity and price' })
      }
    }

    const order = await Order.create({
      user: req.user?._id || null,
      items,
      tableNumber: tableNumber.toString().trim(),
      notes: notes?.trim() || '',
      total: Number(total),
      status: 'pending',
    })

    // Broadcast to all staff/kitchen/admin rooms
    req.io.to('kitchen').emit('new-order', order)
    req.io.to('admin').emit('new-order', order)
    req.io.to('staff').emit('new-order', order)

    res.status(201).json({ order })
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
}

// GET /api/orders/my  — current user's own orders
exports.getMyOrders = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query
    const total = await Order.countDocuments({ user: req.user._id })
    const orders = await Order.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
    res.json({ orders, total })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// GET /api/orders  — all orders (staff / kitchen / admin)
exports.getAllOrders = async (req, res) => {
  try {
    const { status, tableNumber, page = 1, limit = 50, sort = '-createdAt' } = req.query

    const filter = {}

    if (status) {
      const statuses = status.split(',').map((s) => s.trim())
      filter.status = statuses.length > 1 ? { $in: statuses } : statuses[0]
    }
    if (tableNumber) filter.tableNumber = tableNumber

    const total = await Order.countDocuments(filter)
    const orders = await Order.find(filter)
      .populate('user', 'name email')
      .sort(sort)
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))

    res.json({ orders, total, page: Number(page) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// GET /api/orders/:id  — single order
exports.getOne = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'name email')
    if (!order) return res.status(404).json({ message: 'Order not found' })

    // Customers can only see their own orders
    if (req.user.role === 'customer' && order.user?._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' })
    }

    res.json({ order })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// PATCH /api/orders/:id/status  — update order status (kitchen/staff/admin)
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['pending', 'received', 'preparing', 'ready', 'served', 'cancelled']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be one of: ' + validStatuses.join(', ') })
    }

    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ message: 'Order not found' })

    // Prevent going backwards (e.g. served → pending)
    const flow = ['pending', 'received', 'preparing', 'ready', 'served']
    const currentIdx = flow.indexOf(order.status)
    const newIdx = flow.indexOf(status)
    if (newIdx !== -1 && currentIdx !== -1 && newIdx < currentIdx && status !== 'cancelled') {
      return res.status(400).json({ message: 'Cannot move order backwards in status flow' })
    }

    order.status = status
    await order.save()

    // Broadcast to all connected clients
    req.io.emit('order-updated', order)

    // Notify specific customer if logged in
    if (order.user) {
      req.io.to('customer-' + order.user.toString()).emit('my-order-updated', order)
    }

    // If ready, send a specific ready ping
    if (status === 'ready' && order.user) {
      req.io.to('customer-' + order.user.toString()).emit('order-ready', {
        orderId: order._id,
        tableNumber: order.tableNumber,
      })
    }

    res.json({ order })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// DELETE /api/orders/:id  — cancel/delete order (admin only)
exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id)
    if (!order) return res.status(404).json({ message: 'Order not found' })
    req.io.emit('order-deleted', { orderId: req.params.id })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}
