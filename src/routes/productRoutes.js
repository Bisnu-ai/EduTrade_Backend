const express = require("express");
const router = express.Router();
const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  toggleWishlist,
  getWishlist,
  getMyListings,
  markAsSold,
  getCategories,
} = require("../controllers/productController");
const { protect, optionalAuth } = require("../middleware/auth");
const { uploadProductImages } = require("../middleware/upload");

// Public routes
router.get("/", getProducts);
router.get("/categories", getCategories);

// Protected routes (Static paths first)
router.get("/my-listings", protect, getMyListings);
router.get("/wishlist", protect, getWishlist);

// Dynamic ID routes (Last)
router.get("/:id", optionalAuth, getProduct);
router.post("/", protect, uploadProductImages, createProduct);
router.put("/:id", protect, uploadProductImages, updateProduct);
router.delete("/:id", protect, deleteProduct);
router.post("/:id/wishlist", protect, toggleWishlist);
router.put("/:id/mark-sold", protect, markAsSold);

module.exports = router;
