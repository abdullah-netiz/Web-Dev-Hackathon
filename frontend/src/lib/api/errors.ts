import type { ApiErrorBody } from "./types";

export class ApiError extends Error implements ApiErrorBody {
  readonly status: number;
  readonly code: string;
  readonly action?: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.action = body.action;
    this.details = body.details;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function describeError(e: unknown): { title: string; action?: string } {
  if (isApiError(e)) return { title: e.message, action: e.action };
  if (e instanceof TypeError) {
    return { title: "Couldn't reach the server.", action: "Check your connection and try again." };
  }
  return { title: "Something went wrong.", action: "Try again. If it keeps happening, reload the page." };
}
