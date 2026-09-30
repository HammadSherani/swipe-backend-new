import { prisma } from '../../config/database.js';
import { NotFoundError, BadRequestError } from '../../errors/custom-errors.js';
import { Prisma } from '../../generated/client/index.js';
import { ReviewDecisionInput } from './admin.schema.js';
import { QrService } from '../qr/qr.service.js';

export class AdminService {
  async getDashboardStats() {
    const [byStatus, totalMerchants] = await Promise.all([
      prisma.merchant.groupBy({ by: ['status'], _count: true }),
      prisma.merchant.count(),
    ]);

    const countFor = (status: string) => byStatus.find((s) => s.status === status)?._count ?? 0;

    return {
      totalMerchants,
      pendingReview: countFor('PENDING_REVIEW'),
      active: countFor('ACTIVE'),
      rejected: countFor('REJECTED'),
      inProgress: countFor('PENDING') + countFor('VERIFIED') + countFor('IN_PROGRESS'),
    };
  }

  async listPendingReview() {
    return prisma.merchant.findMany({
      where: { status: 'PENDING_REVIEW' },
      include: { persons: true },
      orderBy: { updatedAt: 'asc' },
    });
  }

  async listMerchants() {
    return prisma.merchant.findMany({
      include: { persons: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getMerchantDetail(merchantId: string) {
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            mobile: true,
            role: true,
            kycStatus: true,
            isVerified: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        persons: {
          orderBy: { createdAt: 'asc' },
        },
        kycAuditLogs: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        qrCodes: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        paymentLinks: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        virtualAccounts: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!merchant) {
      throw new NotFoundError('Merchant not found');
    }

    return merchant;
  }

  /**
   * Final decision by a single admin — approve activates the merchant and
   * issues its QR; reject records the reason.
   */
  async decide(merchantId: string, data: ReviewDecisionInput, adminUserId: string) {
    const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) {
      throw new NotFoundError('Merchant not found');
    }

    if (merchant.status !== 'PENDING_REVIEW') {
      throw new BadRequestError('Merchant is not currently pending review', 'NOT_PENDING_REVIEW');
    }

    if (data.decision === 'REJECT') {
      const rejected = await prisma.merchant.update({
        where: { id: merchantId },
        data: {
          status: 'REJECTED',
          kycStatus: 'REJECTED',
          rejectionReason: data.rejectionReason,
          decidedByAdminId: adminUserId,
          decidedAt: new Date(),
        },
      });

      await prisma.kycAuditLog.create({
        data: {
          merchantId,
          step: 'ADMIN_DECISION',
          action: 'FAIL',
          result: 'REJECTED',
          metadata: { adminUserId, rejectionReason: data.rejectionReason } as Prisma.InputJsonValue,
        },
      });

      return { success: true, message: 'Merchant rejected', status: rejected.status };
    }

    const activeMerchant = await prisma.merchant.update({
      where: { id: merchantId },
      data: {
        status: 'ACTIVE',
        kycStatus: 'APPROVED',
        isActive: true,
        decidedByAdminId: adminUserId,
        decidedAt: new Date(),
      },
    });

    await prisma.user.update({ where: { id: merchant.userId }, data: { kycStatus: 'APPROVED' } });

    await prisma.kycAuditLog.create({
      data: {
        merchantId,
        step: 'ADMIN_DECISION',
        action: 'PASS',
        result: 'APPROVED',
        metadata: { adminUserId } as Prisma.InputJsonValue,
      },
    });

    const qr = await new QrService().generateStatic({ merchantId: activeMerchant.id });

    return { success: true, message: 'Merchant approved and activated', status: activeMerchant.status, qr };
  }

  async blockMerchant(merchantId: string, adminUserId: string) {
    const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) {
      throw new NotFoundError('Merchant not found');
    }

    if (merchant.status !== 'ACTIVE' || !merchant.isActive) {
      throw new BadRequestError('Merchant is not currently active', 'MERCHANT_NOT_ACTIVE');
    }

    const suspended = await prisma.merchant.update({
      where: { id: merchantId },
      data: { status: 'SUSPENDED', isActive: false },
    });

    await prisma.kycAuditLog.create({
      data: {
        merchantId,
        step: 'ADMIN_DECISION',
        action: 'SOFT_BLOCK',
        result: 'SUSPENDED',
        metadata: { adminUserId, decision: 'BLOCK' } as Prisma.InputJsonValue,
      },
    });

    return { success: true, message: 'Merchant blocked', status: suspended.status };
  }

  async deleteMerchant(merchantId: string) {
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, userId: true },
    });

    if (!merchant) {
      throw new NotFoundError('Merchant not found');
    }

    await prisma.$transaction(async (tx) => {
      // Merchant-owned records use onDelete: Cascade. Delete the merchant
      // first, then its account, so no orphaned login remains behind.
      await tx.merchant.delete({ where: { id: merchant.id } });
      await tx.user.delete({ where: { id: merchant.userId } });
    });

    return { success: true, message: 'Merchant deleted', merchantId: merchant.id };
  }
}

export const adminService = new AdminService();
