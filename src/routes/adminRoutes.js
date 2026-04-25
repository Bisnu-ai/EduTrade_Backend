const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { isAdmin } = require("../middleware/adminMiddleware");
const {
  getStats, getAllUsers, toggleBanUser, deleteUser,
  getAllProducts, deleteProduct, makeAdmin, demoteAdmin
} = require("../controllers/adminController");

// All routes require auth + admin role
router.use(protect, isAdmin);

router.get("/stats",              getStats);
router.get("/users",              getAllUsers);
router.put("/users/:id/ban",      toggleBanUser);
router.delete("/users/:id",       deleteUser);
router.put("/users/:id/admin",    makeAdmin);
router.put("/users/:id/demote",   demoteAdmin);
router.get("/products",           getAllProducts);
router.delete("/products/:id",    deleteProduct);

module.exports = router;
