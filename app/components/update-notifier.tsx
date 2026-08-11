"use client";

import { useEffect, useRef, useState } from "react";

const CHECK_INTERVAL_MS = 60_000;

export default function UpdateNotifier() {
  const knownVersion = useRef<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let active = true;

    const checkVersion = async () => {
      try {
        const response = await fetch(`/api/version?check=${Date.now()}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) return;

        const payload = await response.json() as { version?: string };
        if (!active || !payload.version) return;

        if (knownVersion.current === null) {
          knownVersion.current = payload.version;
        } else if (knownVersion.current !== payload.version) {
          setUpdateAvailable(true);
        }
      } catch {
        // A temporary network failure should not interrupt the application.
      }
    };

    void checkVersion();
    const interval = window.setInterval(() => void checkVersion(), CHECK_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkVersion();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div className="update-notifier" role="status" aria-live="polite">
      <span>Uma nova versão do painel está disponível.</span>
      <button type="button" onClick={() => window.location.reload()}>Atualizar agora</button>
    </div>
  );
}
