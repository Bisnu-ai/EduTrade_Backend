const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "campuskart",
    allowed_formats: ["jpg", "png", "jpeg", "webp", "pdf"],
    resource_type: "auto",
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 5,
  },
});

// Avatar upload (single)
const uploadAvatar = upload.single("avatar");

// Product images (up to 5)
const uploadProductImages = upload.array("images", 5);

// Helper to extract public ID from Cloudinary URL
const getPublicIdFromUrl = (url) => {
  if (!url) return null;
  // Cloudinary URLs look like: https://res.cloudinary.com/.../upload/v123.../campuskart/filename.jpg
  // OR local urls look like: http://localhost:5000/uploads/file.jpg
  try {
    if (url.includes('cloudinary.com')) {
      const splitUrl = url.split("/");
      const filenameWithExt = splitUrl[splitUrl.length - 1];
      const folder = splitUrl[splitUrl.length - 2];
      const filename = filenameWithExt.split(".")[0];
      return `${folder}/${filename}`;
    } else {
      // It's a local file (legacy)
      return null; // Local files are no longer deleted this way, or we just ignore
    }
  } catch (error) {
    return null;
  }
};

// Helper to delete multiple product images
const deleteAllProductImages = async (imageUrls) => {
  if (!imageUrls || !Array.isArray(imageUrls)) return;
  
  for (const url of imageUrls) {
    try {
      const publicId = getPublicIdFromUrl(url);
      if (publicId) {
        await cloudinary.uploader.destroy(publicId);
      } else if (url.includes('/uploads/')) {
        // Fallback for legacy local images
        const fs = require('fs');
        const path = require('path');
        const filename = url.split('/').pop();
        if (filename) {
          const filepath = path.join(process.cwd(), process.env.UPLOAD_PATH || "uploads/", filename);
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
          }
        }
      }
    } catch (err) {
      console.error("FILE_DELETE_ERROR:", err);
    }
  }
};

// Helper to delete a file
const deleteFile = async (url) => {
  try {
    const publicId = getPublicIdFromUrl(url);
    if (publicId) {
      await cloudinary.uploader.destroy(publicId);
    } else if (url.includes('/uploads/')) {
       // Fallback for legacy local images
       const fs = require('fs');
       const path = require('path');
       const filename = url.split('/').pop();
       if (filename) {
         const filepath = path.join(process.cwd(), process.env.UPLOAD_PATH || "uploads/", filename);
         if (fs.existsSync(filepath)) {
           fs.unlinkSync(filepath);
         }
       }
    }
  } catch (err) {
    console.error("FILE_DELETE_ERROR:", err);
  }
};

module.exports = { 
  uploadAvatar, 
  uploadProductImages, 
  deleteFile, 
  deleteAllProductImages 
};