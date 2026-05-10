const Groq = require("groq-sdk");
const Product = require("../models/Product");
const { CATEGORIES, CONDITIONS } = Product;

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

    // Fetch marketplace context
    const totalProducts = await Product.countDocuments({ isAvailable: true });
    const donationCount = await Product.countDocuments({ isAvailable: true, isDonation: true });
    
    // Get 3 latest products for context
    const latestProducts = await Product.find({ isAvailable: true })
      .sort({ createdAt: -1 })
      .limit(3)
      .select("title price category");

    const productsContext = latestProducts.map(p => `- ${p.title} (₹${p.price}) in ${p.category}`).join("\n");

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    // Inform AI about user authentication status
    const userStatus = req.user 
      ? `AUTHENTICATED: User is logged in as ${req.user.name}. You can help them with everything.`
      : `UNAUTHENTICATED: User is NOT logged in. You must ask them to log in before they can list items or use advanced features.`;

    // System prompt with listing instructions and auth awareness
    const systemPrompt = `You are CampusBot, the helpful and friendly AI assistant for CampusKart, an exclusive campus marketplace.

CORE MISSION:
- Help users buy, sell, and trade items within their college community.
- Answer questions about the marketplace, how it works, and available items.

MARKETPLACE CURRENT STATUS:
- Total active items available: ${totalProducts}
- Free/Donation items: ${donationCount}
- Some recently listed items:
${productsContext || "No items listed yet."}

SCOPE & STYLE:
- Be encouraging and concise. Use emojis occasionally.
- If a user asks about something completely unrelated to campus life or trading (like deep coding, global politics, or general history), politely steer them back to CampusKart: "I'd love to help with your CampusKart trading needs! For [Topic], I suggest checking other resources. Want to find a deal on campus today?"
- NEVER give the same robotic "I am specifically designed..." response for everything. Actually try to answer marketplace-related questions.

USER STATUS: ${userStatus}

LISTING INSTRUCTIONS:
If an authenticated user wants to sell an item, collect these one-by-one in a conversational way:
1. Title, 2. Description, 3. Price (INR), 4. Category (${CATEGORIES.join(", ")}), 5. Condition (${CONDITIONS.join(", ")}).
Once all details are collected, call the 'list_product' tool.`;

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
        const rawArgs = JSON.parse(toolCall.function.arguments);
        // Trim all string arguments to prevent broken links
        const args = Object.fromEntries(
          Object.entries(rawArgs).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
        );
        
        if (!req.user) {
          reply = "I've collected all the details, but you need to log in first to list your item! Please sign in and let me know when you're ready.";
        } else {
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

**Details collected:**
- **Price:** ₹${args.price}
- **Category:** ${args.category}
- **Condition:** ${args.condition}`;
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
