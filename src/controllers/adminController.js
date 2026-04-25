const User = require("../models/User");
const Product = require("../models/Product");
const Chat = require("../models/Chat");
const Notification = require("../models/Notification");

// ── Dashboard Stats ──────────────────────────────────────────────────────────
const getStats = async (req, res, next) => {
  try {
    const [totalUsers, totalProducts, totalChats, bannedUsers, activeProducts] =
      await Promise.all([
        User.countDocuments(),
        Product.countDocuments(),
        Chat.countDocuments(),
        User.countDocuments({ isActive: false }),
        Product.countDocuments({ isAvailable: true }),
      ]);

    res.json({
      success: true,
      data: { totalUsers, totalProducts, totalChats, bannedUsers, activeProducts },
    });
  } catch (error) { next(error); }
};

// ── All Users ─────────────────────────────────────────────────────────────────
const getAllUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search = "" } = req.query;
    const query = search
      ? { $or: [{ name: { $regex: search, $options: "i" } }, { email: { $regex: search, $options: "i" } }] }
      : {};

    const users = await User.find(query)
      .select("name email college role isActive createdAt totalListings totalSold avatar")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await User.countDocuments(query);
    res.json({ success: true, data: { users, total, page: Number(page) } });
  } catch (error) { next(error); }
};

// ── Ban / Unban User ─────────────────────────────────────────────────────────
const toggleBanUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.role === "admin") return res.status(400).json({ success: false, message: "Cannot ban another admin" });

    user.isActive = !user.isActive;
    await user.save({ validateBeforeSave: false });

    res.json({ success: true, message: user.isActive ? "User unbanned" : "User banned", data: { isActive: user.isActive } });
  } catch (error) { next(error); }
};

// ── Delete User ───────────────────────────────────────────────────────────────
const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.role === "admin") return res.status(400).json({ success: false, message: "Cannot delete an admin" });

    // Cascade delete
    await Product.deleteMany({ seller: user._id });
    await Chat.deleteMany({ $or: [{ buyer: user._id }, { seller: user._id }] });
    await Notification.deleteMany({ $or: [{ recipient: user._id }, { sender: user._id }] });
    await user.deleteOne();

    res.json({ success: true, message: "User and all associated data deleted" });
  } catch (error) { next(error); }
};

// ── All Products ──────────────────────────────────────────────────────────────
const getAllProducts = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search = "" } = req.query;
    const query = search ? { title: { $regex: search, $options: "i" } } : {};

    const products = await Product.find(query)
      .populate("seller", "name email college")
      .select("title price category condition isAvailable createdAt images seller")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Product.countDocuments(query);
    res.json({ success: true, data: { products, total, page: Number(page) } });
  } catch (error) { next(error); }
};

// ── Delete Product ────────────────────────────────────────────────────────────
const deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    // 1. Increment the seller's 'totalSold' count before deleting
    // We only do this if the product is being deleted via a 'Mark as Sold' context 
    // or by an admin deciding it was sold.
    if (product.seller) {
      await User.findByIdAndUpdate(product.seller, { $inc: { totalSold: 1 } });
    }

    // 2. Cleanup associated data
    await Chat.deleteMany({ product: product._id });
    await product.deleteOne();

    res.json({ success: true, message: "Product deleted and seller stats updated" });
  } catch (error) { next(error); }
};

// ── Make Admin ────────────────────────────────────────────────────────────────
const makeAdmin = async (req, res, next) => {
  try {
    // Only the Super Admin (from .env) can promote someone
    if (req.user.email !== process.env.ADMIN_EMAIL) {
      return res.status(403).json({ success: false, message: "Only the Super Admin can promote users" });
    }

    const user = await User.findByIdAndUpdate(req.params.id, { role: "admin" }, { new: true });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, message: `${user.name} is now an admin` });
  } catch (error) { next(error); }
};

// ── Demote Admin ──────────────────────────────────────────────────────────────
const demoteAdmin = async (req, res, next) => {
  try {
    // Only the Super Admin can demote someone
    if (req.user.email !== process.env.ADMIN_EMAIL) {
      return res.status(403).json({ success: false, message: "Only the Super Admin can demote admins" });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Cannot demote the Super Admin themselves
    if (user.email === process.env.ADMIN_EMAIL) {
      return res.status(400).json({ success: false, message: "Cannot demote the Super Admin" });
    }

    user.role = "user";
    await user.save({ validateBeforeSave: false });

    res.json({ success: true, message: `${user.name} has been demoted to user` });
  } catch (error) { next(error); }
};

module.exports = { 
  getStats, 
  getAllUsers, 
  toggleBanUser, 
  deleteUser, 
  getAllProducts, 
  deleteProduct, 
  makeAdmin,
  demoteAdmin 
};
