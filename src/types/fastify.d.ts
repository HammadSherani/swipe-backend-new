// @fastify/jwt's own types expose `request.user` typed as `FastifyJWT['user']` —
// augmenting `@fastify/jwt` (not `fastify`) is the correct extension point,
// otherwise `request.user` stays typed as the raw jwt.verify() return value.
// (needs an `export {}` so TS treats this file as a module, not a global
// script — otherwise the augmentation below silently fails to merge)
export {};

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      userId: string;
      role: string;
      kycStatus?: string;
      type: string;
    };
    user: {
      userId: string;
      role: string;
      kycStatus?: string;
      type: string;
      iat: number;
      exp: number;
    };
  }
}
