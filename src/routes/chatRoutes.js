const express = require("express");
const router = express.Router();
const { getChatHistory, saveMessage } = require("../controllers/chatController");
const { protect } = require("../middleware/auth");

router.get("/history", protect, getChatHistory);
router.post("/message", protect, saveMessage);

module.exports = router;
