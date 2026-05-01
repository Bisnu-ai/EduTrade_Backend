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

    // 1. Try to find an existing chat first (allows chatting after product deletion)
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
        return res.status(404).json({ success: false, message: "Product not found. Cannot start new chat." });
      }

      const actualSellerId = productDoc.seller.toString();
      const isSenderSeller = senderId.toString() === actualSellerId;

      chat = await Chat.create({
        product: productId,
        buyer: isSenderSeller ? recipientId : senderId,
        seller: actualSellerId,
        messages: []
      });
    }

    const isSenderSeller = senderId.toString() === chat.seller.toString();

    // 3. Save the Message
    chat.messages.push({ sender: senderId, content: message });
    chat.lastMessage = message;
    chat.lastMessageAt = Date.now();
    
    // Increment unread counts
    if (isSenderSeller) {
      chat.unreadCountBuyer = (chat.unreadCountBuyer || 0) + 1;
    } else {
      chat.unreadCountSeller = (chat.unreadCountSeller || 0) + 1;
    }

    await chat.save();
    return res.status(200).json({ success: true, message: "Message saved", data: { chatId: chat._id } });
  } catch (error) {
    next(error);
  }
};

module.exports = { getChatHistory, saveMessage };
