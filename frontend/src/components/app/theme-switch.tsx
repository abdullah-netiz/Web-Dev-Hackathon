"use client";

import { DesktopIcon, MoonIcon, SunIcon, type Icon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useId } from "react";
import { setTheme, useTheme, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePref; label: string; icon: Icon }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: DesktopIcon },
];

export function ThemeSwitch({ withLabels = false, className }: { withLabels?: boolean; className?: string }) {
  const pref = useTheme();
  const id = useId();
  return (
    <div role="radiogroup" aria-label="Colour theme" className={cn("flex rounded-[3px] bg-surface-2/70 p-0.5", className)}>
      {OPTIONS.map((o) => {
        const on = pref === o.value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            aria-label={withLabels ? undefined : `${o.label} theme`}
            title={o.label}
            onClick={() => setTheme(o.value)}
            className={cn(
              "relative flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[3px] text-[13px] font-medium transition-colors",
              on ? "text-ink" : "text-ink-soft hover:text-ink",
              withLabels && "px-3",
            )}
          >
            {on && <motion.span layoutId={`theme-${id}`} className="absolute inset-0 rounded-[3px] bg-paper" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <o.icon size={15} weight={on ? "fill" : "regular"} className="relative" aria-hidden />
            {withLabels && <span className="relative">{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
