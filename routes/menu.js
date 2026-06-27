const router = require('express').Router()
const { getAll, getOne, create, update, remove, toggleActive, toggleFeatured } = require('../controllers/menuController')
const { auth, roles } = require('../middleware/auth')

router.get('/',                   getAll)
router.get('/:id',                getOne)
router.post('/',                  auth, roles('admin','staff'), create)
router.put('/:id',                auth, roles('admin','staff'), update)
router.patch('/:id/toggle',       auth, roles('admin','staff'), toggleActive)
router.patch('/:id/featured',     auth, roles('admin','staff'), toggleFeatured)
router.delete('/:id',             auth, roles('admin'),         remove)

module.exports = router
