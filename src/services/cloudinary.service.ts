import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export class CloudinaryApiError extends Error {
  constructor(message: string, public raw?: unknown) {
    super(message);
    this.name = 'CloudinaryApiError';
  }
}

export class CloudinaryService {
  /**
   * Uploads a base64-encoded image (data URI prefix optional) to Cloudinary
   * and returns its hosted URL. Used for QR images and KYC document uploads
   * (e.g. proof-of-address) instead of embedding/storing base64 blobs.
   */
  async uploadBase64Image(base64Image: string, folder: string): Promise<string> {
    if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
      throw new CloudinaryApiError('Cloudinary credentials are not configured (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)');
    }

    const dataUri = base64Image.startsWith('data:')
      ? base64Image
      : `data:image/png;base64,${base64Image}`;

    try {
      const result = await cloudinary.uploader.upload(dataUri, { folder });
      return result.secure_url;
    } catch (error) {
      throw new CloudinaryApiError(
        error instanceof Error ? error.message : 'Cloudinary upload failed',
        error
      );
    }
  }
}

export const cloudinaryService = new CloudinaryService();
