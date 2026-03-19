"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow-sm shadow-primary/25",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow-sm shadow-destructive/20",
        outline: "border-border/80 bg-background/60 text-foreground backdrop-blur-sm",
        success:
          "border-emerald-500/25 bg-emerald-500/[0.12] text-emerald-800 shadow-sm dark:text-emerald-100",
        warning:
          "border-amber-500/30 bg-amber-500/[0.12] text-amber-900 shadow-sm dark:text-amber-100",
        info: "border-sky-500/25 bg-sky-500/[0.12] text-sky-900 shadow-sm dark:text-sky-100",
        neutral: "border-border bg-muted/80 text-muted-foreground"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

