const router = require('express').Router()
const {
  placeOrder, getMyOrders, getAllOrders, getOne, updateStatus, deleteOrder,
} = require('../controllers/orderController')
const { auth, optionalAuth, roles } = require('../middleware/auth')

// Customer routes
router.post('/',     optionalAuth,                              placeOrder)
router.get('/my',    auth,                                      getMyOrders)

// Staff / kitchen / admin routes
router.get('/',      auth, roles('admin', 'staff', 'kitchen'), getAllOrders)
router.get('/:id',   auth,                                      getOne)
router.patch('/:id/status', auth, roles('admin', 'staff', 'kitchen'), updateStatus)
router.delete('/:id',       auth, roles('admin'),               deleteOrder)

module.exports = router
