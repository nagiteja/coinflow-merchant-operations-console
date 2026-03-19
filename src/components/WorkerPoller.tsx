"use client";

import { useEffect, useRef } from "react";

export default function WorkerPoller() {
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function tickOnce() {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        if (cancelled) return;
        await fetch("/api/worker/tick", { method: "POST" }).catch(() => {});
      } finally {
        inFlightRef.current = false;
      }
    }

    // Tick immediately, then at ~1s cadence.
    tickOnce();
    const t = setInterval(tickOnce, 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return null;
}

