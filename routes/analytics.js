const router = require('express').Router()
const {
  getStats, getDailyRevenue, getTopItems,
  getOrdersByStatus, getRecentOrders, getRevenueByCategory,
} = require('../controllers/analyticsController')
const { auth, roles } = require('../middleware/auth')

router.get('/stats',              auth, roles('admin'),          getStats)
router.get('/revenue/daily',      auth, roles('admin'),          getDailyRevenue)
router.get('/revenue/by-category',auth, roles('admin'),          getRevenueByCategory)
router.get('/top-items',          auth, roles('admin', 'staff'), getTopItems)
router.get('/orders/status',      auth, roles('admin', 'staff'), getOrdersByStatus)
router.get('/recent-orders',      auth, roles('admin', 'staff'), getRecentOrders)

module.exports = router
