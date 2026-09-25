import fp from 'fastify-plugin';
import { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../errors/custom-errors.js';
import { Prisma } from '../generated/client/index.js';

function isFastifyError(error: Error): error is FastifyError {
  return 'code' in error;
}

// Prisma throws with a multi-line message containing file paths and code
// snippets (great for server logs, never fit for an API response). Map its
// stable error codes to a clean, user-facing message instead.
function formatPrismaError(error: Prisma.PrismaClientKnownRequestError): { statusCode: number; code: string; message: string } {
  switch (error.code) {
    case 'P2002': {
      const target = error.meta?.target as string[] | string | undefined;
      const fields = Array.isArray(target) ? target.join(', ') : target ?? 'field';
      return { statusCode: 409, code: 'DUPLICATE_ENTRY', message: `${fields} already in use` };
    }
    case 'P2025':
      return { statusCode: 404, code: 'NOT_FOUND', message: 'Record not found' };
    case 'P2003': {
      const field = error.meta?.field_name as string | undefined;
      return { statusCode: 400, code: 'INVALID_REFERENCE', message: `Invalid reference${field ? ` for ${field}` : ''}` };
    }
    default:
      return { statusCode: 500, code: 'DATABASE_ERROR', message: 'A database error occurred' };
  }
}

// Zod's validatorCompiler hands Fastify the raw ZodError, whose own
// `.message` getter is `JSON.stringify(issues, null, 2)` — great for logs,
// unreadable in an API response. Extract the structured `issues`/`errors`
// array instead and format it as "field: message" pairs.
function formatZodValidationMessage(error: FastifyError): string {
  const issues = (error as unknown as { issues?: unknown; errors?: unknown }).issues
    ?? (error as unknown as { errors?: unknown }).errors;

  if (Array.isArray(issues)) {
    const formatted = issues
      .map((issue: { path?: unknown[]; message?: string }) => {
        const field = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : 'value';
        return `${field}: ${issue.message ?? 'Invalid value'}`;
      })
      .join(', ');
    if (formatted) return formatted;
  }

  return error.message || 'Validation failed';
}

export default fp(async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: FastifyError | AppError | Error, request: FastifyRequest, reply: FastifyReply) => {
    let statusCode = 500;
    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';

    if (error instanceof AppError) {
      statusCode = error.statusCode;
      message = error.message;
      code = error.code ?? error.constructor.name.replace('Error', '').toUpperCase();

      if (error.isOperational) {
        request.log.warn({ err: error }, error.message);
      } else {
        request.log.error({ err: error }, 'Unexpected error');
      }
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const formatted = formatPrismaError(error);
      statusCode = formatted.statusCode;
      code = formatted.code;
      message = formatted.message;
      request.log.warn({ err: error }, 'Database constraint error');
    } else if (isFastifyError(error) && error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      statusCode = 413;
      message = 'Uploaded file is too large. Please use a smaller image.';
      code = 'PAYLOAD_TOO_LARGE';
    } else if (isFastifyError(error) && error.code === 'FST_ERR_VALIDATION') {
      statusCode = 400;
      message = formatZodValidationMessage(error);
      code = 'VALIDATION_ERROR';
      request.log.warn({ err: error }, 'Validation failed');
    } else if (isFastifyError(error)) {
      if (error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
        statusCode = 401;
        message = 'No authorization header provided';
        code = 'UNAUTHORIZED';
      } else if (error.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
        statusCode = 401;
        message = 'Token expired';
        code = 'TOKEN_EXPIRED';
      } else if (error.code === 'FST_JWT_AUTHORIZATION_TOKEN_INVALID') {
        statusCode = 401;
        message = 'Invalid token';
        code = 'TOKEN_INVALID';
      } else {
        request.log.error({ err: error }, 'Fastify error');
        message = error.message || 'Internal server error';
      }
    } else {
      request.log.error({ err: error }, 'Unexpected error');
      if (process.env.NODE_ENV === 'production') {
        message = 'Something went wrong';
      } else {
        message = error.message || 'Internal server error';
      }
    }

    reply.status(statusCode).send({
      success: false,
      error: {
        code,
        message,
      },
      requestId: request.id,
    });
  });

  fastify.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    request.log.warn(`Route not found: ${request.method} ${request.url}`);
    reply.status(404).send({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
      },
      requestId: request.id,
    });
  });
});
