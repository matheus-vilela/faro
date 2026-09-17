import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SharingCountGroup } from "@/lib/inventoryCount/createSession";
import { useEffect, useState } from "react";

export type CountIncludeGroupsPrompt = {
  originGroupId: string;
  originGroupName: string;
  extras: SharingCountGroup[];
  busyKey: string;
};

export function EstoqueContagemIncludeGroupsDialog({
  prompt,
  busy,
  onOpenChange,
  onConfirm,
}: {
  prompt: CountIncludeGroupsPrompt | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (groupIds: string[]) => void;
}) {
  const extras = prompt?.extras ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!prompt) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(prompt.extras.map((g) => g.id)));
  }, [prompt]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={prompt != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Incluir outros setores?</DialogTitle>
          <DialogDescription>
            Produtos de {prompt?.originGroupName ?? "este setor"} também estão
            em outros locais. Incluir na mesma rodada (um link) para o estoque
            somar em vez de sobrescrever.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-56 space-y-2 overflow-y-auto py-1">
          {extras.map((g) => (
            <li key={g.id}>
              <label className="flex items-start gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <Checkbox
                  checked={selected.has(g.id)}
                  onCheckedChange={() => toggle(g.id)}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">
                    {g.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {g.shared_count} produto(s) em comum
                    {g.sample_name ? ` · ex.: ${g.sample_name}` : ""}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter className="sm:flex-wrap">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={busy || !prompt}
            onClick={() => {
              if (!prompt) return;
              onConfirm([prompt.originGroupId, ...selected]);
            }}
          >
            Gerar link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
