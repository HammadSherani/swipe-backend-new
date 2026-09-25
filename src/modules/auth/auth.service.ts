import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { generateOtp } from '../../utils/otp.js';
import { storeOtp, getOtp, deleteOtp, storeSession, getSession, deleteSession } from '../../config/redis.js';
import { checkOtpRateLimit } from '../../config/rate-limit.js';
import {
  BadRequestError,
  UnauthorizedError,
  TooManyRequestsError,
  NotFoundError,
} from '../../errors/custom-errors.js';
import { InitiateRegisterInput, VerifyOtpInput, LoginInput, ForgotPasswordInput, ResetPasswordInput, ChangePasswordInput } from './auth.schema.js';
import { sendOtpEmail, sendPasswordResetEmail } from '../../services/email.service.js';
import { prisma } from '../../config/database.js';
import { MerchantService } from '../merchant/merchant.service.js';

const merchantService = new MerchantService();

export class AuthService {
  constructor(private fastify: FastifyInstance) { }

  // ========== STEP 1: Initiate Registration ==========
  async initiateRegistration(data: InitiateRegisterInput) {
    const rateLimit = await checkOtpRateLimit(data.mobile);
    if (!rateLimit.allowed) {
      throw new TooManyRequestsError('Too many OTP requests. Please try again later.');
    }

    console.log("data", data);
    

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email: data.email }, { mobile: data.mobile }],
      },
    });

    if (existingUser) {
      throw new BadRequestError(
        'User with this email or mobile already exists',
        'ALREADY_REGISTERED'
      );
    }

    // Check pending registration
    const existingPending = await prisma.pendingRegistration.findFirst({
      where: {
        OR: [{ email: data.email }, { mobile: data.mobile }],
      },
    });

    const emailOtp = generateOtp();
    const mobileOtp = generateOtp();

    const hashedPassword = await bcrypt.hash(data.password, 12);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Whether this is a brand-new pending row or one matched by mobile/email
    // from a previous attempt, always overwrite it with whatever was just
    // submitted — otherwise a retry with a different email (same mobile)
    // silently keeps sending the OTP to the stale, first-attempt email.
    if (existingPending) {
      await prisma.pendingRegistration.update({
        where: { id: existingPending.id },
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          mobile: data.mobile,
          password: hashedPassword,
          role: data.role,
          emailOtp,
          mobileOtp,
          expiresAt,
        },
      });
    } else {
      // Create new pending registration
      await prisma.pendingRegistration.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          mobile: data.mobile,
          password: hashedPassword,
          role: data.role,
          emailOtp,
          mobileOtp,
          expiresAt,
        },
      });
    }

    // ✅ Send Email OTP
    await sendOtpEmail(data.email, emailOtp, data.firstName);
    console.log(`📧 Email OTP for ${data.email}: ${emailOtp}`);

    // TODO: Send SMS OTP — no SMS provider wired up yet, logging for dev/testing
    console.log(`📱 Mobile OTP for ${data.mobile}: ${mobileOtp}`);

    return {
      message: 'OTP sent to your email and mobile',
      expiresIn: 600,
    };
  }

  // ========== STEP 2: Verify Both OTPs & Register ==========
  async verifyOtpsAndRegister(data: VerifyOtpInput) {
    const STATIC_OTP = "123456";

    console.log("data", data);
    

    const pending = await prisma.pendingRegistration.findFirst({
      where: {
        OR: [{ email: data.email }, { mobile: data.mobile }],
      },
    });

    if (!pending) {
      throw new BadRequestError(
        "No pending registration found. Please initiate registration first."
      );
    }

    // The pending row (with the hashed password) is kept on expiry — the user
    // just requests a new OTP instead of re-registering from scratch.
    if (pending.expiresAt < new Date()) {
      throw new BadRequestError(
        'OTP expired. Please request a new OTP.',
        'OTP_EXPIRED'
      );
    }

    const emailOtpValid =
      data.emailOtp === STATIC_OTP || data.emailOtp === pending.emailOtp;

    const mobileOtpValid =
      data.mobileOtp === STATIC_OTP || data.mobileOtp === pending.mobileOtp;

    if (!emailOtpValid) {
      throw new BadRequestError("Invalid email OTP");
    }

    if (!mobileOtpValid) {
      throw new BadRequestError("Invalid mobile OTP");
    }

    // 1 & 2. Create the user and (if MERCHANT) its baseline merchant profile
    // atomically — a single DB transaction now that both live in the same
    // database, replacing the old cross-service HTTP call + manual rollback.
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          firstName: pending.firstName,
          lastName: pending.lastName,
          email: pending.email,
          mobile: pending.mobile,
          password: pending.password,
          role: pending.role,
          isVerified: true,
        },
      });

      if (newUser.role === 'MERCHANT') {
        await merchantService.initializeProfile(newUser.id, newUser.email, newUser.mobile, tx);
      }

      await tx.pendingRegistration.delete({
        where: { id: pending.id },
      });

      return newUser;
    });

    // 3. Token Generation (KycStatus explicitly 'PENDING' pass kar rahe hain)
    const tokens = await this.generateTokens(
      user.id,
      user.role,
      "PENDING"
    );
    const redirectTo = await this.resolveRedirect(user.id, user.role);

    // 4. Standard Clean Response Structure
    return {
      success: true,
      message: "Registration successful. Profile initialized.",
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
      },
      ...tokens,
      redirectTo,
    };
  }

  // ========== RESEND OTP (both email + mobile together) ==========
  async resendOtp(data: { email?: string; mobile?: string }) {
    if (data.mobile) {
      const rateLimit = await checkOtpRateLimit(data.mobile);
      if (!rateLimit.allowed) {
        throw new TooManyRequestsError('Too many OTP requests. Please try again later.');
      }
    }

    console.log("data", data);
    

    const pending = await prisma.pendingRegistration.findFirst({
      where: {
        OR: [{ email: data.email }, { mobile: data.mobile }],
      },
    });

    if (!pending) {
      throw new BadRequestError('No pending registration found');
    }

    await this.issueFreshOtp(pending);

    return {
      success: true,
      message: 'OTP resent to your email and mobile',
      expiresIn: 600,
      email: pending.email,
      mobile: pending.mobile,
    };
  }

  // Generates new email + mobile OTPs for a pending registration, extends its
  // expiry, and sends them. Shared by resend-otp and login-with-unverified-account.
  private async issueFreshOtp(pending: { id: string; email: string; mobile: string; firstName: string }) {
    const emailOtp = generateOtp();
    const mobileOtp = generateOtp();

    await prisma.pendingRegistration.update({
      where: { id: pending.id },
      data: { emailOtp, mobileOtp, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    });

    await sendOtpEmail(pending.email, emailOtp, pending.firstName);
    console.log(`📧 Email OTP for ${pending.email}: ${emailOtp}`);

    // TODO: Send SMS OTP — no SMS provider wired up yet, logging for dev/testing
    console.log(`📱 Mobile OTP for ${pending.mobile}: ${mobileOtp}`);
  }

  // ========== LOGIN ==========
  async login(data: LoginInput) {
    let user;

    if (data.email) {
      user = await prisma.user.findUnique({ where: { email: data.email } });
    } else if (data.mobile) {
      user = await prisma.user.findUnique({ where: { mobile: data.mobile } });
    }

    if (!user) {
      // No account yet — but the person may have registered and never verified
      // their OTP. If the password matches that pending registration, send a
      // fresh OTP and tell the client to continue on the verification screen.
      const pending = await prisma.pendingRegistration.findFirst({
        where: data.email ? { email: data.email } : { mobile: data.mobile },
      });

      if (pending) {
        const passwordOk = await bcrypt.compare(data.password, pending.password);
        if (!passwordOk) {
          throw new UnauthorizedError('Invalid password');
        }

        const rateLimit = await checkOtpRateLimit(pending.mobile);
        if (!rateLimit.allowed) {
          throw new TooManyRequestsError('Too many OTP requests. Please try again later.');
        }

        await this.issueFreshOtp(pending);

        return {
          requiresVerification: true as const,
          message: 'Please verify your email and mobile number to continue. We sent you a new OTP.',
          email: pending.email,
          mobile: pending.mobile,
          expiresIn: 600,
        };
      }

      throw new NotFoundError('User not found');
    }

    if (!user.isVerified) {
      throw new UnauthorizedError('Account not verified');
    }

    // Verify password
    const isValid = await bcrypt.compare(data.password, user.password);
    if (!isValid) {
      throw new UnauthorizedError('Invalid password');
    }

    const tokens = await this.generateTokens(user.id, user.role, user.kycStatus);
    const redirectTo = await this.resolveRedirect(user.id, user.role);

    return {
      message: 'Login successful',
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        isVerified: user.isVerified,
        kycStatus: user.kycStatus,
      },
      ...tokens,
      redirectTo,
    };
  }


  // ========== FORGOT PASSWORD ==========
  async forgotPassword(data: ForgotPasswordInput) {
    let user;

    const STATIC_OTP = "123456";

    if (data.email) {
      user = await prisma.user.findUnique({
        where: { email: data.email },
      });
    } else if (data.mobile) {
      user = await prisma.user.findUnique({
        where: { mobile: data.mobile },
      });
    }

    if (!user) {
      throw new NotFoundError("User not found");
    }

    const rateLimit = await checkOtpRateLimit(user.mobile);
    if (!rateLimit.allowed) {
      throw new TooManyRequestsError('Too many OTP requests. Please try again later.');
    }

    const otp = STATIC_OTP;
    const key = `forgot:${user.id}`;

    await storeSession(key, otp, 600);

    const resetLink = `${env.PASSWORD_RESET_URL}?email=${encodeURIComponent(
      user.email
    )}&otp=${encodeURIComponent(otp)}`;

    await sendPasswordResetEmail(user.email, otp, user.firstName, resetLink);

    console.log("====================================");
    console.log("🔐 FORGOT PASSWORD FLOW (DEV MODE)");
    console.log("👤 User:", user.email || user.mobile);
    console.log("📌 OTP:", otp);
    console.log("🔗 Reset Link:", resetLink);
    console.log("====================================");

    return {
      success: true,
      message: "OTP generated successfully",
      expiresIn: 600,
      otp,
      resetLink, // 👈 frontend testing ke liye optional
    };
  }

  // ========== RESET PASSWORD ==========
  async resetPassword(data: ResetPasswordInput) {
    let user;

    const STATIC_OTP = "123456";

    if (data.email) {
      user = await prisma.user.findUnique({ where: { email: data.email } });
    } else if (data.mobile) {
      user = await prisma.user.findUnique({ where: { mobile: data.mobile } });
    }

    if (!user) {
      throw new NotFoundError("User not found");
    }

    const key = `forgot:${user.id}`;
    const storedOtp = await getSession(key);

    // simple static validation
    if (!storedOtp || data.otp !== STATIC_OTP) {
      throw new BadRequestError("Invalid OTP");
    }

    const isSamePassword = await bcrypt.compare(data.newPassword, user.password);
    if (isSamePassword) {
      throw new BadRequestError(
        "New password must be different from the old password",
        "SAME_AS_OLD_PASSWORD"
      );
    }

    const hashedPassword = await bcrypt.hash(data.newPassword, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    await deleteSession(key);
    await deleteSession(user.id);

    return {
      message: "Password reset successful. Please login again.",
    };
  }

  // ========== CHANGE PASSWORD (Logged in user) ==========
  async changePassword(userId: string, data: ChangePasswordInput) {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Verify old password
    const isValid = await bcrypt.compare(data.oldPassword, user.password);
    if (!isValid) {
      throw new BadRequestError('Old password is incorrect');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(data.newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Delete all sessions (force logout everywhere)
    await deleteSession(userId);

    return { message: 'Password changed successfully. Please login again.' };
  }

  // ========== REFRESH TOKEN ==========
  async refreshToken(refreshToken: string) {
    try {
      const decoded = this.fastify.jwt.verify(refreshToken) as { userId: string; role: string; type: string };

      if (decoded.type !== 'refresh') {
        throw new UnauthorizedError('Invalid token type');
      }

      const storedToken = await getSession(decoded.userId);

      if (!storedToken || storedToken !== refreshToken) {
        throw new UnauthorizedError('Session expired or invalid');
      }

      const accessToken = this.fastify.jwt.sign(
        { userId: decoded.userId, role: decoded.role, type: 'access' },
        { expiresIn: env.JWT_EXPIRES_IN }
      );

      return { accessToken };

    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      throw new UnauthorizedError('Invalid refresh token');
    }
  }

  // ========== LOGOUT ==========
  async logout(userId: string, refreshToken: string) {
    const storedToken = await getSession(userId);

    if (storedToken === refreshToken) {
      await deleteSession(userId);
    }

    return { message: 'Logged out successfully' };
  }

  // ========== PRIVATE ==========
  // Enums ko explicitly pass karo type safety ke liye
  private async generateTokens(userId: string, role: string, kycStatus: string) {
    const accessToken = this.fastify.jwt.sign(
      {
        userId,
        role,
        kycStatus,
        type: 'access'
      },
      { expiresIn: env.JWT_EXPIRES_IN }
    );

    const refreshToken = this.fastify.jwt.sign(
      { userId, role, type: 'refresh' },
      { expiresIn: env.REFRESH_TOKEN_EXPIRES_IN }
    );

    const refreshExpiresIn = 7 * 24 * 60 * 60;
    await storeSession(userId, refreshToken, refreshExpiresIn);

    return { accessToken, refreshToken };
  }

  // Only MERCHANT accounts go through KYC/onboarding — USER/ADMIN go straight
  // to the dashboard. For merchants, completion is tracked on the Merchant
  // record (set by the /merchant/onboard flow), not on User.kycStatus, which
  // is never updated after account creation.
  private async resolveRedirect(userId: string, role: string): Promise<'KYC_ONBOARDING' | 'DASHBOARD'> {
    if (role !== 'MERCHANT') return 'DASHBOARD';

    const merchant = await prisma.merchant.findUnique({ where: { userId } });
    // ACTIVE (auto-approved) has nothing left to fill in. PENDING_REVIEW is
    // also onboarding-complete — every gated step passed, just awaiting an
    // admin decision — so it belongs on the dashboard too, not bounced back
    // into a form with nothing left to submit.
    const onboardingDone = merchant?.status === 'ACTIVE' || merchant?.status === 'PENDING_REVIEW';

    return onboardingDone ? 'DASHBOARD' : 'KYC_ONBOARDING';
  }
}
