import type { Api } from "./contract";
import { createHttpApi } from "./http";
import { createMockApi } from "./mock";

export const API_MODE: "mock" | "live" = process.env.NEXT_PUBLIC_API_MODE === "live" ? "live" : "mock";

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
