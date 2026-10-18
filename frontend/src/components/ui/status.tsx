import type {
  Availability,
  ConnectionStatus,
  LeadSource,
  LeadStatus,
  MessageStatus,
  PaymentStatus,
  RecoveryReason,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "signal" | "off" | "teal" | "neutral";

const toneClass: Record<Tone, string> = {
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  signal: "bg-signal-tint text-signal",
  off: "bg-off-tint text-off",
  teal: "bg-teal-tint text-teal",
  neutral: "bg-surface text-ink-soft",
};

type Shape = "dot" | "ring" | "half" | "bar" | "cross" | "check" | "clock";

function Glyph({ shape }: { shape: Shape }) {
  const common = { viewBox: "0 0 12 12", className: "h-3 w-3 shrink-0", "aria-hidden": true } as const;
  switch (shape) {
    case "dot":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4" fill="currentColor" />
        </svg>
      );
    case "ring":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "half":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M6 2.4a3.6 3.6 0 010 7.2z" fill="currentColor" />
        </svg>
      );
    case "bar":
      return (
        <svg {...common}>
          <rect x="2" y="5" width="8" height="2" fill="currentColor" />
        </svg>
      );
    case "cross":
      return (
        <svg {...common}>
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M2 6.4l2.6 2.6L10 3.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6 3.6V6l1.8 1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
  }
}

export function Tag({ tone = "neutral", shape, children, className }: { tone?: Tone; shape?: Shape; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[3px] px-2 text-[12.5px] font-medium whitespace-nowrap", toneClass[tone], className)}>
      {shape && <Glyph shape={shape} />}
      {children}
    </span>
  );
}

export const AVAILABILITY: Record<Availability, { label: string; tone: Tone; shape: Shape }> = {
  AVAILABLE: { label: "Available", tone: "ok", shape: "dot" },
  BUSY: { label: "Busy", tone: "warn", shape: "half" },
  ON_LEAVE: { label: "On leave", tone: "off", shape: "bar" },
  OFFLINE: { label: "Offline", tone: "off", shape: "ring" },
};

export function AvailabilityTag({ value, className }: { value: Availability; className?: string }) {
  const a = AVAILABILITY[value];
  return (
    <Tag tone={a.tone} shape={a.shape} className={className}>
      {a.label}
    </Tag>
  );
}

const LEAD_STATUS: Record<LeadStatus, { label: string; tone: Tone; shape: Shape }> = {
  NEW: { label: "Unassigned", tone: "signal", shape: "ring" },
  ASSIGNED: { label: "Waiting for ack", tone: "teal", shape: "clock" },
  ACKNOWLEDGED: { label: "Acknowledged", tone: "ok", shape: "check" },
  CLOSED: { label: "Closed", tone: "neutral", shape: "bar" },
};

export function LeadStatusTag({ value }: { value: LeadStatus }) {
  const s = LEAD_STATUS[value];
  return (
    <Tag tone={s.tone} shape={s.shape}>
      {s.label}
    </Tag>
  );
}

export const RECOVERY: Record<Exclude<RecoveryReason, "NONE">, { label: string; long: string; tone: Tone; shape: Shape }> = {
  OVERDUE: { label: "Overdue", long: "Not acknowledged within its window", tone: "signal", shape: "clock" },
  ESCALATED_TWICE: { label: "Escalated twice", long: "Passed on two or more times without a response", tone: "signal", shape: "cross" },
  IDLE: { label: "Idle", long: "No recorded action for the idle period", tone: "warn", shape: "bar" },
};

export function RecoveryTag({ value }: { value: RecoveryReason }) {
  if (value === "NONE") return null;
  const r = RECOVERY[value];
  return (
    <Tag tone={r.tone} shape={r.shape}>
      {r.label}
    </Tag>
  );
}

export const SOURCE_LABEL: Record<LeadSource, string> = { WEB_FORM: "Web form", MESSAGE: "WhatsApp", MANUAL: "Manual" };

export function SourceTag({ value }: { value: LeadSource }) {
  return <Tag tone="neutral">{SOURCE_LABEL[value]}</Tag>;
}

const PAYMENT: Record<PaymentStatus, { label: string; tone: Tone; shape: Shape }> = {
  PENDING: { label: "Awaiting payment", tone: "teal", shape: "clock" },
  PAID: { label: "Paid", tone: "ok", shape: "check" },
  EXPIRED: { label: "Expired", tone: "off", shape: "bar" },
  FAILED: { label: "Failed", tone: "signal", shape: "cross" },
  REFUNDED: { label: "Refunded", tone: "warn", shape: "ring" },
  PARTIALLY_REFUNDED: { label: "Part refunded", tone: "warn", shape: "half" },
};

export function PaymentTag({ value }: { value: PaymentStatus }) {
  const p = PAYMENT[value];
  return (
    <Tag tone={p.tone} shape={p.shape}>
      {p.label}
    </Tag>
  );
}

const MESSAGE: Record<MessageStatus, { label: string; tone: Tone; shape: Shape }> = {
  QUEUED: { label: "Sending", tone: "neutral", shape: "clock" },
  SENT: { label: "Sent", tone: "neutral", shape: "check" },
  DELIVERED: { label: "Delivered", tone: "teal", shape: "check" },
  READ: { label: "Read", tone: "ok", shape: "check" },
  FAILED: { label: "Failed", tone: "signal", shape: "cross" },
  RECEIVED: { label: "Received", tone: "neutral", shape: "dot" },
};

export function MessageStatusTag({ value, className }: { value: MessageStatus; className?: string }) {
  const m = MESSAGE[value];
  return (
    <Tag tone={m.tone} shape={m.shape} className={className}>
      {m.label}
    </Tag>
  );
}

const CONNECTION: Record<ConnectionStatus, { label: string; tone: Tone; shape: Shape }> = {
  CONNECTED: { label: "Connected", tone: "ok", shape: "dot" },
  NOT_CONNECTED: { label: "Not connected", tone: "off", shape: "ring" },
  ERROR: { label: "Error", tone: "signal", shape: "cross" },
};

export function ConnectionTag({ value, hasError }: { value: ConnectionStatus; hasError?: boolean }) {
  const c = CONNECTION[hasError && value === "CONNECTED" ? "CONNECTED" : value];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Tag tone={c.tone} shape={c.shape}>
        {c.label}
      </Tag>
      {hasError && value === "CONNECTED" && (
        <Tag tone="warn" shape="half">
          Recent errors
        </Tag>
      )}
    </span>
  );
}
