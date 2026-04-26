const Product = require("../models/Product");
const User = require("../models/User");
const cache = require("../utils/cache");
const Transaction = require("../models/Transaction");
const { getFileUrl, deleteAllProductImages } = require("../middleware/upload");

// GET /api/products - Get all products with filters & pagination
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

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // ── Build Query (Relaxed for Debugging) ──────────────────────────────────
    const query = {}; 
    // query.isAvailable = true; // Temporarily commented out to find hidden products

    // Text Search
    if (search && search.trim().length > 0) {
      query.$or = [
        { title: { $regex: search.trim(), $options: "i" } },
        { description: { $regex: search.trim(), $options: "i" } }
      ];
    }

    // Category Filter (Case-insensitive & Slug-friendly)
    if (category && category !== "" && category !== "all" && category !== "undefined") {
      const categoryRegex = category.replace(/-/g, " ").trim();
      query.category = { $regex: `^${categoryRegex}$`, $options: "i" };
    }

    // Condition Filter
    if (condition && condition !== "" && condition !== "undefined") {
      const conditionRegex = condition.replace(/-/g, " ").trim();
      query.condition = { $regex: `^${conditionRegex}$`, $options: "i" };
    }

    // Price Range
    if (minPrice !== undefined || maxPrice !== undefined) {
      query.price = {};
      if (minPrice) query.price.$gte = parseFloat(minPrice);
      if (maxPrice) query.price.$lte = parseFloat(maxPrice);
    }

    // College & Seller
    if (college) query.college = { $regex: college, $options: "i" };
    if (seller) query.seller = seller;

    // ── Sort & Cache ─────────────────────────────────────────────────────────
    const sortMap = {
      "-createdAt": { createdAt: -1 },
      "createdAt": { createdAt: 1 },
      "-price": { price: -1 },
      "price": { price: 1 },
      "-views": { views: -1 },
    };
    const sortQuery = sortMap[sort] || { createdAt: -1 };

    // Skip cache if cache-buster is present
    const cacheKey = `products_list_${JSON.stringify(req.query)}`;
    if (!req.query._t) {
      const cachedData = cache.get(cacheKey);
      if (cachedData) {
        return res.status(200).json({ success: true, data: cachedData, source: "cache" });
      }
    }

    // ── Execute Query ────────────────────────────────────────────────────────
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
      },
    };

    // Cache the result for 5 minutes
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

    // Normalize Category and Condition to match Enums (Case-insensitive)
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

    // Invalidate cache
    cache.delByPrefix("products_list_");

    res.status(201).json({
      success: true,
      message: "Product listed successfully",
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/products/:id - Update product listing
const updateProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    if (product.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to update this listing",
      });
    }

    // Handle new images
    let imageUrls = product.images;
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map((file) => getFileUrl(req, file.filename));
      imageUrls = [...imageUrls, ...newImages].slice(0, 5);
    }

    const { category, condition } = req.body;
    
    // Normalize if provided
    let normalizedCategory = category;
    let normalizedCondition = condition;
    
    if (category || condition) {
      const { CATEGORIES, CONDITIONS } = require("../models/Product");
      if (category) {
        normalizedCategory = CATEGORIES.find(c => 
          c.toLowerCase().replace(/\s+/g, "-") === category.toLowerCase().replace(/\s+/g, "-")
        ) || category;
      }
      if (condition) {
        normalizedCondition = CONDITIONS.find(c => 
          c.toLowerCase().replace(/\s+/g, "-") === condition.toLowerCase().replace(/\s+/g, "-")
        ) || condition;
      }
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        images: imageUrls,
        category: normalizedCategory,
        condition: normalizedCondition,
      },
      { new: true, runValidators: true }
    );

    // Invalidate cache
    cache.delByPrefix("products_list_");
    cache.del(`product_${req.params.id}`);

    res.json({
      success: true,
      message: "Product updated successfully",
      data: updatedProduct,
    });
  } catch (error) {
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
        message: "You are not authorized to delete this listing",
      });
    }

    // Delete images from storage
    deleteAllProductImages(product.images);

    // Update seller's total listings count
    await User.findByIdAndUpdate(req.user._id, { $inc: { totalListings: -1 } });

    await product.deleteOne();

    // Invalidate cache
    cache.delByPrefix("products_list_");
    cache.del(`product_${req.params.id}`);

    res.json({ success: true, message: "Listing deleted successfully" });
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
        message: "Added to wishlist",
        data: { isWishlisted: true },
      });
    }
  } catch (error) {
    next(error);
  }
};

// GET /api/products/wishlist - Get user's wishlist
const getWishlist = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: "wishlist",
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

    // Invalidate cache
    cache.delByPrefix("products_list_");
    cache.del(`product_${req.params.id}`);

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