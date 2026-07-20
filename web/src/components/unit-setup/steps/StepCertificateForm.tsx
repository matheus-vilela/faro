import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  CertificateFiscalMode,
  SetupCertificateState,
} from "@/types/companySetup";
import { Check, Copy, Link2, Loader2, ShieldCheck, SkipForward } from "lucide-react";
import { CertificateUploadFields } from "./CertificateUploadFields";

const FISCAL_OPTIONS: {
  mode: CertificateFiscalMode;
  title: string;
  description: string;
  icon: typeof ShieldCheck;
}[] = [
  {
    mode: "upload_now",
    title: "Enviar certificado A1 agora",
    description:
      "Conecta a SEFAZ neste passo. O certificado não fica salvo na Faro.",
    icon: ShieldCheck,
  },
  {
    mode: "skip",
    title: "Continuar sem enviar certificado",
    description: "Você pode conectar depois em Configurações → Fiscal.",
    icon: SkipForward,
  },
  {
    mode: "delegate_link",
    title: "Enviar link para outra pessoa conectar o certificado",
    description: "Gere um link único para quem cuida do certificado.",
    icon: Link2,
  },
];

export function StepCertificateForm({
  cert,
  password,
  onPasswordChange,
  onPickFile,
  onRemoveCertificate,
  onModeChange,
  busy,
  delegationLinkUrl,
  onGenerateLink,
  linkGenerating,
  onCopyLink,
  linkCopied,
  compact = false,
}: {
  cert: SetupCertificateState | undefined;
  password: string;
  onPasswordChange: (v: string) => void;
  onPickFile: (file: File) => void;
  onRemoveCertificate?: () => void;
  onModeChange: (mode: CertificateFiscalMode) => void;
  busy: boolean;
  delegationLinkUrl?: string | null;
  onGenerateLink?: () => void;
  linkGenerating?: boolean;
  onCopyLink?: () => void;
  linkCopied?: boolean;
  compact?: boolean;
}) {
  const mode: CertificateFiscalMode = cert?.mode ?? "undecided";
  const status = cert?.status ?? "not_sent";

  return (
    <div className={cn(compact ? "space-y-3" : "space-y-4")}>
      <p className="text-sm text-muted-foreground">
        Escolha como deseja conectar o certificado digital A1 (PFX/P12) à SEFAZ.
        Por segurança, a senha e o conteúdo do certificado não são gravados na
        Faro.
      </p>

      <div className="space-y-3">
        {FISCAL_OPTIONS.map((opt) => {
          const selected = mode === opt.mode;
          const Icon = opt.icon;
          return (
            <Card
              key={opt.mode}
              className={cn(
                "overflow-hidden transition-shadow",
                selected
                  ? "border-primary ring-1 ring-primary/20 bg-primary/5"
                  : "border-border/80",
              )}
            >
              <button
                type="button"
                onClick={() => onModeChange(opt.mode)}
                className={cn(
                  "flex w-full items-start gap-4 text-left transition-colors",
                  compact ? "p-3 sm:p-4" : "p-4 sm:p-5",
                  "hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                )}
                aria-pressed={selected}
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
                    selected
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-muted/50 text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground sm:text-base">
                    {opt.title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {opt.description}
                  </p>
                </div>
                {selected ? (
                  <Check
                    className="h-5 w-5 shrink-0 text-primary"
                    aria-hidden
                  />
                ) : null}
              </button>

              {opt.mode === "upload_now" && selected ? (
                <div
                  className={cn(
                    "border-t border-border/60 pt-2",
                    compact
                      ? "px-3 pb-3 sm:px-4 sm:pb-4"
                      : "px-4 pb-4 sm:px-5 sm:pb-5",
                  )}
                >
                  <CertificateUploadFields
                    cert={cert}
                    password={password}
                    onPasswordChange={onPasswordChange}
                    onPickFile={onPickFile}
                    busy={busy}
                    lockWhenValid={false}
                    compact={compact}
                    showStatus={!compact}
                  />
                  {status === "valid" && onRemoveCertificate ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={onRemoveCertificate}
                    >
                      Remover certificado
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {opt.mode === "delegate_link" && selected ? (
                <div
                  className={cn(
                    "border-t border-border/60 pt-2",
                    compact
                      ? "px-3 pb-3 sm:px-4 sm:pb-4"
                      : "px-4 pb-4 sm:px-5 sm:pb-5",
                  )}
                >
                  {delegationLinkUrl ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Compartilhe este link com quem vai enviar o certificado.
                        Ele expira em 72 horas e só pode ser usado uma vez.
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          type="text"
                          readOnly
                          value={delegationLinkUrl}
                          className="min-w-0 flex-1 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm"
                          aria-label="Link para envio do certificado"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0"
                          onClick={onCopyLink}
                        >
                          {linkCopied ? (
                            <>
                              <Check className="mr-2 h-4 w-4" />
                              Copiado
                            </>
                          ) : (
                            <>
                              <Copy className="mr-2 h-4 w-4" />
                              Copiar link
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Gere um link único para outra pessoa enviar o certificado
                        sem acessar o Faro.
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={linkGenerating || !onGenerateLink}
                        onClick={onGenerateLink}
                      >
                        {linkGenerating ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Gerando link…
                          </>
                        ) : (
                          "Gerar link"
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
