import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";
import type { SetupCertificateState } from "@/types/companySetup";
import { CheckCircle2, FileKey, FileUp, Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";

export function CertificateUploadFields({
  cert,
  password,
  onPasswordChange,
  onPickFile,
  busy,
  showStatus = true,
  lockWhenValid = true,
}: {
  cert: SetupCertificateState | undefined;
  password: string;
  onPasswordChange: (v: string) => void;
  onPickFile: (file: File) => void;
  busy?: boolean;
  showStatus?: boolean;
  lockWhenValid?: boolean;
}) {
  const fileInputId = useId();
  const status = cert?.status ?? "not_sent";
  const lockedAfterValid = lockWhenValid && status === "valid";
  const hasFile = Boolean(cert?.file_name);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  return (
    <div className="space-y-4">
      {!lockedAfterValid ? (
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-xl border-2 px-6 py-10 transition-[border-color,box-shadow,background-color]",
            hasFile
              ? "border-primary/50 bg-primary/5 shadow-sm"
              : dragOver
                ? "border-dashed border-primary/60 bg-primary/5"
                : "border-dashed border-muted-foreground/30 bg-muted/20",
            !hasFile &&
              !dragOver &&
              "hover:border-muted-foreground/50 hover:bg-muted/30",
          )}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragDepth.current += 1;
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragDepth.current -= 1;
            if (dragDepth.current <= 0) {
              dragDepth.current = 0;
              setDragOver(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragDepth.current = 0;
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) onPickFile(f);
          }}
        >
          {hasFile ? (
            <>
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary"
                aria-hidden
              >
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">
                  Arquivo carregado
                </p>
                <p
                  className="mt-1 break-all text-sm text-muted-foreground"
                  title={cert?.file_name}
                >
                  {cert?.file_name}
                </p>
                <label
                  htmlFor={fileInputId}
                  className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <FileUp className="h-4 w-4" />
                  Escolher outro arquivo
                </label>
              </div>
            </>
          ) : (
            <>
              <FileKey
                className={cn(
                  "h-10 w-10",
                  dragOver ? "text-primary" : "text-muted-foreground",
                )}
                aria-hidden
              />
              <div className="text-center text-sm">
                <span className="font-medium">
                  {dragOver
                    ? "Solte o arquivo aqui"
                    : "Arraste o certificado ou "}
                </span>
                {!dragOver ? (
                  <label
                    htmlFor={fileInputId}
                    className="cursor-pointer text-primary underline"
                  >
                    escolha um arquivo
                  </label>
                ) : null}
              </div>
            </>
          )}
          <input
            id={fileInputId}
            type="file"
            accept=".pfx,.p12"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
            }}
          />
        </div>
      ) : (
        <div className="rounded-xl border bg-muted/20 px-4 py-3 text-sm">
          <p className="font-medium">Certificado válido</p>
          {cert?.file_name ? (
            <p className="text-muted-foreground">Arquivo: {cert.file_name}</p>
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

      {showStatus ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Status:</span>
          <span className="font-medium capitalize">
            {status === "not_sent" && "Não enviado"}
            {status === "uploaded" && "Enviado"}
            {status === "validating" && "Validando"}
            {status === "valid" && "Válido"}
            {status === "invalid" && "Inválido"}
            {status === "delegated_pending" && "Aguardando terceiro"}
          </span>
          {busy || status === "validating" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
