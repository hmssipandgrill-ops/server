const router = require('express').Router()
const {
  getAll, getOne, update, remove, updateProfile, changePassword,
} = require('../controllers/userController')
const { auth, roles } = require('../middleware/auth')

// Own profile (must come before /:id routes)
router.put('/me/profile',  auth, updateProfile)
router.put('/me/password', auth, changePassword)

// Admin-only user management
router.get('/',     auth, roles('admin'), getAll)
router.get('/:id',  auth, roles('admin'), getOne)
router.put('/:id',  auth, roles('admin'), update)
router.delete('/:id', auth, roles('admin'), remove)

module.exports = router
