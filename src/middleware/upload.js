const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");

// Ensure upload directory exists
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(
      process.cwd(),
      process.env.UPLOAD_PATH || "uploads/"
    );
    ensureDir(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new multer.MulterError(
        "LIMIT_UNEXPECTED_FILE",
        "Only JPEG, PNG, and WebP images are allowed"
      ),
      false
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024, // 5MB
    files: 5,
  },
});

// Avatar upload (single)
const uploadAvatar = upload.single("avatar");

// Product images (up to 5)
const uploadProductImages = upload.array("images", 5);

// Helper to get public URL from filename
const getFileUrl = (req, filename) => {
  if (!filename) return null;
  return `${req.protocol}://${req.get("host")}/uploads/${filename}`;
};

// Helper to delete multiple product images
const deleteAllProductImages = (imageUrls) => {
  if (!imageUrls || !Array.isArray(imageUrls)) return;
  
  imageUrls.forEach(url => {
    try {
      // Extract filename from URL (e.g., http://localhost:5000/uploads/file.jpg -> file.jpg)
      const filename = url.split('/').pop();
      if (filename) {
        const filepath = path.join(process.cwd(), process.env.UPLOAD_PATH || "uploads/", filename);
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
      }
    } catch (err) {
      console.error("FILE_DELETE_ERROR:", err);
    }
  });
};

// Helper to delete a file
const deleteFile = (filepath) => {
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
  }
};

module.exports = { 
  uploadAvatar, 
  uploadProductImages, 
  getFileUrl, 
  deleteFile, 
  deleteAllProductImages 
};