const { AppError } = require("./errorHandler");

exports.isAdmin = (req, res, next) => {
  // Allow if role is admin OR if email matches ADMIN_EMAIL from .env
  if (req.user && (req.user.role === "admin" || req.user.email === process.env.ADMIN_EMAIL)) {
    next();
  } else {
    next(new AppError("Access denied. Admin only area.", 403));
  }
};
