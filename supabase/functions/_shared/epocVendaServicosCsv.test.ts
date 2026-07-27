import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildVendaServicosConsolidatedCsv,
  extractVendaServicosRowsFromAcoesHtml,
} from "./epocVendaServicosCsv.ts";

const SAMPLE = `
<div id="ConteudoTela">
  <table id="tblExport">
    <thead>
      <tr>
        <th>Código</th><th>Serviço</th><th>Quant.</th><th>Total(R$)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>257</td><td>GORJETA CONCEDIDA</td><td>56</td><td>2.223,77</td>
      </tr>
    </tbody>
  </table>
  <div class="col-md-6">
    <table>
      <thead>
        <tr><th>Descrição</th><th>Valores(R$)</th></tr>
      </thead>
      <tbody>
        <tr><td><b>Total Potencial</b></td><td><b>2.225,17</b></td></tr>
        <tr><td><b>Total Recebido</b></td><td><b>2.177,38</b></td></tr>
      </tbody>
    </table>
  </div>
</div>
`;

Deno.test("extractVendaServicosRowsFromAcoesHtml: itens + resumo", () => {
  const day = extractVendaServicosRowsFromAcoesHtml(SAMPLE, "25/07/2026");
  assertEquals(day.itensCount, 1);
  assertEquals(day.resumoCount, 2);
  assertEquals(day.rows.some((r) => r[1] === "itens" && r[2] === "257"), true);
  assertEquals(
    day.rows.some((r) => r[1] === "resumo" && r[2] === "Total Recebido"),
    true,
  );
  const built = buildVendaServicosConsolidatedCsv([day]);
  assertStringIncludes(built.csv, "data_consulta;secao;col_1");
  assertStringIncludes(built.csv, "itens;257;GORJETA CONCEDIDA");
  assertEquals(built.totalItens, 1);
});
