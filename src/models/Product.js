const mongoose = require("mongoose");

const CATEGORIES = [
  "textbooks",
  "electronics",
  "dorm-essentials",
  "stationery",
  "fashion",
  "bicycles",
  "others",
];

const CONDITIONS = ["new", "gently-used", "fair", "heavily-used"];

const productSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Product title is required"],
      trim: true,
      minlength: [3, "Title must be at least 3 characters"],
      maxlength: [100, "Title cannot exceed 100 characters"],
    },
    description: {
      type: String,
      required: [true, "Product description is required"],
      trim: true,
      minlength: [10, "Description must be at least 10 characters"],
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
      max: [999999, "Price cannot exceed 9,99,999"],
    },
    originalPrice: {
      type: Number,
      min: [0, "Original price cannot be negative"],
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      enum: {
        values: CATEGORIES,
        message: `Category must be one of: ${CATEGORIES.join(", ")}`,
      },
    },
    condition: {
      type: String,
      required: [true, "Condition is required"],
      enum: {
        values: CONDITIONS,
        message: `Condition must be one of: ${CONDITIONS.join(", ")}`,
      },
    },
    images: {
      type: [String],
      validate: {
        validator: function (arr) {
          // Mandatory: Always at least 1 image
          if (arr.length < 1) return false;
          
          // If available, must have 1-5 images. If sold, we keep only 1.
          if (this.isAvailable) {
            return arr.length <= 5;
          }
          return arr.length === 1; // After sold, we keep exactly the thumbnail
        },
        message: "Product must have at least 1 image (Max 5 when available)",
      },
      required: [true, "At least one image is required"],
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Seller is required"],
    },
    college: {
      type: String,
      required: [true, "College is required"],
      trim: true,
    },
    location: {
      type: String,
      trim: true,
      maxlength: [100, "Location cannot exceed 100 characters"],
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    isDonation: {
      type: Boolean,
      default: false,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    views: {
      type: Number,
      default: 0,
    },
    wishlistedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    tags: {
      type: [String],
      validate: {
        validator: function (arr) {
          return arr.length <= 10;
        },
        message: "Cannot have more than 10 tags",
      },
    },
    soldAt: {
      type: Date,
      default: null,
    },
    soldTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for search & filter performance
productSchema.index({ title: "text", description: "text", tags: "text" });
productSchema.index({ category: 1, isAvailable: 1, isDonation: 1 });
productSchema.index({ seller: 1 });
productSchema.index({ college: 1, isAvailable: 1 });
productSchema.index({ price: 1, isDonation: 1 });
productSchema.index({ createdAt: -1 });

// Virtual: discount percentage
productSchema.virtual("discountPercent").get(function () {
  if (this.originalPrice && this.originalPrice > this.price) {
    return Math.round(
      ((this.originalPrice - this.price) / this.originalPrice) * 100
    );
  }
  return 0;
});

// Virtual: wishlist count
productSchema.virtual("wishlistCount").get(function () {
  return this.wishlistedBy ? this.wishlistedBy.length : 0;
});

module.exports = mongoose.model("Product", productSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.CONDITIONS = CONDITIONS;

//Bisnu,Manish
