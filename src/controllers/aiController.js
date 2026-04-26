const Groq = require("groq-sdk");
const { CATEGORIES, CONDITIONS } = require("../models/Product");

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

    // Inform AI about user authentication status
    const userStatus = req.user 
      ? `AUTHENTICATED: User is logged in as ${req.user.name}. You can help them with everything.`
      : `UNAUTHENTICATED: User is NOT logged in. You must ask them to log in before they can list items or use advanced features.`;

    // System prompt with listing instructions and auth awareness
    const systemPrompt = `You are EduBot, the helpful AI assistant for EduTrade, a campus marketplace for college students. 
Your goal is to help students buy, sell, and trade items safely. Be friendly, concise, and professional. 

USER STATUS: ${userStatus}

GENERAL RULES:
- If the user is NOT logged in and tries to list an item or do something advanced, kindly ask them to login first.
- Mention that they are in the 'EduTrade' community.

LISTING PRODUCTS:
If an authenticated user wants to list or sell an item, collect these one by one:
1. Title
2. Description
3. Price (INR)
4. Category (${CATEGORIES.join(", ")})
5. Condition (${CONDITIONS.join(", ")})

Once you have ALL info, use 'list_product'. 
After listing, give them the link to upload images.`;

    const messages = [
      {
        role: "system",
        content: systemPrompt
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

    const tools = [
      {
        type: "function",
        function: {
          name: "list_product",
          description: "Saves product listing details for the user. Only use after collecting title, description, price, category, and condition.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Title of the item" },
              description: { type: "string", description: "Description of the item" },
              price: { type: "number", description: "Price in INR" },
              category: { type: "string", enum: CATEGORIES, description: "Category of the item" },
              condition: { type: "string", enum: CONDITIONS, description: "Condition of the item" },
              location: { type: "string", description: "Pickup location" },
            },
            required: ["title", "description", "price", "category", "condition"]
          }
        }
      }
    ];

    const chatCompletion = await groq.chat.completions.create({
      messages: messages,
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 1024,
      top_p: 1,
      stream: false,
      tools: tools,
      tool_choice: "auto"
    });

    const responseMessage = chatCompletion.choices[0].message;
    let reply = responseMessage.content;

    // Handle Tool Calls
    if (responseMessage.tool_calls) {
      const toolCall = responseMessage.tool_calls[0];
      if (toolCall.function.name === "list_product") {
        const args = JSON.parse(toolCall.function.arguments);
        
        if (!req.user) {
          reply = "I've collected all the details, but you need to log in first to list your item! Please sign in and let me know when you're ready.";
        } else {
          // Instead of creating the product directly (as images are required), 
          // we provide a link to the sell page with pre-filled details.
          const queryParams = new URLSearchParams({
            title: args.title,
            price: args.price,
            category: args.category,
            condition: args.condition,
            description: args.description,
            fromChat: "true"
          }).toString();
          
          reply = `Great! I've prepared your listing for **${args.title}**. 
          
Click here to add photos and publish: [Complete Your Listing](/sell?${queryParams})

Details collected:
- **Price**: ₹${args.price}
- **Category**: ${args.category}
- **Condition**: ${args.condition}`;
        }
      }
    }

    if (!reply) reply = "I'm not sure how to respond to that.";

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
