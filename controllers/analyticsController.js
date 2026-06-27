const Order = require('../models/Order')
const User = require('../models/User')
const MenuItem = require('../models/MenuItem')

// GET /api/analytics/stats
exports.getStats = async (req, res) => {
  try {
    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)

    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - 7)

    const monthStart = new Date(now)
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [
      totalOrders,
      totalCustomers,
      totalMenuItems,
      pendingOrders,
      allOrders,
      todayOrders,
      weekOrders,
      monthOrders,
    ] = await Promise.all([
      Order.countDocuments(),
      User.countDocuments({ role: 'customer' }),
      MenuItem.countDocuments({ isActive: true }),
      Order.countDocuments({ status: { $in: ['pending', 'received', 'preparing'] } }),
      Order.find({ status: { $nin: ['cancelled'] } }).select('total'),
      Order.find({ status: { $nin: ['cancelled'] }, createdAt: { $gte: todayStart } }).select('total'),
      Order.find({ status: { $nin: ['cancelled'] }, createdAt: { $gte: weekStart } }).select('total'),
      Order.find({ status: { $nin: ['cancelled'] }, createdAt: { $gte: monthStart } }).select('total'),
    ])

    const sum = (arr) => arr.reduce((s, o) => s + (o.total || 0), 0)

    res.json({
      totalOrders,
      totalCustomers,
      totalMenuItems,
      pendingOrders,
      totalRevenue: sum(allOrders),
      todayRevenue: sum(todayOrders),
      todayOrders: todayOrders.length,
      weekRevenue: sum(weekOrders),
      weekOrders: weekOrders.length,
      monthRevenue: sum(monthOrders),
      monthOrders: monthOrders.length,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// GET /api/analytics/revenue/daily?days=14
exports.getDailyRevenue = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 14, 90)
    const start = new Date()
    start.setDate(start.getDate() - days)
    start.setHours(0, 0, 0, 0)

    const orders = await Order.find({
      status: { $nin: ['cancelled'] },
      createdAt: { $gte: start },
    }).select('total createdAt')

    const byDay = {}
    orders.forEach((o) => {
      const day = o.createdAt.toISOString().split('T')[0]
      if (!byDay[day]) byDay[day] = { revenue: 0, orders: 0 }
      byDay[day].revenue += o.total || 0
      byDay[day].orders += 1
    })

    const result = []
    for (let i = days; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().split('T')[0]
      result.push({
        date: key,
        revenue: byDay[key]?.revenue || 0,
        orders: byDay[key]?.orders || 0,
      })
    }

    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// GET /api/analytics/top-items?limit=10
exports.getTopItems = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50)

    const topItems = await Order.aggregate([
      { $match: { status: { $nin: ['cancelled'] } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.name',
          totalSold: { $sum: '$items.qty' },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } },
        },
      },
      { $sort: { totalSold: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          name: '$_id',
          totalSold: 1,
          totalRevenue: 1,
        },
      },
    ])

    res.json({ items: topItems })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// GET /api/analytics/orders/status
exports.getOrdersByStatus = async (req, res) => {
  try {
    const breakdown = await Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { _id: 0, status: '$_id', count: 1 } },
    ])
    res.json({ breakdown })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// GET /api/analytics/recent-orders?limit=10
exports.getRecentOrders = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50)
    const orders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('user', 'name email')
    res.json({ orders })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// GET /api/analytics/revenue/by-category
exports.getRevenueByCategory = async (req, res) => {
  try {
    const result = await Order.aggregate([
      { $match: { status: { $nin: ['cancelled'] } } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'menuitems',
          localField: 'items.menuItem',
          foreignField: '_id',
          as: 'menuDetail',
        },
      },
      { $unwind: { path: '$menuDetail', preserveNullAndEmpty: true } },
      {
        $group: {
          _id: '$menuDetail.category',
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } },
          totalSold: { $sum: '$items.qty' },
        },
      },
      { $sort: { totalRevenue: -1 } },
      { $project: { _id: 0, category: '$_id', totalRevenue: 1, totalSold: 1 } },
    ])
    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}
