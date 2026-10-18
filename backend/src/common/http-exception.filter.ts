import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

/** Domain error with a stable code and a user-facing action hint (Q10). */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = HttpStatus.UNPROCESSABLE_ENTITY,
    readonly action?: string,
  ) {
    super(message);
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof DomainError) {
      return reply.status(exception.status).send({
        code: exception.code,
        message: exception.message,
        action: exception.action,
      });
    }

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      return reply
        .status(exception.getStatus())
        .send(typeof body === 'string' ? { code: 'HTTP_ERROR', message: body } : body);
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Try again; if it keeps failing, contact an admin.',
    });
  }
}
