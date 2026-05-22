import express from "express";
import multer from "multer";
import { uploadImageToCloudinary } from "../Config/cloudinary.js";
import { authorizePermission } from "../middleware/auth.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post(
  "/image",
  authorizePermission("settings:update"),
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      const result = await uploadImageToCloudinary(req.file);
      return res.json({ imageUrl: result.secure_url });
    } catch (err) {
      console.error("upload image error:", err);
      return res.status(500).json({ message: err.message || "Upload failed" });
    }
  },
);

export default router;
