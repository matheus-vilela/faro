import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import type { SetupCertificateState } from "@/types/companySetup";
import { FileKey, Loader2 } from "lucide-react";

export function StepCertificateForm({
  companyId,
  cert,
  password,
  onPasswordChange,
  onPickFile,
  busy,
}: {
  companyId: string | null;
  cert: SetupCertificateState | undefined;
  password: string;
  onPasswordChange: (v: string) => void;
  onPickFile: (file: File) => void;
  busy: boolean;
}) {
  const status = cert?.status ?? "not_sent";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Envie o certificado digital A1 (PFX/P12) e informe a senha. A validação
        com a Focus NFe pode ser concluída depois; aqui registramos o arquivo e
        simulamos a checagem.
      </p>

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

      <div className="space-y-2">
        <Label htmlFor="cert-pass">Senha do certificado</Label>
        <PasswordInput
          id="cert-pass"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          autoComplete="new-password"
        />
      </div>

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
      {!companyId ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Conclua o passo 1 para habilitar o upload do certificado.
        </p>
      ) : null}
    </div>
  );
}
