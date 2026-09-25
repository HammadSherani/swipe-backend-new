import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

export default fp(async function jwtPlugin(fastify: FastifyInstance) {
  // @fastify/jwt bundles its own (older) fastify-plugin version internally,
  // which TS sees as structurally distinct from the one this repo installs
  // directly — a known cross-package type-only friction, not a runtime issue.
  await fastify.register(jwt as any, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();

      // Access and refresh tokens are signed with the same secret and differ
      // only by this `type` claim — without checking it, a leaked refresh
      // token (7d life) could be used directly as an access token on any
      // protected route, defeating the access token's short 15m expiry.
      if (request.user.type !== 'access') {
        throw new Error('Not an access token');
      }
    } catch (err) {
      reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
        },
      });
    }
  });

  // Chained after `authenticate` on admin-only routes — role check only
  // makes sense once the token itself is already known to be a valid access token.
  fastify.decorate('requireAdmin', async function (request: FastifyRequest, reply: FastifyReply) {
    if (request.user.role !== 'ADMIN') {
      reply.status(403).send({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Admin access required',
        },
      });
    }
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
