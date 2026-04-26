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
    } = req.query || {};

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    // ── Build Query ──────────────────────────────────────────────────────────
    const query = {}; 
    // query.isAvailable = true; // Commented out for debugging, show everything!

    // Text Search (Regex is more reliable than $text if indexes aren't set)
    if (search && typeof search === 'string' && search.trim().length > 0) {
      const s = search.trim();
      query.$or = [
        { title: { $regex: s, $options: "i" } },
        { description: { $regex: s, $options: "i" } },
        { category: { $regex: s, $options: "i" } }
      ];
    }

    // Category Filter
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
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = parseFloat(minPrice);
      if (maxPrice) query.price.$lte = parseFloat(maxPrice);
    }

    // College & Seller
    if (college && college !== "undefined") query.college = { $regex: college, $options: "i" };
    if (seller && seller !== "undefined") query.seller = seller;

    // ── Sort ─────────────────────────────────────────────────────────────────
    const sortMap = {
      "-createdAt": { createdAt: -1 },
      "createdAt": { createdAt: 1 },
      "-price": { price: -1 },
      "price": { price: 1 },
      "-views": { views: -1 },
    };
    const sortQuery = sortMap[sort] || { createdAt: -1 };

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
      products: products || [],
      pagination: {
        total: total || 0,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil((total || 0) / limitNum),
      },
    };

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("GET_PRODUCTS_ERROR:", error);
    res.status(500).json({ success: false, message: "Internal Server Error in getProducts" });
  }
};

// GET /api/products/my-listings - Current user's listings
const getMyListings = async (req, res, next) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const { status, page = 1, limit = 20 } = req.query || {};
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const query = { seller: req.user._id };
    if (status === "available") query.isAvailable = true;
    else if (status === "sold") query.isAvailable = false;

    const [products, total] = await Promise.all([
      Product.find(query)
        .sort("-createdAt")
        .skip(skip)
        .limit(limitNum)
        .populate("seller", "name avatar college"),
      Product.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: {
        products: products || [],
        pagination: {
          total: total || 0,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil((total || 0) / limitNum),
        },
      },
    });
  } catch (error) {
    console.error("GET_MY_LISTINGS_ERROR:", error);
    res.status(500).json({ success: false, message: "Internal Server Error in getMyListings" });
  }
};

// GET /api/products/:id - Get single product
const getProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id).populate(
      "seller",
      "name avatar college department year rating totalSold lastSeen"
    );

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    // Increment views
    Product.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }).exec().catch(() => {});

    let isWishlisted = false;
    if (req.user && product.wishlistedBy) {
      isWishlisted = product.wishlistedBy.includes(req.user._id);
    }

    res.status(200).json({
      success: true,
      data: { product, isWishlisted }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching product details" });
  }
};

// POST /api/products - Create new product listing
const createProduct = async (req, res, next) => {
  try {
    const { title, description, price, originalPrice, category, condition, location, tags } = req.body;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "At least one product image is required" });
    }

    const imageUrls = req.files.map((file) => getFileUrl(req, file.filename));

    let parsedTags = [];
    try {
      if (tags) parsedTags = typeof tags === "string" ? JSON.parse(tags) : tags;
    } catch (e) { parsedTags = []; }

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
      tags: Array.isArray(parsedTags) ? parsedTags : [],
    });

    await User.findByIdAndUpdate(req.user._id, { $inc: { totalListings: 1 } });
    cache.flush(); // Flush everything to be safe

    res.status(201).json({ success: true, message: "Product listed successfully", data: product });
  } catch (error) {
    next(error);
  }
};

// Other functions kept as they were but with added safety...
const updateProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    if (product.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    let imageUrls = product.images;
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map((file) => getFileUrl(req, file.filename));
      imageUrls = [...imageUrls, ...newImages].slice(0, 5);
    }

    const { category, condition } = req.body;
    let normalizedCategory = category;
    let normalizedCondition = condition;
    
    if (category || condition) {
      const { CATEGORIES, CONDITIONS } = require("../models/Product");
      if (category) normalizedCategory = CATEGORIES.find(c => c.toLowerCase().replace(/\s+/g, "-") === category.toLowerCase().replace(/\s+/g, "-")) || category;
      if (condition) normalizedCondition = CONDITIONS.find(c => c.toLowerCase().replace(/\s+/g, "-") === condition.toLowerCase().replace(/\s+/g, "-")) || condition;
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      { ...req.body, images: imageUrls, category: normalizedCategory, condition: normalizedCondition },
      { new: true, runValidators: true }
    );

    cache.flush();
    res.json({ success: true, message: "Product updated", data: updatedProduct });
  } catch (error) { next(error); }
};

const deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    if (product.seller.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: "Unauthorized" });

    deleteAllProductImages(product.images);
    await User.findByIdAndUpdate(req.user._id, { $inc: { totalListings: -1 } });
    await product.deleteOne();
    cache.flush();

    res.json({ success: true, message: "Listing deleted" });
  } catch (error) { next(error); }
};

const toggleWishlist = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    const userId = req.user._id;
    const isWishlisted = product.wishlistedBy.includes(userId);

    if (isWishlisted) {
      await Promise.all([
        Product.findByIdAndUpdate(product._id, { $pull: { wishlistedBy: userId } }),
        User.findByIdAndUpdate(userId, { $pull: { wishlist: product._id } }),
      ]);
      res.json({ success: true, data: { isWishlisted: false } });
    } else {
      await Promise.all([
        Product.findByIdAndUpdate(product._id, { $addToSet: { wishlistedBy: userId } }),
        User.findByIdAndUpdate(userId, { $addToSet: { wishlist: product._id } }),
      ]);
      res.json({ success: true, data: { isWishlisted: true } });
    }
  } catch (error) { next(error); }
};

const getWishlist = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: "wishlist",
      populate: { path: "seller", select: "name avatar college" },
    });
    res.json({ success: true, data: { wishlist: user.wishlist, total: user.wishlist.length } });
  } catch (error) { next(error); }
};

const markAsSold = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    if (product.seller.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: "Unauthorized" });

    await Transaction.create({ productTitle: product.title, price: product.price, category: product.category, seller: product.seller, buyer: req.body.soldTo });
    deleteAllProductImages(product.images);
    await User.findByIdAndUpdate(req.user._id, { $inc: { totalSold: 1 } });
    await product.deleteOne();
    cache.flush();

    res.json({ success: true, message: "Product marked as sold" });
  } catch (error) { next(error); }
};

const getCategories = async (req, res) => {
  const { CATEGORIES, CONDITIONS } = require("../models/Product");
  res.json({ success: true, data: { categories: CATEGORIES, conditions: CONDITIONS } });
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