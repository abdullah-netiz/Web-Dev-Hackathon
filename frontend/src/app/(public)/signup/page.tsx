"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api, describeError } from "@/lib/api";
import { useSetSession } from "@/lib/session";
import { AuthFrame } from "@/components/brand/auth-frame";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

const schema = z.object({
  workspaceName: z.string().trim().min(2, "Name your company (at least 2 characters).").max(60),
  name: z.string().trim().min(2, "Enter your full name."),
  email: z.email("Enter a valid work email."),
  password: z
    .string()
    .min(10, "Use at least 10 characters.")
    .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), "Mix letters and at least one number."),
});
type Values = z.infer<typeof schema>;

export default function SignupPage() {
  const router = useRouter();
  const setSession = useSetSession();
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onTouched" });
  useEffect(() => {
    const company = new URLSearchParams(window.location.search).get("company");
    if (company) form.setValue("workspaceName", company.slice(0, 60));
  }, [form]);
  const signup = useMutation({
    mutationFn: (v: Values) => api().auth.signup(v),
    onSuccess: (s) => {
      setSession(s);
      router.replace("/dashboard?welcome=1");
    },
  });
  const err = signup.error ? describeError(signup.error) : null;
  const { errors } = form.formState;

  return (
    <AuthFrame
      title="Start your workspace."
      intro="You'll be its Owner. Invite your team, set the response window, and every new lead gets an owner from the first second."
      footer={
        <>
          Already have an account?{" "}
          <a href="/login" className="font-medium text-teal underline underline-offset-4">
            Log in
          </a>
        </>
      }
    >
      <form onSubmit={form.handleSubmit((v) => signup.mutate(v))} noValidate className="flex flex-col gap-5">
        <Field label="Company name" error={errors.workspaceName?.message} required>
          {(p) => <Input {...p} autoComplete="organization" placeholder="Northwind Solar" {...form.register("workspaceName")} />}
        </Field>
        <Field label="Your name" error={errors.name?.message} required>
          {(p) => <Input {...p} autoComplete="name" {...form.register("name")} />}
        </Field>
        <Field label="Work email" error={errors.email?.message} required>
          {(p) => <Input {...p} type="email" autoComplete="email" {...form.register("email")} />}
        </Field>
        <Field label="Password" hint="At least 10 characters, with letters and a number." error={errors.password?.message} required>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register("password")} />}
        </Field>
        {err && (
          <div role="alert" className="rounded-[3px] bg-signal-tint px-4 py-3 text-sm">
            <p className="font-semibold text-signal">{err.title}</p>
            {err.action && <p className="mt-0.5 text-ink">{err.action}</p>}
          </div>
        )}
        <Button type="submit" size="lg" loading={signup.isPending} className="w-full justify-center">
          Create workspace
        </Button>
      </form>
    </AuthFrame>
  );
}
