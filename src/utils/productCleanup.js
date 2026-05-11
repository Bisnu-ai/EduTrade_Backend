const cron = require("node-cron");
const Product = require("../models/Product");
const Notification = require("../models/Notification");
const User = require("../models/User");

/**
 * Scheduled task to manage old product listings
 * Runs every day at midnight (00:00)
 */
const initProductCleanup = () => {
  cron.schedule("0 0 * * *", async () => {
    console.log("🧹 Running daily product cleanup task...");

    try {
      // Find a system admin to act as sender
      const admin = await User.findOne({ role: "admin" });
      if (!admin) {
        console.warn("⚠️ No admin user found for sending cleanup notifications.");
        return;
      }

      const today = new Date();
      
      // 1. Handle 15-day notifications
      const fifteenDaysAgo = new Date(today);
      fifteenDaysAgo.setDate(today.getDate() - 15);
      
      // Find products updated exactly 15 days ago (to avoid duplicate notifications)
      // Actually, better to check for products between 15 and 16 days
      const sixteenDaysAgo = new Date(today);
      sixteenDaysAgo.setDate(today.getDate() - 16);

      const productsToNotify = await Product.find({
        isAvailable: true,
        updatedAt: { $lte: fifteenDaysAgo, $gt: sixteenDaysAgo }
      });

      for (const product of productsToNotify) {
        await Notification.create({
          recipient: product.seller,
          sender: admin._id,
          type: "system",
          title: "Product Update Required",
          message: `Your product "${product.title}" has been listed for 15 days. Please update or refresh it, otherwise it will be automatically deleted after 30 days of inactivity.`,
          relatedId: product._id
        });
        console.log(`✉️ Sent notification to seller of product: ${product.title}`);
      }

      // 2. Handle 30-day auto-deletions
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);

      const productsToDelete = await Product.find({
        isAvailable: true,
        updatedAt: { $lte: thirtyDaysAgo }
      });

      for (const product of productsToDelete) {
        // Optional: Notify seller about deletion
        await Notification.create({
          recipient: product.seller,
          sender: admin._id,
          type: "system",
          title: "Product Deleted",
          message: `Your product "${product.title}" has been automatically deleted due to 30 days of inactivity.`,
          relatedId: null
        });
        
        await Product.findByIdAndDelete(product._id);
        console.log(`🗑️ Auto-deleted old product: ${product.title}`);
      }

    } catch (err) {
      console.error("❌ Product cleanup error:", err.message);
    }
  });
};

module.exports = initProductCleanup;
