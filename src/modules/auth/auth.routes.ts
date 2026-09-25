// File: apps/backend/src/modules/auth/auth.routes.ts

import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  initiateRegisterHandler,
  verifyOtpsHandler,
  resendOtpHandler,
  loginHandler,
  refreshTokenHandler,
  logoutHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
  changePasswordHandler
} from './auth.controller.js';
import {
  initiateRegisterSchema,
  verifyOtpSchema,
  resendOtpSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
  changePasswordSchema,
} from './auth.schema.js';

export async function authRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // ========== PUBLIC ROUTES ==========

  app.post('/register/initiate', {
    schema: { tags: ['Auth'], description: 'Step 1: Enter details, OTPs sent', body: initiateRegisterSchema },
    handler: initiateRegisterHandler,
  });

  app.post('/register/verify', {
    schema: { tags: ['Auth'], description: 'Step 2: Verify OTPs', body: verifyOtpSchema },
    handler: verifyOtpsHandler,
  });

  app.post('/register/resend-otp', {
    schema: { tags: ['Auth'], description: 'Resend both email + mobile OTP', body: resendOtpSchema },
    handler: resendOtpHandler,
  });

  app.post('/login', {
    schema: { tags: ['Auth'], description: 'Login', body: loginSchema },
    handler: loginHandler,
  });

  app.post('/forgot-password', {
    schema: { tags: ['Auth'], description: 'Forgot password', body: forgotPasswordSchema },
    handler: forgotPasswordHandler,
  });

  app.post('/reset-password', {
    schema: { tags: ['Auth'], description: 'Reset password', body: resetPasswordSchema },
    handler: resetPasswordHandler,
  });

  app.post('/refresh', {
    schema: { tags: ['Auth'], description: 'Refresh token', body: refreshTokenSchema },
    handler: refreshTokenHandler,
  });

  // ========== PROTECTED ROUTES ==========

  app.post('/logout', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['Auth'], description: 'Logout' },
    handler: logoutHandler,
  });

  app.post('/change-password', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['Auth'], description: 'Change password', body: changePasswordSchema },
    handler: changePasswordHandler,
  });

  app.get('/verify', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['Auth'], description: 'Verify current token' },
    handler: async (request, reply) => {
      const user = request.user;
      return reply.send({
        success: true,
        data: { userId: user.userId, role: user.role, kycStatus: user.kycStatus },
      });
    },
  });

  app.get('/me', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['Auth'], description: 'Get current user' },
    handler: async (request, reply) => {
      const user = request.user;
      return reply.send({
        success: true,
        data: { userId: user.userId, role: user.role },
      });
    },
  });
}
