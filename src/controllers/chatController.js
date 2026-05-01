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
    const senderId = req.user._id.toString();

    if (!recipientId || !productId || !message) {
      return res.status(400).json({ success: false, message: "Recipient, Product, and Message are required" });
    }

    // 1. Try to find an existing chat first
    let chat = await Chat.findOne({
      product: productId,
      $or: [
        { buyer: senderId, seller: recipientId },
        { buyer: recipientId, seller: senderId }
      ]
    });

    // 2. If no chat exists, we must create one (requires product to identify seller)
    if (!chat) {
      const productDoc = await Product.findById(productId);
      if (!productDoc) {
        return res.status(404).json({ success: false, message: "Product not found. Cannot start a new conversation." });
      }

      const actualSellerId = productDoc.seller.toString();
      const isSenderSeller = senderId === actualSellerId;

      chat = await Chat.create({
        product: productId,
        buyer: isSenderSeller ? recipientId : senderId,
        seller: actualSellerId,
        messages: []
      });
    }

    // 3. Update chat with the new message
    const isSenderSeller = senderId === chat.seller.toString();
    
    chat.messages.push({ 
      sender: senderId, 
      content: message,
      timestamp: new Date()
    });
    
    chat.lastMessage = message;
    chat.lastMessageAt = Date.now();
    
    // Update unread counts
    if (isSenderSeller) {
      chat.unreadCountBuyer = (chat.unreadCountBuyer || 0) + 1;
    } else {
      chat.unreadCountSeller = (chat.unreadCountSeller || 0) + 1;
    }

    await chat.save();
    return res.status(200).json({ success: true, message: "Message saved", data: { chatId: chat._id } });
  } catch (error) {
    console.error("Save message error:", error);
    next(error);
  }
};

module.exports = { getChatHistory, saveMessage };
