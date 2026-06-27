const { cloudinary, uploadMiddleware, uploadBuffer } = require('../config/cloudinary')

// POST /api/upload/menu-image  — multipart/form-data, field: "image"
exports.uploadMenuImage = (req, res) => {
  uploadMiddleware.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload failed' })
    if (!req.file) return res.status(400).json({ message: 'No file provided. Send an image file under the key "image".' })
    try {
      const result = await uploadBuffer(req.file.buffer, { folder: 'hms-lounge/menu' })
      res.json({ url: result.url, public_id: result.public_id, message: 'Uploaded successfully' })
    } catch (e) {
      res.status(500).json({ message: 'Cloudinary error: ' + e.message })
    }
  })
}

// DELETE /api/upload/image/:publicId
exports.deleteImage = async (req, res) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId)
    const result = await cloudinary.uploader.destroy(publicId)
    if (result.result !== 'ok')
      return res.status(400).json({ message: 'Could not delete image: ' + result.result })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}
