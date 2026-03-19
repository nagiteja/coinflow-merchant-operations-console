"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type AnimatedNumberProps = {
  value: number;
  className?: string;
  durationMs?: number;
};

export function AnimatedNumber({ value, className, durationMs = 480 }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev === value) return;

    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(Math.round(prev + (value - prev) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        prevRef.current = value;
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durationMs]);

  return (
    <span
      className={cn(
        "tabular-nums tracking-tight transition-[color] duration-300 motion-reduce:transition-none",
        className
      )}
    >
      {display}
    </span>
  );
}
