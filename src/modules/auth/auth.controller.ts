import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { InitiateRegisterInput, VerifyOtpInput, ResendOtpInput, LoginInput, RefreshTokenInput, ForgotPasswordInput, ResetPasswordInput, ChangePasswordInput } from './auth.schema.js';
import { UnauthorizedError } from '../../errors/custom-errors.js';

export async function initiateRegisterHandler(
  request: FastifyRequest<{ Body: InitiateRegisterInput }>,
  reply: FastifyReply
) {
  const authService = new AuthService(request.server);
  const result = await authService.initiateRegistration(request.body);
  return reply.status(200).send({ success: true, data: result });
}

export async function verifyOtpsHandler(
  request: FastifyRequest<{ Body: VerifyOtpInput }>,
  reply: FastifyReply
) {
  const authService = new AuthService(request.server);
  const result = await authService.verifyOtpsAndRegister(request.body);
  return reply.status(201).send({ success: true, data: result });
}

export async function resendOtpHandler(
  request: FastifyRequest<{ Body: ResendOtpInput }>,
  reply: FastifyReply
) {
  const authService = new AuthService(request.server);

  const result = await authService.resendOtp({
    email: request.body.email,
    mobile: request.body.mobile,
  });

  return reply.status(200).send({
    success: true,
    data: result,
  });
}

export async function loginHandler(
  request: FastifyRequest<{ Body: LoginInput }>,
  reply: FastifyReply
) {
  const authService = new AuthService(request.server);
  const result = await authService.login(request.body);
  return reply.status(200).send({ success: true, data: result });
}

export async function refreshTokenHandler(
  request: FastifyRequest<{ Body: RefreshTokenInput }>,
  reply: FastifyReply
) {
  const authService = new AuthService(request.server);
  const result = await authService.refreshToken(request.body.refreshToken);
  return reply.status(200).send({ success: true, data: result });
}

export async function logoutHandler(
  request: FastifyRequest<{ Body: { refreshToken: string } }>,
  reply: FastifyReply
) {
  const user = request.user as { userId: string };
  const userId = user.userId;

  if (!userId) throw new UnauthorizedError('Unauthorized');

  const authService = new AuthService(request.server);
  const result = await authService.logout(userId, request.body.refreshToken);
  return reply.status(200).send({ success: true, data: result });
}


export async function forgotPasswordHandler(
  request: FastifyRequest<{ Body: ForgotPasswordInput }>,
  reply: FastifyReply
) {
  const authService = new AuthService(request.server);
  const result = await authService.forgotPassword(request.body);
  return reply.status(200).send({ success: true, data: result });
}

export async function resetPasswordHandler(
  request: FastifyRequest<{ Body: ResetPasswordInput }>,
  reply: FastifyReply
) {
  const authService = new AuthService(request.server);
  const result = await authService.resetPassword(request.body);
  return reply.status(200).send({ success: true, data: result });
}

export async function changePasswordHandler(
  request: FastifyRequest<{ Body: ChangePasswordInput }>,
  reply: FastifyReply
) {
  const user = request.user as { userId: string };
  const userId = user.userId;

  if (!userId) throw new UnauthorizedError('Unauthorized');

  const authService = new AuthService(request.server);
  const result = await authService.changePassword(userId, request.body);
  return reply.status(200).send({ success: true, data: result });
}
