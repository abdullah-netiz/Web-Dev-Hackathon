"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "./api";
import type { Permission, Session } from "./api/types";

export const sessionKey = ["session"] as const;

export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: () => api().auth.me(),
    staleTime: 60_000,
    retry: false,
  });
}

/** Read the already-loaded session inside the authenticated app shell. */
export function useMe(): Session {
  const { data } = useSession();
  if (!data) throw new Error("useMe() used outside the authenticated shell");
  return data;
}

export function useCan() {
  const { data } = useSession();
  return useCallback((p: Permission) => !!data?.permissions.includes(p), [data]);
}

export function useSetSession() {
  const qc = useQueryClient();
  return useCallback(
    (s: Session | null) => {
      if (s) qc.setQueryData(sessionKey, s);
      else qc.clear();
    },
    [qc],
  );
}
