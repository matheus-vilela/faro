import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildFaturamentoConsolidatedCsv,
  extractFaturamentoRowsFromAcoesHtml,
} from "./epocFaturamentoCsv.ts";

Deno.test("extractFaturamentoRowsFromAcoesHtml: secções e linhas", () => {
  const html = `
    <div id="ConteudoTela">
      <div id="spanImprimir">
        <b>Formas de pagamento</b>
        <table>
          <tr><th>Forma</th><th>Valor</th></tr>
          <tr><td>Dinheiro</td><td>10,00</td></tr>
        </table>
        <strong>Por categoria</strong>
        <table>
          <tr><td>Bebidas</td><td>5,00</td></tr>
        </table>
      </div>
    </div>
  `;
  const day = extractFaturamentoRowsFromAcoesHtml(html, "25/07/2026");
  assertEquals(day.secaoCount, 2);
  assertEquals(day.rowCount, 3);
  assertEquals(day.rows[0]?.[1], "Formas de pagamento");
  assertEquals(day.rows[0]?.[2], "Forma");
  assertEquals(day.rows[1]?.[3], "10,00");
  assertEquals(day.rows[2]?.[1], "Por categoria");

  const built = buildFaturamentoConsolidatedCsv([day]);
  assertEquals(built.totalRows, 3);
  assertEquals(built.maxCols, 2);
  assertStringIncludes(built.csv, "data_consulta;secao;col_1;col_2");
  assertStringIncludes(built.csv, "25/07/2026;Formas de pagamento;Forma;Valor");
});

Deno.test("extractFaturamentoRowsFromAcoesHtml: sem spanImprimir", () => {
  const day = extractFaturamentoRowsFromAcoesHtml("<div>vazio</div>", "01/01/2026");
  assertEquals(day.rowCount, 0);
  assertStringIncludes(day.message ?? "", "spanImprimir");
});
