import { prisma } from '../../config/database.js';
import QRCode from 'qrcode';
import { GenerateStaticQrInput, GenerateDynamicQrInput, DecodeQrInput } from './qr.schema.js';
import { BadRequestError, NotFoundError } from '../../errors/custom-errors.js';
import { cloudinaryService } from '../../services/cloudinary.service.js';

export class QrService {

  // Generate NIBSS format raw string
  private generateNibssString(merchantId: string, amount?: number, reference?: string): string {
    const data = [
      '000201', // Payload format indicator
      '010212', // Point of initiation (static/dynamic)
      `15${merchantId.length.toString().padStart(2, '0')}${merchantId}`, // Merchant ID
      amount ? `54${amount.toFixed(2).length.toString().padStart(2, '0')}${amount.toFixed(2)}` : '', // Transaction amount
      reference ? `31${reference.length.toString().padStart(2, '0')}${reference}` : '', // Reference
      '6304', // CRC placeholder
    ].join('');

    return data;
  }

  // Generate Static QR (permanent)
  async generateStatic(data: GenerateStaticQrInput) {
    // Check existing
    const existing = await prisma.qrCode.findFirst({
      where: { merchantId: data.merchantId, type: 'STATIC', isActive: true },
    });

    if (existing) {
      return {
        qrId: existing.id,
        reference: existing.reference,
        imageUrl: existing.imageUrl,
        message: 'Static QR already exists',
      };
    }

    const reference = `STAT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const rawData = this.generateNibssString(data.merchantId);

    // Generate QR image and host it on Cloudinary rather than storing/
    // returning a raw base64 blob.
    const qrImage = await QRCode.toDataURL(rawData);
    const imageUrl = await cloudinaryService.uploadBase64Image(qrImage, 'qr-codes');

    const qr = await prisma.qrCode.create({
      data: {
        merchantId: data.merchantId,
        type: 'STATIC',
        rawData,
        imageUrl,
        reference,
      },
    });

    return {
      qrId: qr.id,
      reference: qr.reference,
      imageUrl: qr.imageUrl,
      rawData: qr.rawData,
    };
  }

  // Generate Dynamic QR (per transaction)
  async generateDynamic(data: GenerateDynamicQrInput) {
    const reference = `DYN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const rawData = this.generateNibssString(data.merchantId, data.amount, reference);

    // Generate QR image and host it on Cloudinary rather than storing/
    // returning a raw base64 blob.
    const qrImage = await QRCode.toDataURL(rawData);
    const imageUrl = await cloudinaryService.uploadBase64Image(qrImage, 'qr-codes');

    // Expires in 15 minutes
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const qr = await prisma.qrCode.create({
      data: {
        merchantId: data.merchantId,
        type: 'DYNAMIC',
        rawData,
        imageUrl,
        amount: data.amount,
        reference,
        expiresAt,
      },
    });

    return {
      qrId: qr.id,
      reference: qr.reference,
      amount: data.amount,
      imageUrl: qr.imageUrl,
      rawData: qr.rawData,
      expiresAt,
    };
  }

  // Decode and validate QR
  async decode(data: DecodeQrInput) {
    // Parse NIBSS format
    const rawData = data.rawData;

    // Extract merchant ID
    const merchantIdMatch = rawData.match(/15\d{2}(.+?)(?=54|31|6304|$)/);
    const merchantId = merchantIdMatch ? merchantIdMatch[1] : null;

    // Extract amount
    const amountMatch = rawData.match(/54\d{2}(.+?)(?=31|6304|$)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

    // Extract reference
    const referenceMatch = rawData.match(/31\d{2}(.+?)(?=6304|$)/);
    const reference = referenceMatch ? referenceMatch[1] : null;

    // Find in database
    const qr = await prisma.qrCode.findUnique({
      where: { reference: reference || '' },
    });

    if (!qr) throw new NotFoundError('QR code not found');

    // Check expiry for dynamic
    if (qr.type === 'DYNAMIC' && qr.expiresAt && qr.expiresAt < new Date()) {
      throw new BadRequestError('QR code expired');
    }

    if (!qr.isActive) {
      throw new BadRequestError('QR code inactive');
    }

    return {
      valid: true,
      type: qr.type,
      merchantId: qr.merchantId,
      amount: qr.amount,
      reference: qr.reference,
    };
  }

  // Get merchant QR codes
  async getByMerchant(merchantId: string) {
    const qrCodes = await prisma.qrCode.findMany({
      where: { merchantId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    return qrCodes;
  }

  // Deactivate QR
  async deactivate(qrId: string) {
    await prisma.qrCode.update({
      where: { id: qrId },
      data: { isActive: false },
    });

    return { message: 'QR deactivated' };
  }
}
