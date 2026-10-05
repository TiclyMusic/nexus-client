import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useApp } from "../../lib/store";
import type { AccountInfo, DeviceCode } from "../../lib/types";
import { Avatar } from "../../components/shell";
import { SkinViewer } from "../../components/SkinViewer";
import { Badge, Button, cn, Dialog, EmptyState, Icon, IconButton, Spinner, TextField } from "../../components/ui";

function LoginDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refreshAccounts, snack } = useApp();
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    setError(null);
    setCode(null);
    (async () => {
      try {
        const dc = await api.authStart();
        setCode(dc);
        const account = await api.authComplete(dc);
        await refreshAccounts();
        snack(`Accesso effettuato come ${account.username}`, "success");
        close();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        started.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    api.authCancel().catch(() => {});
    started.current = false;
    onClose();
  }

  return (
    <Dialog open={open} onClose={close} icon="passkey" title="Accedi con Microsoft" width={480}
      actions={<Button variant="text" onClick={close}>{error ? "Chiudi" : "Annulla"}</Button>}
    >
      {error ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-error-container p-4 text-on-error-container">
          <div className="flex items-center gap-2 font-semibold">
            <Icon name="error" filled /> Accesso non riuscito
          </div>
          <p className="selectable">{error}</p>
        </div>
      ) : !code ? (
        <div className="flex flex-col items-center gap-4 py-8 text-primary">
          <Spinner size={48} />
          <p className="text-on-surface-variant">Richiesta del codice…</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5 pb-2 text-center">
          <p>
            Apri <b className="text-on-surface">{code.verificationUri}</b> e inserisci questo codice:
          </p>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(code.userCode);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="group flex cursor-pointer items-center gap-1.5"
            title="Copia"
          >
            {code.userCode.split("").map((ch, i) => (
              <span
                key={i}
                className="flex h-14 w-10 animate-pop items-center justify-center rounded-xl bg-primary-container font-mono text-2xl font-bold text-on-primary-container"
                style={{ animationDelay: `${i * 35}ms` }}
              >
                {ch}
              </span>
            ))}
            <Icon name={copied ? "check" : "content_copy"} className="ml-2 text-on-surface-variant group-hover:text-primary" />
          </button>
          <Button icon="open_in_new" size="lg" onClick={() => openUrl(code.verificationUri)}>
            Apri pagina di accesso
          </Button>
          <div className="flex items-center gap-3 text-on-surface-variant">
            <Spinner size={20} className="text-primary" /> In attesa della conferma…
          </div>
          <p className="text-xs">Il login avviene sul sito ufficiale Microsoft: Nexus non vede mai la tua password.</p>
        </div>
      )}
    </Dialog>
  );
}

function AccountCard({ account }: { account: AccountInfo }) {
  const { refreshAccounts, snack } = useApp();
  const [busy, setBusy] = useState(false);
  const [copiedUuid, setCopiedUuid] = useState(false);

  const run = (fn: () => Promise<unknown>, ok?: string) => async () => {
    setBusy(true);
    try {
      await fn();
      await refreshAccounts();
      if (ok) snack(ok, "success");
    } catch (e) {
      snack(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  // Modello e cape sono definiti dall'account Mojang, non modificabili da un launcher: li mostriamo in sola lettura.
  const modelLabel = account.skinVariant?.toLowerCase() === "slim" ? "Slim (Alex · 3px)" : "Classico (Steve · 4px)";
  const hasCape = !!account.capeUrl;

  const nowSecs = Math.floor(Date.now() / 1000);
  const remainingHours = Math.max(0, Math.round((account.expiresAt - nowSecs) / 3600));
  const isExpiringSoon = remainingHours < 2;
  const expiryFormatted = account.expiresAt > 0 ? new Date(account.expiresAt * 1000).toLocaleString() : "Non disponibile";

  return (
    <div className="relative flex flex-col gap-5 overflow-hidden rounded-[32px] bg-surface-container p-6 animate-enter">
      {account.active && <div className="pointer-events-none absolute -top-24 -left-24 size-80 rounded-full bg-primary/10" />}

      {/* Intestazione Account */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar account={account} size={44} />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="type-title truncate">{account.username}</h3>
              {account.active && (
                <Badge tone="tertiary">
                  <Icon name="check_circle" size={14} filled /> Attivo
                </Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {account.kind === "microsoft" ? (
                <Badge tone="primary">
                  <Icon name="verified" size={14} filled /> Account Microsoft
                </Badge>
              ) : (
                <Badge tone="error">
                  <Icon name="developer_mode" size={14} /> Offline (dev)
                </Badge>
              )}
              <Badge tone="secondary">{modelLabel}</Badge>
              {hasCape && (
                <Badge tone="primary">
                  <Icon name="checkroom" size={14} filled /> Con mantello
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Azioni rapide */}
        <div className="flex items-center gap-2">
          {busy && <Spinner size={20} className="mr-1 text-primary" />}
          {!account.active && (
            <Button variant="tonal" size="sm" onClick={run(() => api.setActiveAccount(account.uuid))}>
              Usa come predefinito
            </Button>
          )}
          {account.kind === "microsoft" && (
            <IconButton icon="refresh" label="Rinnova sessione" onClick={run(() => api.refreshAccount(account.uuid), "Sessione Microsoft rinnovata")} />
          )}
          <IconButton icon="logout" label="Rimuovi account" onClick={run(() => api.removeAccount(account.uuid), "Account rimosso")} />
        </div>
      </div>

      {/* Area Visuale: render 3D reale (skin + mantello ufficiale) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 rounded-2xl bg-surface-container-high/60 p-4">
        <div className="md:col-span-5 flex items-center justify-center rounded-2xl bg-surface-container-lowest/50 border border-outline-variant/30 p-2">
          <SkinViewer account={account} width={220} height={320} />
        </div>

        <div className="md:col-span-7 flex flex-col justify-between gap-4">
          <div className="flex flex-col gap-3">
            {/* Mantello reale */}
            <div className="flex items-center justify-between rounded-2xl bg-surface-container p-3 border border-outline-variant/20">
              <div className="flex items-center gap-3">
                <div className={cn("flex size-10 items-center justify-center rounded-xl", hasCape ? "bg-primary-container text-on-primary-container" : "bg-surface-container-highest text-on-surface-variant")}>
                  <Icon name={hasCape ? "checkroom" : "block"} size={20} filled={hasCape} />
                </div>
                <div>
                  <p className="text-xs font-medium text-on-surface-variant">Mantello</p>
                  <p className="text-sm font-semibold">{hasCape ? "Equipaggiato dal tuo account" : "Nessun mantello"}</p>
                </div>
              </div>
              {account.kind === "microsoft" && (
                <Button
                  variant="tonal"
                  size="sm"
                  icon="open_in_new"
                  onClick={() => openUrl("https://www.minecraft.net/msaprofile/mygames/editprofile")}
                >
                  Gestisci
                </Button>
              )}
            </div>
            <p className="px-1 text-[11px] text-on-surface-variant">
              Skin, modello e mantelli sono legati al tuo account Mojang: si modificano su minecraft.net e Nexus li mostra come sono davvero in gioco.
            </p>
          </div>

          {/* Dati Sessione & UUID */}
          <div className="flex flex-col gap-2 pt-2 border-t border-outline-variant/30 text-xs text-on-surface-variant">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-mono">
                <Icon name="fingerprint" size={16} /> UUID: {account.uuid}
              </span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(account.uuid);
                  setCopiedUuid(true);
                  snack("UUID copiato negli appunti", "info");
                  setTimeout(() => setCopiedUuid(false), 1500);
                }}
                className="cursor-pointer text-primary hover:underline flex items-center gap-1"
              >
                <Icon name={copiedUuid ? "check" : "content_copy"} size={14} />
                {copiedUuid ? "Copiato" : "Copia UUID"}
              </button>
            </div>

            {account.kind === "microsoft" && (
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Icon name="schedule" size={16} className={isExpiringSoon ? "text-error" : undefined} />
                  Scadenza sessione: {expiryFormatted}
                </span>
                <span className={cn("font-medium", isExpiringSoon ? "text-error font-semibold" : "text-primary")}>
                  {remainingHours > 0 ? `~${remainingHours}h rimanenti` : "Da rinnovare"}
                </span>
              </div>
            )}

            {/* Link esterni ufficiali */}
            <div className="mt-1 flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => openUrl("https://www.minecraft.net/msaprofile/mygames/editskin")}
                className="cursor-pointer rounded-lg bg-surface-container px-2.5 py-1 text-[11px] text-primary hover:bg-surface-container-highest transition-colors flex items-center gap-1"
              >
                <Icon name="open_in_new" size={14} /> Modifica Skin su Minecraft.net
              </button>
              <button
                type="button"
                onClick={() => openUrl(`https://namemc.com/profile/${account.uuid}`)}
                className="cursor-pointer rounded-lg bg-surface-container px-2.5 py-1 text-[11px] text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors flex items-center gap-1"
              >
                <Icon name="visibility" size={14} /> Vedi su NameMC
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AccountsPage() {
  const { accounts, settings, navigate, refreshAccounts, snack } = useApp();
  const [login, setLogin] = useState(false);
  const [offlineName, setOfflineName] = useState("");
  const missingClientId = settings && !settings.msClientId;

  return (
    <div className="px-10 pt-8 pb-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="type-headline animate-enter">Account & Profili</h1>
          <p className="mt-1 text-sm text-on-surface-variant animate-enter">
            Gestisci i tuoi profili di gioco, mantelli (Capes), aspetto del personaggio e sessioni di autenticazione.
          </p>
        </div>
        <Button icon="login" size="lg" onClick={() => setLogin(true)} disabled={!!missingClientId}>
          Accedi con Microsoft
        </Button>
      </div>

      {missingClientId && (
        <div className="mb-6 flex animate-enter items-start gap-4 rounded-3xl bg-tertiary-container p-5 text-on-tertiary-container">
          <Icon name="key" size={28} />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Serve un Client ID Azure</p>
            <p className="mt-1">
              Il login Microsoft richiede un'app registrata su Azure (Microsoft Entra) e approvata da Mojang per le API Minecraft. Inseriscilo nelle
              Impostazioni oppure compila con <code>NEXUS_MS_CLIENT_ID</code>.
            </p>
          </div>
          <Button variant="filled" onClick={() => navigate("settings")}>
            Impostazioni
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {accounts.length === 0 ? (
          <EmptyState icon="account_circle" title="Nessun account" text="Accedi con l'account Microsoft che possiede Minecraft: Java Edition." />
        ) : (
          accounts.map((a) => <AccountCard key={a.uuid} account={a} />)
        )}
      </div>

      {import.meta.env.DEV && (
        <div className="mt-8 rounded-3xl border border-dashed border-outline-variant p-5">
          <p className="type-label mb-3 flex items-center gap-2 text-on-surface-variant">
            <Icon name="developer_mode" size={18} /> Solo sviluppo: account offline per testare il launch senza client ID approvato
          </p>
          <div className="flex gap-3">
            <TextField className="flex-1" label="Username" value={offlineName} onChange={(e) => setOfflineName(e.target.value)} />
            <Button
              variant="outlined"
              className="self-center"
              onClick={async () => {
                try {
                  await api.addOfflineAccount(offlineName);
                  setOfflineName("");
                  await refreshAccounts();
                } catch (e) {
                  snack(errorMessage(e), "error");
                }
              }}
            >
              Aggiungi
            </Button>
          </div>
        </div>
      )}

      <LoginDialog open={login} onClose={() => setLogin(false)} />
    </div>
  );
}
