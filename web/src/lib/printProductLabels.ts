export type PrintableProductLabel = {
  id: string;
  name: string;
  barcode?: string | null;
  sku?: string | null;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printProductLabels(products: PrintableProductLabel[]): boolean {
  if (products.length === 0) return false;
  const w = window.open("", "_blank");
  if (!w) return false;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Etiquetas</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 12mm; }
        @media print { body { padding: 4mm; } }
      </style></head><body>
      ${products
        .map((p) => {
          return `<div class="sheet" style="page-break-inside:avoid;margin-bottom:12mm;text-align:center;">
            <div style="font-weight:600;margin-bottom:6px;">${escapeHtml(p.name)}</div>
            <svg id="b-${p.id}"></svg>
          </div>`;
        })
        .join("")}
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
      <script>
        ${products
          .map((p) => {
            const code = String(
              p.barcode?.trim() ||
                p.sku?.trim() ||
                p.id.replace(/-/g, "").slice(0, 12),
            );
            return `try{JsBarcode("#b-${p.id}", ${JSON.stringify(code)}, {format:"CODE128", width:1.8, height:56, displayValue:true});}catch(e){}`;
          })
          .join("\n")}
        window.onload = function() { setTimeout(function() { window.print(); window.close(); }, 300); };
      </script>
    </body></html>`;
  w.document.write(html);
  w.document.close();
  return true;
}
