import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import type { SetupCertificateState } from "@/types/companySetup";
import { FileKey, Loader2, Trash2 } from "lucide-react";

export function StepCertificateForm({
  companyId,
  cert,
  password,
  onPasswordChange,
  onPickFile,
  onRemoveCertificate,
  busy,
}: {
  /** `null` enquanto a unidade ainda não existe na Faro (passos 1–2 antes da Focus). */
  companyId: string | null;
  cert: SetupCertificateState | undefined;
  password: string;
  onPasswordChange: (v: string) => void;
  onPickFile: (file: File) => void;
  /** Quando o certificado está válido: remove e libera novo envio + senha. */
  onRemoveCertificate?: () => void;
  busy: boolean;
}) {
  const status = cert?.status ?? "not_sent";
  const lockedAfterValid = status === "valid";

  return (
    <div className="space-y-4" data-setup-company={companyId ?? ""}>
      <p className="text-sm text-muted-foreground">
        Envie o certificado digital A1 (PFX/P12) e informe a senha. O arquivo é
        convertido para base64 e enviado à Focus ao concluir este passo. Por
        segurança, a senha e o conteúdo do certificado não são gravados na Faro.
      </p>

      {!lockedAfterValid ? (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/20 px-6 py-10"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) onPickFile(f);
          }}
        >
          <FileKey className="h-10 w-10 text-muted-foreground" />
          <div className="text-center text-sm">
            <span className="font-medium">Arraste o certificado ou </span>
            <label className="cursor-pointer text-primary underline">
              escolha um arquivo
              <input
                type="file"
                accept=".pfx,.p12"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickFile(f);
                }}
              />
            </label>
          </div>
          {cert?.file_name ? (
            <p className="text-xs text-muted-foreground">{cert.file_name}</p>
          ) : null}
        </div>
      ) : (
        <div className="rounded-xl border bg-muted/20 px-4 py-3 text-sm">
          <p className="font-medium">Certificado válido</p>
          {cert?.file_name ? (
            <p className="text-muted-foreground">Arquivo: {cert.file_name}</p>
          ) : null}
          {onRemoveCertificate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={onRemoveCertificate}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remover certificado
            </Button>
          ) : null}
        </div>
      )}

      {!lockedAfterValid ? (
        <div className="space-y-2">
          <Label htmlFor="cert-pass">Senha do certificado</Label>
          <PasswordInput
            id="cert-pass"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            autoComplete="new-password"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Status:</span>
        <span className="font-medium capitalize">
          {status === "not_sent" && "Não enviado"}
          {status === "uploaded" && "Enviado"}
          {status === "validating" && "Validando"}
          {status === "valid" && "Válido"}
          {status === "invalid" && "Inválido"}
        </span>
        {busy || status === "validating" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : null}
      </div>
    </div>
  );
}
