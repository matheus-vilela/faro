import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";
import JsBarcode from "jsbarcode";
import { Loader2, Printer, Tag } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

function BarcodeBlock({ code, title }: { code: string; title: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !code) return;
    try {
      while (el.firstChild) el.removeChild(el.firstChild);
      JsBarcode(el, code, {
        format: "CODE128",
        width: 1.8,
        height: 56,
        displayValue: true,
        fontSize: 11,
        margin: 8,
      });
    } catch {
      /* código inválido para o formato */
    }
  }, [code]);

  return (
    <div className="label-sheet flex flex-col items-center border-b border-dashed border-border py-6 last:border-b-0 print:break-inside-avoid">
      <p className="mb-2 max-w-[80mm] text-center text-sm font-semibold leading-tight">
        {title}
      </p>
      <svg ref={ref} className="max-w-full" />
    </div>
  );
}

export function EstoqueEtiquetasPanel({ companyId }: { companyId: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("company_id", companyId)
      .or("is_active.is.null,is_active.eq.true")
      .order("name");
    setLoading(false);
    setProducts((data ?? []) as Product[]);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const printLabels = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    const chosen = products.filter((p) => selected.has(p.id));
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Etiquetas</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 12mm; }
        @media print { body { padding: 4mm; } }
      </style></head><body>
      ${chosen
        .map((p) => {
          return `<div class="sheet" style="page-break-inside:avoid;margin-bottom:12mm;text-align:center;">
            <div style="font-weight:600;margin-bottom:6px;">${escapeHtml(p.name)}</div>
            <svg id="b-${p.id}"></svg>
          </div>`;
        })
        .join("")}
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
      <script>
        ${chosen
          .map((p) => {
            const code = String(
              p.barcode?.trim() || p.sku?.trim() || p.id.replace(/-/g, "").slice(0, 12),
            );
            return `try{JsBarcode("#b-${p.id}", ${JSON.stringify(code)}, {format:"CODE128", width:1.8, height:56, displayValue:true});}catch(e){}`;
          })
          .join("\n")}
        window.onload = function() { setTimeout(function() { window.print(); window.close(); }, 300); };
      </script>
    </body></html>`;
    w.document.write(html);
    w.document.close();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Tag className="h-4 w-4" />
          Impressão de etiquetas
        </CardTitle>
        <CardDescription>
          Selecione os produtos e imprima etiquetas com código de barras (usa
          o campo código de barras, ou SKU, ou um trecho do ID). Edite o código
          de barras no cadastro do produto quando necessário.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={printLabels}
            disabled={selected.size === 0}
          >
            <Printer className="mr-2 h-4 w-4" />
            Imprimir selecionados
          </Button>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {products.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm"
              >
                <input
                  type="checkbox"
                  className="mt-1 rounded border-input"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                />
                <div>
                  <span className="font-medium">{p.name}</span>
                  <p className="text-xs text-muted-foreground">
                    {p.sku ? `SKU ${p.sku}` : ""}
                    {p.barcode ? ` · Barras ${p.barcode}` : ""}
                  </p>
                </div>
              </label>
            ))}
          </div>
        )}
        {selected.size > 0 && (
          <div className="rounded-lg border border-dashed bg-muted/20 p-4 print:hidden">
            <Label className="text-xs text-muted-foreground">Pré-visualização</Label>
            <div className="mt-2 max-w-sm rounded-md border bg-card p-2">
              {products
                .filter((p) => selected.has(p.id))
                .map((p) => {
                  const code = String(
                    p.barcode?.trim() ||
                      p.sku?.trim() ||
                      p.id.replace(/-/g, "").slice(0, 12),
                  );
                  return (
                    <BarcodeBlock key={p.id} code={code} title={p.name} />
                  );
                })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
