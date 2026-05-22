import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadImageToCloudinary = async (file) => {
  if (!file || !file.buffer) {
    throw new Error("Invalid file: Missing buffer or file content");
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { resource_type: "image" },
        (error, result) => {
          if (error) {
            reject(new Error(`Cloudinary Error: ${error.message}`));
          } else {
            resolve(result);
          }
        }
      );

      uploadStream.end(file.buffer);
    });

    if (process.env.DEBUG === "true") {
      console.log("Uploaded Image URL:", result.secure_url);
    }

    return result; // Return full result object with public_id
  } catch (error) {
    throw new Error(`Error uploading image to Cloudinary: ${error.message}`);
  }
};

export const deleteImageFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);

    if (process.env.DEBUG === "true") {
      console.log("Deleted Image Public ID:", publicId, "Result:", result);
    }

    return result;
  } catch (error) {
    throw new Error(`Error deleting image from Cloudinary: ${error.message}`);
  }
};
