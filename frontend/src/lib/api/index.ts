import type { Api } from "./contract";
import { createHttpApi } from "./http";
import { createMockApi } from "./mock";

/** Live by default; `NEXT_PUBLIC_API_MODE=mock` runs the in-browser demo backend (no real providers). */
export const API_MODE: "mock" | "live" = process.env.NEXT_PUBLIC_API_MODE === "mock" ? "mock" : "live";

let instance: Api | null = null;

export function api(): Api {
  if (!instance) {
    instance = API_MODE === "live" ? createHttpApi(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000") : createMockApi();
  }
  return instance;
}

export type { Api } from "./contract";
export * from "./types";
export { ApiError, describeError, isApiError } from "./errors";
