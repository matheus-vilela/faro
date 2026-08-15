import {
  previewEpocFaturamentoInterpret,
  type EpocFaturamentoInterpretPreview,
  type Tabela3Totais,
  type Tabela5Grupo,
  type Tabela6Interpretacao,
} from "@/lib/epocFaturamentoInterpret";
import { cn } from "@/lib/utils";

function TotaisTable({ title, data }: { title: string; data: Tabela3Totais }) {
  const cells: { label: string; value: string }[] = [
    { label: "Linha na secção", value: String(data.linhaNaSecao) },
    { label: "col_2 (rótulo)", value: data.rotulo },
    { label: "Quantidade (col_3)", value: data.quantidade },
    { label: "Tot. Ent. (col_4)", value: data.totEnt },
    { label: "Tot. Cons. (col_5)", value: data.totCons },
    { label: "Produtos (col_6)", value: data.produtos },
    { label: "Serviços (col_7)", value: data.servicos },
    { label: "Taxas (col_8)", value: data.taxas },
    { label: "Total (col_9)", value: data.total },
    { label: "Média (col_10)", value: data.media },
  ];
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">{title}</h4>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <tbody>
            {cells.map((c) => (
              <tr key={c.label} className="border-b last:border-0">
                <th className="bg-muted/40 px-3 py-1.5 font-medium whitespace-nowrap">
                  {c.label}
                </th>
                <td className="px-3 py-1.5 font-mono tabular-nums">
                  {c.value || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GrupoTabela5({ title, data }: { title: string; data: Tabela5Grupo }) {
  const cells: { label: string; value: string }[] = [
    {
      label: `${data.rotuloInicio} (linha ${data.linhaInicio})`,
      value: data.valores,
    },
    {
      label: data.acrescimo
        ? `${data.acrescimo.rotulo} (linha ${data.acrescimo.linhaNaSecao})`
        : "(+) Acréscimo",
      value: data.acrescimo?.valor ?? "",
    },
    {
      label: data.estornos
        ? `${data.estornos.rotulo} (linha ${data.estornos.linhaNaSecao})`
        : "(-) Estornos",
      value: data.estornos?.valor ?? "",
    },
    {
      label: data.total
        ? `${data.total.rotulo} (linha ${data.total.linhaNaSecao})`
        : "Total",
      value: data.total?.valor ?? "",
    },
  ];
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">{title}</h4>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <tbody>
            {cells.map((c) => (
              <tr key={c.label} className="border-b last:border-0">
                <th className="bg-muted/40 px-3 py-1.5 font-medium whitespace-nowrap">
                  {c.label}
                </th>
                <td className="px-3 py-1.5 font-mono tabular-nums">
                  {c.value || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tabela6Block({ block }: { block: Tabela6Interpretacao }) {
  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {block.tituloSecao ?? block.secao}{" "}
          <span className="text-muted-foreground font-normal">
            ({block.secao} · {block.dataConsulta} · {block.totalLinhasSecao}{" "}
            linhas)
          </span>
        </p>
        {block.avisos.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-700 dark:text-amber-400">
            {block.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            Totais, Fiscal e Formas de Pagamento sem avisos.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">
          Totais (Descrição → Saldo Final)
        </h4>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-3 py-1.5 font-medium">Linha</th>
                <th className="px-3 py-1.5 font-medium">Chave</th>
                <th className="px-3 py-1.5 font-medium">col_1</th>
                <th className="px-3 py-1.5 font-medium">col_2</th>
              </tr>
            </thead>
            <tbody>
              {block.totais.map((r) => (
                <tr key={`${r.chave}-${r.linhaNaSecao}`} className="border-b last:border-0">
                  <td className="px-3 py-1.5 font-mono">{r.linhaNaSecao}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{r.chave}</td>
                  <td className="px-3 py-1.5">{r.rotulo}</td>
                  <td className="px-3 py-1.5 font-mono tabular-nums">
                    {r.valor || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {block.totaisNaoMapeados.length > 0 ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Não mapeados
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {block.totaisNaoMapeados.map((r) => (
                <li key={`nm-${r.linhaNaSecao}`}>
                  linha {r.linhaNaSecao}: {r.rotulo} ={" "}
                  <span className="font-mono">{r.valor || "—"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Fiscal</h4>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-3 py-1.5 font-medium">Linha</th>
                <th className="px-3 py-1.5 font-medium">Chave</th>
                <th className="px-3 py-1.5 font-medium">col_1</th>
                <th className="px-3 py-1.5 font-medium">Qtde (col_2)</th>
                <th className="px-3 py-1.5 font-medium">Valor (col_3)</th>
              </tr>
            </thead>
            <tbody>
              {block.fiscal.map((r) => (
                <tr key={`${r.chave}-${r.linhaNaSecao}`} className="border-b last:border-0">
                  <td className="px-3 py-1.5 font-mono">{r.linhaNaSecao}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{r.chave}</td>
                  <td className="px-3 py-1.5">{r.rotulo}</td>
                  <td className="px-3 py-1.5 font-mono tabular-nums">
                    {r.quantidade || "—"}
                  </td>
                  <td className="px-3 py-1.5 font-mono tabular-nums">
                    {r.valor || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Formas de Pagamento</h4>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-3 py-1.5 font-medium">Linha</th>
                <th className="px-3 py-1.5 font-medium">Forma (col_1)</th>
                <th className="px-3 py-1.5 font-medium">Operação (col_2)</th>
                <th className="px-3 py-1.5 font-medium">Valores (col_3)</th>
              </tr>
            </thead>
            <tbody>
              {block.formasPagamento.map((r) => (
                <tr key={`${r.forma}-${r.linhaNaSecao}`} className="border-b last:border-0">
                  <td className="px-3 py-1.5 font-mono">{r.linhaNaSecao}</td>
                  <td className="px-3 py-1.5">{r.forma}</td>
                  <td className="px-3 py-1.5 font-mono tabular-nums">
                    {r.operacao || "—"}
                  </td>
                  <td className="px-3 py-1.5 font-mono tabular-nums">
                    {r.valores || "—"}
                  </td>
                </tr>
              ))}
              {block.formasPagamentoTotal ? (
                <tr className="bg-muted/30 font-medium">
                  <td className="px-3 py-1.5 font-mono">
                    {block.formasPagamentoTotal.linhaNaSecao}
                  </td>
                  <td className="px-3 py-1.5">
                    {block.formasPagamentoTotal.forma}
                  </td>
                  <td className="px-3 py-1.5 font-mono tabular-nums">
                    {block.formasPagamentoTotal.operacao || "—"}
                  </td>
                  <td className="px-3 py-1.5 font-mono tabular-nums">
                    {block.formasPagamentoTotal.valores || "—"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function runEpocFaturamentoInterpret(
  text: string,
  fileName: string,
): EpocFaturamentoInterpretPreview {
  return previewEpocFaturamentoInterpret(text, fileName);
}

export function EpocFaturamentoInterpretResult({
  preview,
}: {
  preview: EpocFaturamentoInterpretPreview;
}) {
  return (
    <div className="space-y-6">
      <div className="text-muted-foreground space-y-1 text-sm">
        <p>
          Arquivo:{" "}
          <span className="text-foreground">{preview.fileName}</span>
          {" · "}
          {preview.totalLinhas} linha(s) · secções:{" "}
          {preview.secoes.join(", ") || "—"}
        </p>
        {!preview.ok && preview.error ? (
          <p className="text-destructive">{preview.error}</p>
        ) : null}
      </div>

      {preview.tabela3.map((block) => (
        <div
          key={`t3-${block.dataConsulta}-${block.secao}`}
          className="space-y-4 rounded-md border p-4"
        >
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {block.tituloSecao ?? block.secao}{" "}
              <span className="text-muted-foreground font-normal">
                ({block.secao} · {block.dataConsulta} ·{" "}
                {block.totalLinhasSecao} linhas)
              </span>
            </p>
            {block.avisos.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-700 dark:text-amber-400">
                {block.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                Rótulos nas linhas esperadas (5 / 7 / 14).
              </p>
            )}
          </div>

          <div className={cn("grid gap-4", "lg:grid-cols-3")}>
            {block.totalMasc ? (
              <TotaisTable title="TOTAL MASC:" data={block.totalMasc} />
            ) : (
              <p className="text-destructive text-sm">TOTAL MASC: ausente</p>
            )}
            {block.totalFem ? (
              <TotaisTable title="TOTAL FEM:" data={block.totalFem} />
            ) : (
              <p className="text-destructive text-sm">TOTAL FEM: ausente</p>
            )}
            {block.totalGeral ? (
              <TotaisTable title="Total Geral:" data={block.totalGeral} />
            ) : (
              <p className="text-destructive text-sm">Total Geral: ausente</p>
            )}
          </div>
        </div>
      ))}

      {preview.tabela5.map((block) => (
        <div
          key={`t5-${block.dataConsulta}-${block.secao}`}
          className="space-y-4 rounded-md border p-4"
        >
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {block.tituloSecao ?? block.secao}{" "}
              <span className="text-muted-foreground font-normal">
                ({block.secao} · {block.dataConsulta} ·{" "}
                {block.totalLinhasSecao} linhas)
              </span>
            </p>
            {block.avisos.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-700 dark:text-amber-400">
                {block.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                Produtos na linha 3; blocos Produtos e Serviços completos.
              </p>
            )}
          </div>

          <div className={cn("grid gap-4", "lg:grid-cols-2")}>
            {block.produtos ? (
              <GrupoTabela5 title="Produtos" data={block.produtos} />
            ) : (
              <p className="text-destructive text-sm">Bloco Produtos ausente</p>
            )}
            {block.servicos ? (
              <GrupoTabela5 title="Serviços" data={block.servicos} />
            ) : (
              <p className="text-destructive text-sm">Bloco Serviços ausente</p>
            )}
          </div>
        </div>
      ))}

      {preview.tabela6.map((block) => (
        <Tabela6Block
          key={`t6-${block.dataConsulta}-${block.secao}`}
          block={block}
        />
      ))}
    </div>
  );
}
