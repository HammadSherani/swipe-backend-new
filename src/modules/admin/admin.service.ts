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
}

export const adminService = new AdminService();
