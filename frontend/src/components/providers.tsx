"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { isApiError } from "@/lib/api/errors";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (count, err) => !(isApiError(err) && err.status < 500) && count < 2,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: "!rounded-[3px] !bg-ink !text-paper !border-0 !font-sans !shadow-[0_12px_32px_-12px_rgba(11,43,48,0.45)]",
              description: "!text-paper/75",
              actionButton: "!bg-paper !text-ink !rounded-[3px]",
              cancelButton: "!bg-paper/10 !text-paper !rounded-[3px]",
            },
          }}
        />
      </MotionConfig>
    </QueryClientProvider>
  );
}
