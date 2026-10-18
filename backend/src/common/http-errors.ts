import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/** A missing record — or one belonging to another workspace — is always a 404 (F1.6, Q2). */
export function notFound(what = 'record'): NotFoundException {
  return new NotFoundException({
    code: 'not_found',
    message: `That ${what} was not found.`,
    action: 'It may have been removed, or it belongs to another workspace.',
  });
}

/** Optimistic-concurrency mismatch: the row changed since the client loaded it (Q4). */
export function versionConflict(): ConflictException {
  return new ConflictException({
    code: 'conflict',
    message: 'This record was changed by someone else since you loaded it.',
    action: 'Reload the record and re-apply your change.',
  });
}

export function businessRule(message: string, action: string): ConflictException {
  return new ConflictException({ code: 'conflict', message, action });
}

/** Input that is well-formed but violates a field rule, e.g. a dropdown with no options (Q3). */
export function invalidRequest(message: string, action: string): BadRequestException {
  return new BadRequestException({ code: 'validation_error', message, action });
}
