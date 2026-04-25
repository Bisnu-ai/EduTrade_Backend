const Chat = require("../models/Chat");
const Product = require("../models/Product");

// GET /api/chat/history?recipientId=...&productId=...
const getChatHistory = async (req, res, next) => {
  try {
    const { recipientId, productId } = req.query;
    const userId = req.user._id;

    if (!recipientId || !productId) {
      return res.status(400).json({ success: false, message: "Recipient and Product ID are required" });
    }

    const chat = await Chat.findOne({
      product: productId,
      $or: [
        { buyer: userId, seller: recipientId },
        { buyer: recipientId, seller: userId }
      ]
    });

    return res.status(200).json({
      success: true,
      data: { messages: chat ? chat.messages : [] }
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/chat/message
const saveMessage = async (req, res, next) => {
  try {
    const { recipientId, productId, message } = req.body;
    const senderId = req.user._id;

    if (!recipientId || !productId || !message) {
      return res.status(400).json({ success: false, message: "recipientId, productId, and message are required" });
    }

    // Find existing chat
    let chat = await Chat.findOne({
      product: productId,
      $or: [
        { buyer: senderId, seller: recipientId },
        { buyer: recipientId, seller: senderId }
      ]
    });

    if (!chat) {
      // Get product to identify seller
      const productDoc = await Product.findById(productId);
      if (!productDoc) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      const isSender = senderId.toString() === productDoc.seller.toString();

      chat = await Chat.create({
        product: productId,
        buyer: isSender ? recipientId : senderId,
        seller: productDoc.seller,
        messages: []
      });
    }

    chat.messages.push({ sender: senderId, content: message });
    chat.lastMessage = message;
    chat.lastMessageAt = Date.now();
    await chat.save();

    return res.status(200).json({ success: true, message: "Message saved" });
  } catch (error) {
    next(error);
  }
};

module.exports = { getChatHistory, saveMessage };
