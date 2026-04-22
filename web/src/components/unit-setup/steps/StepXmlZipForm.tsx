import type { SetupXmlZipImportState } from "@/types/companySetup";
import { FileArchive, Loader2 } from "lucide-react";

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
  const phase = state?.phase ?? "idle";
  const log = state?.file_log ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Envie um arquivo .zip com XMLs de notas. O processamento completo pode
        rodar em segundo plano numa versão futura; aqui simulamos as fases.
      </p>

      <div
        className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/20 px-6 py-10"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f?.name.toLowerCase().endsWith(".zip")) onPickFile(f);
        }}
      >
        <FileArchive className="h-10 w-10 text-muted-foreground" />
        <label className="cursor-pointer text-sm font-medium text-primary underline">
          Selecionar .zip
          <input
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
            }}
          />
        </label>
        {state?.file_name ? (
          <p className="text-xs text-muted-foreground">{state.file_name}</p>
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
              {e.name}: {e.ok ? e.message ?? "OK" : e.message ?? "Erro"}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
