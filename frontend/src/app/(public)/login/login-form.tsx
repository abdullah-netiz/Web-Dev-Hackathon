"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { API_MODE, api, describeError } from "@/lib/api";
import { useSetSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

const schema = z.object({
  email: z.email("Enter the email you signed up with."),
  password: z.string().min(1, "Enter your password."),
});
type Values = z.infer<typeof schema>;

const DEMO = [
  { email: "amina@northwind.test", who: "Amina", role: "Owner" },
  { email: "sara@northwind.test", who: "Sara", role: "Manager" },
  { email: "bilal@northwind.test", who: "Bilal", role: "Sales" },
];

function safeNext(n: string | null) {
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const setSession = useSetSession();
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: { email: "", password: "" } });
  const login = useMutation({
    mutationFn: (v: Values) => api().auth.login(v),
    onSuccess: (s) => {
      setSession(s);
      router.replace(safeNext(params.get("next")));
    },
  });
  const err = login.error ? describeError(login.error) : null;
  const { errors } = form.formState;

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={form.handleSubmit((v) => login.mutate(v))} noValidate className="flex flex-col gap-5">
        <Field label="Work email" error={errors.email?.message} required>
          {(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" {...form.register("email")} />}
        </Field>
        <Field label="Password" error={errors.password?.message} required>
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...form.register("password")} />}
        </Field>
        {err && (
          <div role="alert" className="rounded-[3px] bg-signal-tint px-4 py-3 text-sm">
            <p className="font-semibold text-signal">{err.title}</p>
            {err.action && <p className="mt-0.5 text-ink">{err.action}</p>}
          </div>
        )}
        <Button type="submit" size="lg" loading={login.isPending} className="w-full justify-center">
          Log in
        </Button>
      </form>

      {API_MODE === "mock" && (
        <div className="rounded-[3px] bg-surface p-4">
          <p className="text-sm font-semibold text-ink">Demo workspace: Northwind Solar</p>
          <p className="mt-1 text-[13px] text-ink-soft">Each person sees what their role allows. Password for all: demo1234</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {DEMO.map((d) => (
              <Button
                key={d.email}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  form.setValue("email", d.email);
                  form.setValue("password", "demo1234");
                  login.mutate({ email: d.email, password: "demo1234" });
                }}
              >
                {d.who} · {d.role}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
