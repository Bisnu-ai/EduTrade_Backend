const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    productTitle: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    transactionDate: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Indexes for fast history retrieval
transactionSchema.index({ seller: 1, transactionDate: -1 });
transactionSchema.index({ buyer: 1, transactionDate: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
