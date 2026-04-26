const Product = require("../models/Product");
const User = require("../models/User");
const Notification = require("../models/Notification");
const Transaction = require("../models/Transaction");
const { getFileUrl, deleteFile } = require("../middleware/upload");
const { AppError } = require("../middleware/errorHandler");
const cache = require("../utils/cache");
const path = require("path");
const fs = require("fs");

// Helper to delete ALL product images from disk
const deleteAllProductImages = (imageUrls) => {
  if (!imageUrls || !Array.isArray(imageUrls)) return;
  
  imageUrls.forEach((imgUrl) => {
    try {
      const filename = path.basename(imgUrl);
      const filepath = path.join(
        process.cwd(),
        process.env.UPLOAD_PATH || "uploads/",
        filename
      );
      deleteFile(filepath);
    } catch (error) {
      console.error(`Failed to delete image: ${imgUrl}`, error);
    }
  });
};

// GET /api/products - List all products with filters, pagination, search
const getProducts = async (req, res, next) => {
  try {
    const {
      search,
      category,
      condition,
      minPrice,
      maxPrice,
      college,
      seller,
      sort = "-createdAt",
      page = 1,
      limit = 20,
    } = req.query;

    // Validate pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Initialize query
    const query = {};
    query.isAvailable = true;

    // Text search (only if provided and not empty)
    if (search && typeof search === 'string' && search.trim().length > 0) {
      query.$text = { $search: search.trim() };
    }

    // Filters
    if (category && category !== "" && category !== "all") {
      const { CATEGORIES } = require("../models/Product");
      // Find the actual category name from the enum (case-insensitive and handle slugs)
      const actualCategory = CATEGORIES.find(c => 
        c.toLowerCase().replace(/\s+/g, "-") === category.toLowerCase().replace(/\s+/g, "-")
      );

      if (!actualCategory) {
        return res.status(400).json({
          success: false,
          message: `Invalid category. Valid categories: ${CATEGORIES.join(", ")}`,
        });
      }
      query.category = actualCategory;
    }

    if (condition) {
      const { CONDITIONS } = require("../models/Product");
      const actualCondition = CONDITIONS.find(c => 
        c.toLowerCase().replace(/\s+/g, "-") === condition.toLowerCase().replace(/\s+/g, "-")
      );

      if (!actualCondition) {
        return res.status(400).json({
          success: false,
          message: `Invalid condition. Valid conditions: ${CONDITIONS.join(", ")}`,
        });
      }
      query.condition = actualCondition;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      query.price = {};
      if (minPrice !== undefined) {
        const min = parseFloat(minPrice);
        if (isNaN(min) || min < 0) {
          return res.status(400).json({ success: false, message: "Invalid minPrice" });
        }
        query.price.$gte = min;
      }
      if (maxPrice !== undefined) {
        const max = parseFloat(maxPrice);
        if (isNaN(max) || max < 0) {
          return res.status(400).json({ success: false, message: "Invalid maxPrice" });
        }
        query.price.$lte = max;
      }
      if (query.price.$gte !== undefined && query.price.$lte !== undefined) {
        if (query.price.$gte > query.price.$lte) {
          return res.status(400).json({ success: false, message: "minPrice cannot exceed maxPrice" });
        }
      }
    }

    if (college) query.college = { $regex: college, $options: "i" };
    if (seller) query.seller = seller;

    // Sort options
    const sortMap = {
      "-createdAt": { createdAt: -1 },
      createdAt: { createdAt: 1 },
      "-price": { price: -1 },
      price: { price: 1 },
      "-views": { views: -1 },
    };

    const sortQuery = sortMap[sort] || { createdAt: -1 };

    const cacheKey = `products_list_${JSON.stringify(req.query)}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        success: true,
        data: cachedData,
        source: "cache"
      });
    }

    const [products, total] = await Promise.all([
      Product.find(query)
        .sort(sortQuery)
        .skip(skip)
        .limit(limitNum)
        .populate("seller", "name avatar college rating"),
      Product.countDocuments(query),
    ]);

    const result = {
      products,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1,
      },
    };

    // Store in cache for 5 minutes
    cache.set(cacheKey, result, 300);

    res.status(200).json({
      success: true,
      data: result,
      source: "db"
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/products/:id - Get single product
const getProduct = async (req, res, next) => {
  try {
    const cacheKey = `product_${req.params.id}`;
    const cachedProduct = cache.get(cacheKey);
    if (cachedProduct) {
      return res.status(200).json({
        success: true,
        data: cachedProduct,
        source: "cache"
      });
    }

    const product = await Product.findById(req.params.id).populate(
      "seller",
      "name avatar college department year rating totalSold lastSeen"
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Increment views (don't await to keep response fast)
    Product.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }).exec();

    // Check if wishlisted by current user
    let isWishlisted = false;
    if (req.user) {
      isWishlisted = product.wishlistedBy.includes(req.user._id);
    }

    const result = { product, isWishlisted };
    cache.set(cacheKey, result, 600); // Cache for 10 mins

    res.status(200).json({
      success: true,
      data: result,
      source: "db"
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/products - Create new product listing
const createProduct = async (req, res, next) => {
  try {
    const {
      title,
      description,
      price,
      originalPrice,
      category,
      condition,
      location,
      tags,
    } = req.body;

    // Must have at least 1 image
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one product image is required",
      });
    }

    const imageUrls = req.files.map((file) => getFileUrl(req, file.filename));

    // Parse tags if sent as string
    let parsedTags = [];
    if (tags) {
      parsedTags = typeof tags === "string" ? JSON.parse(tags) : tags;
      if (!Array.isArray(parsedTags)) {
        return res.status(400).json({ success: false, message: "Tags must be an array" });
      }
    }

    // Normalize Category and Condition to match Enums
    const { CATEGORIES, CONDITIONS } = require("../models/Product");
    const normalizedCategory = CATEGORIES.find(c => 
      c.toLowerCase().replace(/\s+/g, "-") === category?.toLowerCase().replace(/\s+/g, "-")
    ) || category;

    const normalizedCondition = CONDITIONS.find(c => 
      c.toLowerCase().replace(/\s+/g, "-") === condition?.toLowerCase().replace(/\s+/g, "-")
    ) || condition;

    const product = await Product.create({
      title,
      description,
      price,
      originalPrice: originalPrice || undefined,
      category: normalizedCategory,
      condition: normalizedCondition,
      images: imageUrls,
      seller: req.user._id,
      college: req.user.college,
      location,
      tags: parsedTags,
    });

    // Update seller's total listings
    await User.findByIdAndUpdate(req.user._id, { $inc: { totalListings: 1 } });

    const populated = await product.populate(
      "seller",
      "name avatar college rating"
    );

    // Invalidate cache
    cache.delByPrefix("products_list_");

    res.status(201).json({
      success: true,
      message: "Product listed successfully! 🎉",
      data: { product: populated },
    });
  } catch (error) {
    // Delete uploaded files if product creation fails
    if (req.files) {
      req.files.forEach((file) => deleteFile(file.path));
    }
    next(error);
  }
};

// PUT /api/products/:id - Update product
const updateProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    if (product.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own listings",
      });
    }

    if (!product.isAvailable) {
      return res.status(400).json({
        success: false,
        message: "Cannot edit a sold product",
      });
    }

    const allowed = [
      "title", "description", "price", "originalPrice",
      "category", "condition", "location", "tags", "isAvailable",
    ];

    const updateData = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    // Handle new images
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map((f) => getFileUrl(req, f.filename));
      updateData.images = newImages;
    }

    // Handle isAvailable logic (move to history and delete)
    if (updateData.isAvailable === false && product.isAvailable === true) {
      // 1. Create Transaction Record
      await Transaction.create({
        productTitle: product.title,
        price: product.price,
        category: product.category,
        seller: product.seller,
        buyer: req.user._id, // Assume current user is buyer if not specified, or handle differently
      });

      // 2. Delete All Images
      deleteAllProductImages(product.images);

      // 3. Delete Product
      await product.deleteOne();

      return res.status(200).json({
        success: true,
        message: "Product marked as sold, moved to history, and deleted from listings",
      });
    }

    const updated = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).populate("seller", "name avatar college rating");

    // Invalidate cache
    cache.delByPrefix("products_list_");
    cache.del(`product_${req.params.id}`);

    res.status(200).json({
      success: true,
      message: updateData.isAvailable === false 
        ? "Product marked as sold and images cleared" 
        : "Product updated successfully",
      data: { product: updated },
    });
  } catch (error) {
    if (req.files) {
      req.files.forEach((f) => deleteFile(f.path));
    }
    next(error);
  }
};

// DELETE /api/products/:id - Delete product listing
const deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    if (product.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own listings",
      });
    }

    // Delete associated images
    product.images.forEach((imgUrl) => {
      const filename = path.basename(imgUrl);
      const filepath = path.join(
        process.cwd(),
        process.env.UPLOAD_PATH || "uploads/",
        filename
      );
      deleteFile(filepath);
    });

    await product.deleteOne();
    await User.findByIdAndUpdate(product.seller, {
      $inc: { totalListings: -1 },
    });

    // Invalidate cache
    cache.delByPrefix("products_list_");
    cache.del(`product_${req.params.id}`);

    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/products/:id/wishlist - Toggle wishlist
const toggleWishlist = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    if (!product.isAvailable) {
      return res.status(400).json({
        success: false,
        message: "Cannot wishlist a sold product",
      });
    }

    if (product.seller.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot wishlist your own product",
      });
    }

    const userId = req.user._id;
    const isWishlisted = product.wishlistedBy.includes(userId);

    if (isWishlisted) {
      // Remove from wishlist
      await Promise.all([
        Product.findByIdAndUpdate(product._id, { $pull: { wishlistedBy: userId } }),
        User.findByIdAndUpdate(userId, { $pull: { wishlist: product._id } }),
      ]);
      return res.status(200).json({
        success: true,
        message: "Removed from wishlist",
        data: { isWishlisted: false },
      });
    } else {
      // Add to wishlist
      await Promise.all([
        Product.findByIdAndUpdate(product._id, { $addToSet: { wishlistedBy: userId } }),
        User.findByIdAndUpdate(userId, { $addToSet: { wishlist: product._id } }),
      ]);
      return res.status(200).json({
        success: true,
        message: "Added to wishlist ❤️",
        data: { isWishlisted: true },
      });
    }
  } catch (error) {
    next(error);
  }
};

// GET /api/products/wishlist - Get current user's wishlist
const getWishlist = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: "wishlist",
      match: { isAvailable: true },
      populate: { path: "seller", select: "name avatar college" },
    });

    res.status(200).json({
      success: true,
      data: {
        wishlist: user.wishlist,
        total: user.wishlist.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/products/my-listings - Current user's listings
const getMyListings = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const query = { seller: req.user._id };
    if (status === "available") query.isAvailable = true;
    else if (status === "sold") query.isAvailable = false;

    const [products, total] = await Promise.all([
      Product.find(query)
        .sort("-createdAt")
        .skip(skip)
        .limit(limitNum),
      Product.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: {
        products,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/products/:id/mark-sold - Mark product as sold
const markAsSold = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    if (product.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only mark your own products as sold",
      });
    }

    if (!product.isAvailable) {
      return res.status(400).json({
        success: false,
        message: "Product is already marked as sold",
      });
    }

    if (!req.body.soldTo) {
      return res.status(400).json({ success: false, message: "Buyer (soldTo) ID is required" });
    }

    // 1. Create Transaction Record
    await Transaction.create({
      productTitle: product.title,
      price: product.price,
      category: product.category,
      seller: product.seller,
      buyer: req.body.soldTo,
    });

    // 2. Delete All Images from disk
    deleteAllProductImages(product.images);

    // 3. Increment seller's total sold count
    await User.findByIdAndUpdate(req.user._id, { $inc: { totalSold: 1 } });

    // 4. Delete the original product document
    await product.deleteOne();

    res.status(200).json({
      success: true,
      message: "Product successfully sold and moved to history record",
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/products/categories - Get all category info
const getCategories = async (req, res) => {
  const { CATEGORIES, CONDITIONS } = require("../models/Product");
  res.status(200).json({
    success: true,
    data: { categories: CATEGORIES, conditions: CONDITIONS },
  });
};

module.exports = {
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
};