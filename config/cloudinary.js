const cloudinary = require('cloudinary').v2
const multer     = require('multer')

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// Memory storage — no temp files on disk
const storage = multer.memoryStorage()

const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },   // 8MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are allowed (jpg, png, webp, gif)'), false)
  },
})

// Upload a Buffer to Cloudinary — returns { url, public_id }
const uploadBuffer = (buffer, options = {}) => new Promise((resolve, reject) => {
  const defaults = {
    folder:          'hms-lounge/menu',
    transformation:  [{ width: 900, height: 700, crop: 'fill', quality: 'auto', fetch_format: 'auto' }],
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  }
  const stream = cloudinary.uploader.upload_stream(
    { ...defaults, ...options },
    (error, result) => {
      if (error) return reject(error)
      resolve({ url: result.secure_url, public_id: result.public_id })
    }
  )
  stream.end(buffer)
})

// Upload a local file path — used by seed script
const uploadFile = (localPath, options = {}) => {
  const defaults = {
    folder:          'hms-lounge/menu',
    transformation:  [{ width: 900, height: 700, crop: 'fill', quality: 'auto', fetch_format: 'auto' }],
    use_filename:    false,
    unique_filename: true,
  }
  return cloudinary.uploader.upload(localPath, { ...defaults, ...options })
}

module.exports = { cloudinary, uploadMiddleware, uploadBuffer, uploadFile }
