import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildProdutoSinteticoConsolidatedCsv,
  extractProdutoSinteticoRowsFromAcoesHtml,
  findTotalRecebidoColumnIndex,
} from "./epocProdutoSinteticoCsv.ts";

Deno.test("findTotalRecebidoColumnIndex", () => {
  assertEquals(
    findTotalRecebidoColumnIndex(["Produto", "Total recebido(R$)", "Qtde"]),
    1,
  );
  assertEquals(findTotalRecebidoColumnIndex(["Produto", "Qtde"]), -1);
});

Deno.test("extractProdutoSinteticoRowsFromAcoesHtml: filtra Total recebido", () => {
  const html = `
    <div id="ConteudoTela">
      <table id="tblExport">
        <tr><th>Produto</th><th>Total recebido(R$)</th></tr>
        <tr><td>A</td><td>10,00</td></tr>
        <tr><td>B</td><td></td></tr>
        <tr><td>C</td><td>5,50</td></tr>
      </table>
    </div>
  `;
  const day = extractProdutoSinteticoRowsFromAcoesHtml(html, "30/07/2026");
  assertEquals(day.rawRowCount, 3);
  assertEquals(day.rowCount, 2);
  assertEquals(day.rows[0]?.[0], "30/07/2026");
  assertEquals(day.rows[0]?.[1], "A");
  assertEquals(day.rows[1]?.[1], "C");
});

Deno.test("buildProdutoSinteticoConsolidatedCsv", () => {
  const built = buildProdutoSinteticoConsolidatedCsv([
    {
      dataConsulta: "30/07/2026",
      rowCount: 1,
      rawRowCount: 1,
      header: ["Produto", "Total recebido(R$)"],
      maxCols: 2,
      rows: [["30/07/2026", "A", "10,00"]],
    },
  ]);
  assertEquals(built.totalRows, 1);
  assertEquals(built.diasComDados, 1);
  assertEquals(built.header[0], "data_consumo");
  assertEquals(built.csv.includes("data_consumo"), true);
  assertEquals(built.csv.includes("A"), true);
});
