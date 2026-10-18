import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

interface ErrorBody {
  code: string;
  message: string;
  action?: string;
  details?: unknown;
}

interface ReplyLike {
  status(code: number): { send(body: unknown): void };
}

const STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  422: 'unprocessable_entity',
  429: 'too_many_requests',
  500: 'internal_error',
  503: 'unavailable',
};

const STATUS_ACTIONS: Record<number, string> = {
  400: 'Check the values you submitted and try again.',
  401: 'Sign in again to continue.',
  403: 'Ask an administrator for access to this.',
  404: 'It may have been removed, or it belongs to another workspace.',
  409: 'Reload the record and re-apply your change.',
  429: 'Slow down and try again in a moment.',
  500: 'Try again in a moment; if it keeps failing, contact support.',
  503: 'The service is starting up or temporarily unavailable. Try again shortly.',
};

function codeForStatus(status: number): string {
  return STATUS_CODES[status] ?? (status >= 500 ? 'internal_error' : 'error');
}

/**
 * Single error boundary for the whole API: every failure leaves as
 * `{ code, message, action?, details? }` (Q10), and unexpected errors are logged.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<ReplyLike>();
    const { status, body } = this.normalize(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    reply.status(status).send(body);
  }

  private normalize(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return { status: this.statusForPrisma(exception.code), body: this.bodyForPrisma(exception) };
    }
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: 400,
        body: {
          code: 'bad_request',
          message: 'The request could not be processed.',
          action: 'Review the submitted values and try again.',
        },
      };
    }
    if (exception instanceof Prisma.PrismaClientInitializationError) {
      return {
        status: 503,
        body: {
          code: 'unavailable',
          message: 'The database is not reachable right now.',
          action: 'Try again in a moment.',
        },
      };
    }
    if (exception instanceof HttpException) {
      return { status: exception.getStatus(), body: this.bodyForHttp(exception) };
    }
    return {
      status: 500,
      body: {
        code: 'internal_error',
        message: 'Something went wrong on our side.',
        action: 'Try again in a moment; if it keeps failing, contact support.',
      },
    };
  }

  private statusForPrisma(code: string): number {
    switch (code) {
      case 'P2002':
      case 'P2003':
      case 'P2014':
        return 409;
      case 'P2025':
        return 404;
      default:
        return 400;
    }
  }

  private bodyForPrisma(exception: Prisma.PrismaClientKnownRequestError): ErrorBody {
    switch (exception.code) {
      case 'P2002':
        return {
          code: 'conflict',
          message: 'A record with those values already exists.',
          action: 'Remove the duplicate value and try again.',
        };
      case 'P2003':
        return {
          code: 'conflict',
          message: 'This record is still referenced by other data.',
          action: 'Remove or reassign the related records first.',
        };
      case 'P2025':
        return {
          code: 'not_found',
          message: 'The record was not found.',
          action: 'Reload the page and try again.',
        };
      default:
        return {
          code: 'database_error',
          message: 'The request could not be saved because it conflicts with existing data.',
          action: 'Check the values you submitted and try again.',
        };
    }
  }

  private bodyForHttp(exception: HttpException): ErrorBody {
    const status = exception.getStatus();
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return { code: codeForStatus(status), message: response, action: STATUS_ACTIONS[status] };
    }

    const obj = response as Record<string, unknown>;
    const message = Array.isArray(obj.message) ? obj.message.join('; ') : obj.message;

    return {
      code: typeof obj.code === 'string' ? obj.code : codeForStatus(status),
      message: typeof message === 'string' && message.length > 0 ? message : exception.message,
      action: typeof obj.action === 'string' ? obj.action : STATUS_ACTIONS[status],
      details: obj.details,
    };
  }
}
