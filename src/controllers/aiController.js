const { GoogleGenerativeAI } = require("@google/generative-ai");

// POST /api/ai/chat
const chatWithAI = async (req, res, next) => {
  try {
    const { message, history } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ 
        success: false, 
        message: "AI Service not configured. Please add GEMINI_API_KEY to environment variables." 
      });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: "You are EduBot, the helpful AI assistant for EduTrade, a campus marketplace for college students. Your goal is to help students buy, sell, and trade items safely. You should be friendly, concise, and professional. If users ask about technical issues, tell them to contact support. If they ask how to sell, explain that they need to click the 'Sell Item' button." }],
        },
        {
          role: "model",
          parts: [{ text: "Hello! I am EduBot, your EduTrade assistant. How can I help you today?" }],
        },
        ...(history || [])
      ],
    });

    const result = await chat.sendMessage(message);
    const response = await result.response;
    const text = response.text();

    res.json({
      success: true,
      data: {
        reply: text
      }
    });
  } catch (error) {
    console.error("AI Chat Error:", error.message);
    res.status(500).json({ success: false, message: "AI Assistant is busy right now. Try again later." });
  }
};

module.exports = { chatWithAI };
