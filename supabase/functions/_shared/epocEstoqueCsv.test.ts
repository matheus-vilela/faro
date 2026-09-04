import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEstoqueSaidaCsv,
  extractEstoqueSaidaFromAcoesHtml,
} from "./epocEstoqueCsv.ts";

const SAMPLE = `
<div class="panel-body">
  <table id="tblExport" class="table">
    <thead>
      <tr>
        <th>Item de Estoque</th>
        <th>Ação</th>
        <th>Obs.</th>
        <th>Qtde</th>
        <th>Qtde por volume de saída</th>
        <th>Custo Total</th>
      </tr>
    </thead>
    <tbody>
      <tr class="clickable">
        <td colspan="5" class="grupo"><b>1 - BEBIDAS</b></td>
        <td><b>975,802</b></td>
      </tr>
      <tr class="collapse produtos 1">
        <td colspan="5" class="grupo"><b>1.1 - SOFT</b></td>
        <td><b>10,246</b></td>
      </tr>
      <tr class="collapse produtos 1">
        <td colspan="5" class="grupo"><b>1.1.2 - AGUAS</b></td>
        <td><b>0,912</b></td>
      </tr>
      <tr class="collapse produtos 1">
        <td>&nbsp;&nbsp; - 194 - AGUA COM GAS</td>
        <td>Saída</td>
        <td> - </td>
        <td>8,000 UN</td>
        <td>8,000</td>
        <td>R$ 2,400</td>
      </tr>
      <tr class="collapse produtos 1">
        <td>&nbsp;&nbsp; - 193 - AGUA MINERAL</td>
        <td>Saída</td>
        <td> - </td>
        <td>3,000 UN</td>
        <td>3,000</td>
        <td>R$ 0,960</td>
      </tr>
      <tr class="collapse produtos 1">
        <td colspan="5" class="grupo"><b>1.2 - ALCOOLICAS</b></td>
        <td><b>965,556</b></td>
      </tr>
      <tr class="collapse produtos 1">
        <td colspan="5" class="grupo"><b>1.2.1 - CERVEJAS/CHOPP</b></td>
        <td><b>178,441</b></td>
      </tr>
      <tr class="collapse produtos 1">
        <td>&nbsp;&nbsp; - 1452 - BALDE DE CERVEJA</td>
        <td>Saída</td>
        <td> - </td>
        <td>2,000 UN</td>
        <td>2,000</td>
        <td>R$ 0,000</td>
      </tr>
      <tr class="collapse produtos 1 bg-danger">
        <td>&nbsp;&nbsp; - 1452 - BALDE DE CERVEJA</td>
        <td>Estorno</td>
        <td> - </td>
        <td>1,000 UN</td>
        <td>1,000</td>
        <td>R$ 0,000</td>
      </tr>
      <tr class="clickable">
        <td colspan="5" class="grupo"><b>2 - COMIDAS</b></td>
        <td><b>124,268</b></td>
      </tr>
      <tr class="collapse produtos 2">
        <td colspan="5" class="grupo"><b>2.1 - BOLINHOS</b></td>
        <td><b>53,580</b></td>
      </tr>
      <tr class="collapse produtos 2">
        <td>&nbsp;&nbsp; - 1028 - BOLINHO CUPIM</td>
        <td>Saída</td>
        <td> - </td>
        <td>3,000 UN</td>
        <td>3,000</td>
        <td>R$ 53,580</td>
      </tr>
      <tr>
        <td colspan="5">Totais</td>
        <td><b>1.137,030</b></td>
      </tr>
    </tbody>
  </table>
</div>
`;

Deno.test("extractEstoqueSaidaFromAcoesHtml: só Saída + hierarquia", () => {
  const day = extractEstoqueSaidaFromAcoesHtml(SAMPLE, "03/09/2026");
  assertEquals(day.items.length, 4);
  assertEquals(day.otherActionCount, 1);
  assertEquals(day.items[0]?.sku, "194");
  assertEquals(day.items[0]?.nome, "AGUA COM GAS");
  assertEquals(day.items[0]?.categorias, ["BEBIDAS", "SOFT", "AGUAS"]);
  assertEquals(day.items[0]?.qtde, 8);
  assertEquals(day.items[0]?.qtde_unidade, "UN");
  assertEquals(day.items[0]?.qtde_volume_saida, 8);
  assertEquals(day.items[0]?.custo_total, 2.4);

  assertEquals(day.items[2]?.sku, "1452");
  assertEquals(day.items[2]?.categorias, ["BEBIDAS", "ALCOOLICAS", "CERVEJAS/CHOPP"]);

  assertEquals(day.items[3]?.sku, "1028");
  assertEquals(day.items[3]?.categorias, ["COMIDAS", "BOLINHOS"]);
  assertEquals(day.items[3]?.custo_total, 53.58);

  assertEquals(day.items.some((it) => it.acao === "Estorno"), false);
});

Deno.test("buildEstoqueSaidaCsv", () => {
  const day = extractEstoqueSaidaFromAcoesHtml(SAMPLE, "03/09/2026");
  const csv = buildEstoqueSaidaCsv(day.dataConsulta, day.items);
  assertEquals(csv.includes("sku;nome;categorias"), true);
  assertEquals(csv.includes("194;AGUA COM GAS"), true);
  assertEquals(csv.includes("Estorno"), false);
});
