const router = require('express').Router()
const { submit, getAll, remove } = require('../controllers/contactController')
const { auth, roles } = require('../middleware/auth')

router.post('/',     submit)
router.get('/',      auth, roles('admin', 'staff'), getAll)
router.delete('/:id',auth, roles('admin'),          remove)

module.exports = router
