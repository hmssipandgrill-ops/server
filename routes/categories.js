const router = require('express').Router()
const { getAll, create, update, remove } = require('../controllers/categoryController')
const { auth, roles } = require('../middleware/auth')

router.get('/',      getAll)
router.post('/',     auth, roles('admin', 'staff'), create)
router.put('/:id',   auth, roles('admin', 'staff'), update)
router.delete('/:id',auth, roles('admin'),           remove)

module.exports = router
