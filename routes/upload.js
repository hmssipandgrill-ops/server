const router = require('express').Router()
const { uploadMenuImage, deleteImage } = require('../controllers/uploadController')
const { auth, roles } = require('../middleware/auth')

router.post('/menu-image',      auth, roles('admin', 'staff'), uploadMenuImage)
router.delete('/image/:publicId', auth, roles('admin', 'staff'), deleteImage)

module.exports = router
