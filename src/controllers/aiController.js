const Groq = require("groq-sdk");

// POST /api/ai/chat
const chatWithAI = async (req, res, next) => {
  try {
    const { message, history } = req.body;

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ 
        success: false, 
        message: "AI Service (Groq) not configured. Please add GROQ_API_KEY to environment variables." 
      });
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    // Convert Gemini history format to OpenAI/Groq format if needed
    const messages = [
      {
        role: "system",
        content: "You are EduBot, the helpful AI assistant for EduTrade, a campus marketplace for college students. Your goal is to help students buy, sell, and trade items safely. Be friendly, concise, and professional. Mention that they are in the 'EduTrade' community. If they ask how to sell, tell them to click the 'Sell Item' button in the navbar."
      },
      ...((history || []).map(h => ({
        role: h.role === "model" ? "assistant" : "user",
        content: h.parts[0].text
      }))),
      {
        role: "user",
        content: message
      }
    ];

    const chatCompletion = await groq.chat.completions.create({
      messages: messages,
      model: "llama3-8b-8192", // Fast and free-tier friendly
      temperature: 0.7,
      max_tokens: 1024,
      top_p: 1,
      stream: false,
    });

    const reply = chatCompletion.choices[0]?.message?.content || "I'm not sure how to respond to that.";

    res.json({
      success: true,
      data: {
        reply: reply
      }
    });
  } catch (error) {
    console.error("Groq AI Error:", error.message);
    res.status(500).json({ success: false, message: "AI Assistant is busy. Please try again in a few seconds." });
  }
};

module.exports = { chatWithAI };
