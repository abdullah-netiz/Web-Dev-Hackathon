"use client";

import {
  ArrowBendDownRightIcon,
  ArrowsLeftRightIcon,
  CalendarCheckIcon,
  ChatCircleTextIcon,
  CheckCircleIcon,
  CreditCardIcon,
  FlagIcon,
  NoteIcon,
  PencilSimpleIcon,
  SparkleIcon,
  UserPlusIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { Activity, ActivityType } from "@/lib/api/types";
import { formatDateTime, timeAgo } from "@/lib/utils";

const ICONS: Record<ActivityType, Icon> = {
  CREATED: SparkleIcon,
  NOTE: NoteIcon,
  STAGE_CHANGE: FlagIcon,
  ASSIGNMENT: UserPlusIcon,
  ACKNOWLEDGED: CheckCircleIcon,
  ESCALATION: ArrowBendDownRightIcon,
  REASSIGNMENT: ArrowsLeftRightIcon,
  FIELD_EDIT: PencilSimpleIcon,
  MESSAGE: ChatCircleTextIcon,
  PAYMENT: CreditCardIcon,
  APPOINTMENT: CalendarCheckIcon,
};

const LABEL: Record<ActivityType, string> = {
  CREATED: "Created",
  NOTE: "Note",
  STAGE_CHANGE: "Stage change",
  ASSIGNMENT: "Assignment",
  ACKNOWLEDGED: "Acknowledged",
  ESCALATION: "Escalation",
  REASSIGNMENT: "Reassignment",
  FIELD_EDIT: "Field edit",
  MESSAGE: "Message",
  PAYMENT: "Payment",
  APPOINTMENT: "Appointment",
};

function show(v: unknown) {
  if (v == null || v === "") return "empty";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function Timeline({ items, empty = "Nothing has happened here yet." }: { items: Activity[]; empty?: string }) {
  if (!items.length) return <p className="py-6 text-sm text-ink-soft">{empty}</p>;
  return (
    <ol className="relative flex flex-col" aria-label="Activity history">
      {items.map((a, i) => {
        const Ico = ICONS[a.type];
        const diff = a.type === "FIELD_EDIT" && a.before && a.after && typeof a.before === "object" ? Object.keys(a.after as object) : [];
        return (
          <li key={a.id} className="relative flex gap-4 pb-6">
            {i < items.length - 1 && <span aria-hidden className="absolute top-8 bottom-0 left-[15px] w-px bg-line" />}
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-teal">
              <Ico size={16} weight="duotone" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm text-ink">{a.summary}</p>
              {diff.length > 0 && (
                <dl className="mt-1.5 flex flex-col gap-0.5 text-[13px]">
                  {diff.map((k) => (
                    <div key={k} className="flex flex-wrap gap-1.5">
                      <dt className="text-ink-soft">{k}:</dt>
                      <dd>
                        <span className="text-ink-soft line-through">{show((a.before as Record<string, unknown>)[k])}</span>{" "}
                        <span aria-hidden>→</span> <span className="sr-only">changed to</span>
                        <span className="text-ink">{show((a.after as Record<string, unknown>)[k])}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="mt-1 text-[12.5px] text-ink-soft">
                <span className="font-medium">{LABEL[a.type]}</span> · {a.actorName} ·{" "}
                <time dateTime={a.at} title={formatDateTime(a.at)}>
                  {timeAgo(a.at)}
                </time>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
