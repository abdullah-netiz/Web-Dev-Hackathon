import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-[3px] bg-paper px-3 text-sm text-ink ring-1 ring-inset ring-line placeholder:text-ink-faint " +
  "transition-[box-shadow,background-color] duration-150 hover:ring-surface-3 " +
  "focus:outline-none focus:ring-2 focus:ring-teal aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-signal " +
  "disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-faint";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(control, "h-10", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(control, "min-h-24 py-2.5 leading-relaxed", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(control, "h-10 appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft">
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium text-ink", className)} {...props} />;
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string; required?: boolean }) => ReactNode;
}

export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="text-ink-soft" aria-hidden>
            {" "}
            *
          </span>
        )}
      </Label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": [hintId, errId].filter(Boolean).join(" ") || undefined,
        required,
      })}
      {hint && !error && (
        <p id={hintId} className="text-[13px] text-ink-soft">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="flex items-start gap-1.5 text-[13px] font-medium text-signal">
          <svg aria-hidden viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0">
            <circle cx="8" cy="8" r="7" fill="currentColor" />
            <path d="M8 4.5v4.2M8 10.8v.2" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}
