"use client";

import { useMutation } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api, describeError } from "@/lib/api";
import { useSetSession } from "@/lib/session";
import { AuthFrame } from "@/components/brand/auth-frame";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const setSession = useSetSession();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const weak = password.length > 0 && (password.length < 10 || !/\d/.test(password));
  const m = useMutation({
    mutationFn: () => api().auth.acceptInvite(token, { name, password }),
    onSuccess: (s) => {
      setSession(s);
      router.replace("/settings/profile");
    },
  });
  const err = m.error ? describeError(m.error) : null;
  return (
    <AuthFrame title="Join your team." intro="Set your name and a password. Then connect your calendar and Slack so leads and alerts can reach you.">
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!weak && name.trim()) m.mutate();
        }}
      >
        <Field label="Your name" required>{(p) => <Input {...p} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Password" hint="At least 10 characters with a number." error={weak ? "Use at least 10 characters, including a number." : undefined} required>
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        {err && (
          <div role="alert" className="rounded-[3px] bg-signal-tint px-4 py-3 text-sm">
            <p className="font-semibold text-signal">{err.title}</p>
            {err.action && <p className="text-ink">{err.action}</p>}
          </div>
        )}
        <Button type="submit" size="lg" loading={m.isPending} disabled={weak || !name.trim() || !password} className="w-full justify-center">
          Join workspace
        </Button>
      </form>
    </AuthFrame>
  );
}
