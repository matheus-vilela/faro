import { cn } from "@/lib/utils";
import type { SetupXmlZipImportState } from "@/types/companySetup";
import { CheckCircle2, FileArchive, FileUp, Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";

const PHASE_LABEL: Record<SetupXmlZipImportState["phase"], string> = {
  idle: "Aguardando arquivo",
  uploading: "Enviando",
  parsing: "Lendo XMLs",
  preview: "Pré-visualização",
  importing: "Importando",
  done: "Concluído",
  error: "Erro",
};

export function StepXmlZipForm({
  state,
  onPickFile,
  busy,
}: {
  state: SetupXmlZipImportState | undefined;
  onPickFile: (file: File) => void;
  busy: boolean;
}) {
  const fileInputId = useId();
  const phase = state?.phase ?? "idle";
  const log = state?.file_log ?? [];
  const hasFile = Boolean(state?.file_name);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Envie um arquivo .zip com XMLs de notas. O processamento completo pode
        levar alguns segundos e processa cada XML separadamente.
      </p>

      <div className="relative">
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
              !busy &&
              "hover:border-muted-foreground/50 hover:bg-muted/30",
            busy && "pointer-events-none opacity-60",
          )}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (busy) return;
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
            if (f?.name.toLowerCase().endsWith(".zip")) onPickFile(f);
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
                  title={state?.file_name}
                >
                  {state?.file_name}
                </p>
                <label
                  htmlFor={fileInputId}
                  className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <FileUp className="h-4 w-4" />
                  Escolher outro .zip
                </label>
              </div>
            </>
          ) : (
            <>
              <FileArchive
                className={cn(
                  "h-10 w-10",
                  dragOver ? "text-primary" : "text-muted-foreground",
                )}
                aria-hidden
              />
              <div className="text-center text-sm">
                <span className="font-medium">
                  {dragOver
                    ? "Solte o .zip aqui"
                    : "Arraste o arquivo .zip ou "}
                </span>
                {!dragOver ? (
                  <label
                    htmlFor={fileInputId}
                    className="cursor-pointer text-primary underline"
                  >
                    selecione no computador
                  </label>
                ) : null}
              </div>
            </>
          )}
          <input
            id={fileInputId}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
            }}
          />
        </div>

        {busy ? (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-background/55"
            aria-busy
            aria-label="Processando arquivo"
          >
            <Loader2 className="h-9 w-9 animate-spin text-primary" />
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Fase:</span>
        <span className="font-medium">{PHASE_LABEL[phase]}</span>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      </div>

      {state?.error_message ? (
        <p className="text-sm text-destructive">{state.error_message}</p>
      ) : null}

      {log.length > 0 ? (
        <ul className="max-h-40 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
          {log.map((e, i) => (
            <li key={i} className={e.ok ? "" : "text-destructive"}>
              {e.name}: [{e.status ?? (e.ok ? "success" : "error")}]{" "}
              {e.ok ? e.message ?? "OK" : e.message ?? "Erro"}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
