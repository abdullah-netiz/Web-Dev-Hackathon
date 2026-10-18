import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFrame } from "@/components/brand/auth-frame";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <AuthFrame
      title="Welcome back."
      intro="Log in to see the leads waiting for you and how long each one has left."
      footer={
        <>
          New to Baton?{" "}
          <a href="/signup" className="font-medium text-teal underline underline-offset-4">
            Create a workspace
          </a>
        </>
      }
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthFrame>
  );
}
