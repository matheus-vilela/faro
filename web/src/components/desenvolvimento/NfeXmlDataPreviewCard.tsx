import {
  ICMS_TOT_COLUMN_ORDER,
  TotalsMatrixTable,
  type TotalsMatrixRow,
} from "@/components/nfe/TotalsMatrixTable";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FileCode2 } from "lucide-react";
import type { ReactNode } from "react";

export type NfeXmlTaxTotals = Record<string, number | null>;

export type NfeXmlDataPreview = {
  chave_nfe: string;
  fornecedor: { nome: string | null; documento: string | null };
  valor_total_nota: number | null;
  numero_nota: string | null;
  serie: string | null;
  data_emissao: string | null;
  produtos: Array<{
    nome: string;
    codigo: string | null;
    ncm: string | null;
    cfop: string | null;
    csosn: string | null;
    ean: string | null;
    quantidade: number;
    valor_unitario: number;
    valor_total_linha: number;
    unidade_comercial: string | null;
    unidade_tributavel: string | null;
    quantidade_comercial: number | null;
    quantidade_tributavel: number | null;
  }>;
  impostos: NfeXmlTaxTotals | null;
  cobranca_boletos: Array<{
    numero_duplicata: string | null;
    vencimento: string;
    valor: number;
  }>;
  parse_ok: boolean;
  parse_erro?: string;
};

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return BRL.format(v);
}

function qty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const r = Math.round(v * 1_000_000) / 1_000_000;
  return String(r);
}

const ICMSTOT_LABELS: Record<string, string> = {
  vBC: "Base ICMS",
  vICMS: "ICMS",
  vICMSDeson: "ICMS desonerado",
  vFCP: "FCP",
  vBCST: "Base ST",
  vST: "ICMS ST",
  vFCPST: "FCP ST",
  vProd: "Produtos",
  vFrete: "Frete",
  vSeg: "Seguro",
  vDesc: "Desconto",
  vII: "II",
  vIPI: "IPI",
  vIPIDevol: "IPI devolvido",
  vPIS: "PIS",
  vCOFINS: "COFINS",
  vOutro: "Outras despesas",
  vNF: "Total NF (vNF)",
  vTotTrib: "Total tributos",
};

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : "text-sm font-medium"}>
        {value}
      </dd>
    </div>
  );
}

export type NfeXmlDetLinePreview = {
  n_item: string | null;
  c_prod: string | null;
  x_prod: string | null;
  prod: Record<string, unknown>;
};

function num(v: unknown): number | null {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function NfeXmlDataPreviewCard({
  fileName,
  xmlData,
  detLines,
}: {
  fileName?: string;
  xmlData: NfeXmlDataPreview;
  detLines?: NfeXmlDetLinePreview[];
}) {
  const imp = xmlData.impostos;
  const icmsTotRows: TotalsMatrixRow[] = imp
    ? Object.entries(imp)
        .filter(([, v]) => v != null && Number.isFinite(Number(v)))
        .map(([key, val]) => ({
          key,
          label: ICMSTOT_LABELS[key] ?? key,
          value: Number(val),
        }))
    : [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileCode2 className="h-4 w-4" />
          Dados extraídos do XML
        </CardTitle>
        <CardDescription>
          Leitura determinística via{" "}
          <code className="rounded bg-muted px-1 text-xs">parseNfeXml</code>
          {fileName ? (
            <>
              {" "}
              — ficheiro <span className="font-mono">{fileName}</span>
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Fornecedor" value={xmlData.fornecedor.nome ?? "—"} />
          <Field
            label="CNPJ/CPF"
            value={xmlData.fornecedor.documento ?? "—"}
            mono
          />
          <Field
            label="Total da nota"
            value={money(xmlData.valor_total_nota)}
          />
          <Field
            label="Nº / série"
            value={`${xmlData.numero_nota ?? "—"} / ${xmlData.serie ?? "—"}`}
            mono
          />
          <Field label="Emissão" value={xmlData.data_emissao ?? "—"} />
          <Field label="Chave NF-e" value={xmlData.chave_nfe || "—"} mono />
        </dl>

        {icmsTotRows.length > 0 ? (
          <TotalsMatrixTable
            title="ICMSTot (totais da nota)"
            rows={icmsTotRows}
            formatValue={money}
            columnOrder={ICMS_TOT_COLUMN_ORDER}
          />
        ) : null}

        {xmlData.cobranca_boletos.length > 0 ? (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Cobrança (duplicatas)</h4>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="p-2 font-medium">Dup.</th>
                    <th className="p-2 font-medium">Vencimento</th>
                    <th className="p-2 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {xmlData.cobranca_boletos.map((d, i) => (
                    <tr key={i} className="border-b border-border/60">
                      <td className="p-2 font-mono text-xs">
                        {d.numero_duplicata ?? "—"}
                      </td>
                      <td className="p-2 font-mono text-xs">{d.vencimento}</td>
                      <td className="p-2 text-right font-mono text-xs">
                        {money(d.valor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <h4 className="text-sm font-semibold">
            Produtos ({xmlData.produtos.length})
          </h4>
          {xmlData.produtos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma linha em det.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full caption-bottom border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="p-2 font-medium">Produto</th>
                    <th className="p-2 font-medium">cProd</th>
                    <th className="p-2 text-right font-medium">qCom</th>
                    <th className="p-2 font-medium">uCom</th>
                    <th className="p-2 text-right font-medium">qTrib</th>
                    <th className="p-2 font-medium">uTrib</th>
                    <th className="p-2 text-right font-medium">vUnCom</th>
                    <th className="p-2 text-right font-medium">vUnTrib</th>
                    <th className="p-2 text-right font-medium">vProd</th>
                    <th className="hidden p-2 font-medium md:table-cell">NCM</th>
                  </tr>
                </thead>
                <tbody>
                  {xmlData.produtos.map((p, i) => {
                    const det = detLines?.[i]?.prod;
                    const vUnCom = det ? num(det.vUnCom) : null;
                    const vUnTrib = det ? num(det.vUnTrib) : null;
                    const vDesc = det ? num(det.vDesc) : null;
                    return (
                      <tr key={i} className="border-b border-border/60">
                        <td className="max-w-[180px] p-2 text-xs leading-snug">
                          {p.nome}
                        </td>
                        <td className="p-2 font-mono text-xs">
                          {p.codigo ?? "—"}
                        </td>
                        <td className="p-2 text-right font-mono text-xs">
                          {qty(p.quantidade_comercial)}
                        </td>
                        <td className="p-2 font-mono text-xs">
                          {p.unidade_comercial ?? "—"}
                        </td>
                        <td className="p-2 text-right font-mono text-xs">
                          {qty(p.quantidade_tributavel)}
                        </td>
                        <td className="p-2 font-mono text-xs">
                          {p.unidade_tributavel ?? "—"}
                        </td>
                        <td className="p-2 text-right font-mono text-xs">
                          {money(vUnCom)}
                        </td>
                        <td className="p-2 text-right font-mono text-xs">
                          {money(vUnTrib)}
                        </td>
                        <td className="p-2 text-right font-mono text-xs">
                          {money(p.valor_total_linha)}
                          {vDesc != null && vDesc > 0 ? (
                            <span className="block text-[10px] text-destructive">
                              vDesc −{money(vDesc).replace("R$", "").trim()}
                            </span>
                          ) : null}
                        </td>
                        <td className="hidden p-2 font-mono text-xs md:table-cell">
                          {p.ncm ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            «Qtd» e «V. unit.» na extração seguem a regra de base UN quando
            uTrib = UN e uCom é distinta; vUnTrib aparece no breakdown de preço
            efetivo abaixo.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
