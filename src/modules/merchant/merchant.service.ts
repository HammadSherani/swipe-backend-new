import { NotFoundError, BadRequestError } from '../../errors/custom-errors.js';
import { prisma } from '../../config/database.js';
import { PrismaClient, Prisma } from '../../generated/client/index.js';
import { monnifyService } from '../../services/monnify.service.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class MerchantService {

  /**
   * Creates the baseline (pending) merchant profile for a newly registered
   * MERCHANT-role user. Accepts an optional transaction client so callers
   * (e.g. auth registration) can create the User + Merchant row atomically
   * in one DB transaction instead of a cross-service call.
   */
  async initializeProfile(merchantId: string, userEmail: string, userMobile: string, db: DbClient = prisma) {
    const existing = await db.merchant.findUnique({
      where: { userId: merchantId }
    });

    if (existing) {
      return existing;
    }

    // Seeded from the already-verified User record — the gated KYC steps
    // (Phase 2) update businessName/ownerName/bank details progressively,
    // but email/mobile are already known-good from registration and never
    // get overwritten with a placeholder that'd break Monnify's
    // customerEmail requirement at the settlement-bank step.
    return await db.merchant.create({
      data: {
        userId: merchantId,
        businessName: "Pending Onboarding",
        businessType: "SOLE_PROPRIETORSHIP",
        ownerName: "Pending Onboarding",
        email: userEmail,
        mobile: userMobile,
        bankCode: "000",
        accountNumber: "0000000000",
        accountName: "Pending Verification",
        status: 'PENDING',
        kycStatus: 'PENDING',
        isActive: false
      }
    });
  }

  /**
   * 🏦 Get list of banks (for dropdown in frontend)
   */
  async getBanks() {
    return monnifyService.getBanks();
  }

  /**
   * 💰 Get merchant balance from Monnify
   */
  async getBalance(merchantId: string) {
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!merchant || !merchant.monnifyReference) {
      throw new BadRequestError('Merchant not found or not onboarded with Monnify');
    }

    return monnifyService.getReservedAccountBalance(merchant.monnifyReference);
  }

  async getByUserId(userId: string) {
    const include = { qrCodes: true, paymentLinks: true };
    let merchant = await prisma.merchant.findUnique({ where: { userId }, include });

    if (!merchant) {
      // Same self-heal as the KYC wizard: a verified MERCHANT user without a
      // Merchant row gets its baseline profile recreated.
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user && user.role === 'MERCHANT' && user.isVerified) {
        await this.initializeProfile(user.id, user.email, user.mobile);
        merchant = await prisma.merchant.findUnique({ where: { userId }, include });
      }
    }

    if (!merchant) throw new NotFoundError('Merchant not found');
    return merchant;
  }

  async updateNibssStatus(merchantId: string, nibssId: string, status: string) {
    const merchantStatus = status === 'APPROVED' ? 'ACTIVE' : 'REJECTED';

    const merchant = await prisma.merchant.update({
      where: { id: merchantId },
      data: {
        nibssId,
        status: merchantStatus,
      },
    });

    return merchant;
  }
}
