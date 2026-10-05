// Render 3D della skin (con cape) usando skinview3d e le texture ufficiali Mojang.
import { useEffect, useRef, useState } from "react";
import { IdleAnimation, SkinViewer as Sv } from "skinview3d";
import { api, isTauri } from "../lib/api";
import type { AccountInfo } from "../lib/types";
import { cn, Icon, Spinner } from "./ui";

// In Tauri scarichiamo la texture dal backend (data URL, niente CORS/servizi terzi);
// nel browser di sviluppo la usiamo direttamente.
async function textureSource(url?: string | null): Promise<string | null> {
  if (!url) return null;
  if (!isTauri()) return url;
  try {
    return await api.fetchTexture(url);
  } catch {
    return url;
  }
}

export function SkinViewer({
  account,
  width = 240,
  height = 340,
  className,
}: {
  account: AccountInfo;
  width?: number;
  height?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<Sv | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!canvasRef.current || !account.skinUrl) {
      setStatus(account.skinUrl ? "loading" : "error");
      return;
    }
    let disposed = false;
    setStatus("loading");

    const viewer = new Sv({
      canvas: canvasRef.current,
      width,
      height,
      // lo sfondo è trasparente di default: si integra con la card M3
      zoom: 0.9,
    });
    viewer.animation = new IdleAnimation();
    viewer.autoRotate = true;
    viewer.autoRotateSpeed = 0.6;
    viewer.controls.enableZoom = false;
    viewer.controls.enablePan = false;
    viewerRef.current = viewer;

    (async () => {
      try {
        const [skin, cape] = await Promise.all([textureSource(account.skinUrl), textureSource(account.capeUrl)]);
        if (disposed || !skin) return;
        const model = account.skinVariant?.toUpperCase() === "SLIM" ? "slim" : "default";
        await viewer.loadSkin(skin, { model });
        if (cape && !disposed) {
          // backEquipment "cape" mostra il mantello; "elytra" mostrerebbe le ali
          await viewer.loadCape(cape, { backEquipment: "cape" });
        }
        if (!disposed) setStatus("ready");
      } catch {
        if (!disposed) setStatus("error");
      }
    })();

    return () => {
      disposed = true;
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [account.skinUrl, account.capeUrl, account.skinVariant, width, height]);

  return (
    <div className={cn("relative shrink-0", className)} style={{ width, height }}>
      <canvas ref={canvasRef} className={cn("transition-opacity duration-500", status === "ready" ? "opacity-100" : "opacity-0")} />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-primary">
          <Spinner size={40} />
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-on-surface-variant">
          <Icon name="accessibility_new" size={64} />
          <span className="text-xs">Nessuna skin</span>
        </div>
      )}
    </div>
  );
}
