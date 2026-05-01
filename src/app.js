const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const path = require("path");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const { errorHandler, notFound } = require("./middleware/errorHandler");

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const app = express();

// Optimization: Compress all responses
app.use(compression());

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Enable CORS
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({ 
  origin: allowedOrigins, 
  credentials: true 
}));

// Set security headers
app.use(helmet({ crossOriginResourcePolicy: false }));

// Dev logging middleware
if (process.env.NODE_ENV === "development") {
  // Custom morgan format with time
  app.use(morgan("[:date[clf]] :method :url :status :response-time ms - :res[content-length]"));
}

// Set static folder
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Welcome route
app.get("/", (req, res) => {
  res.json({ success: true, message: "Welcome to EduTrade API 🎓", version: "1.0.0", status: "Healthy" });
});

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/chat", require("./routes/chatRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/ai", require("./routes/aiRoutes"));

// Error handling
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`);
});

// ───── Socket.io ─────
const Notification = require("./models/Notification");

const io = require("socket.io")(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.set("io", io);

io.on("connection", (socket) => {
  console.log("✅ Client connected:", socket.id);

  socket.on("join", (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined room`);
  });

  socket.on("sendMessage", async (data) => {
    // Real-time delivery to recipient
    socket.to(data.recipientId).emit("receiveMessage", data);

    // Persist notification in DB
    try {
      if (data.recipientId && data.senderId) {
        const notification = await Notification.create({
          recipient: data.recipientId,
          sender: data.senderId,
          type: "message",
          title: "New Message",
          message: `${data.senderName || "Someone"} sent you a message`,
          relatedId: data.productId || null,
        });
        io.to(data.recipientId).emit("newNotification", notification);
      }
    } catch (err) {
      console.error("Notification save error:", err.message);
    }
  });

  socket.on("showRating", (data) => {
    // Relay the rating prompt to the buyer
    if (data.recipientId) {
      socket.to(data.recipientId).emit("showRating");
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
});

// ───── Graceful shutdown ─────
const gracefulShutdown = () => {
  console.log("Shutting down gracefully...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
  // Force close after 5s
  setTimeout(() => process.exit(1), 5000);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

process.on("unhandledRejection", (err) => {
  console.log(`Unhandled Rejection: ${err.message}`);
  gracefulShutdown();
});

module.exports = app;
