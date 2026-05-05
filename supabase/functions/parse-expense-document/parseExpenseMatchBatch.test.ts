import { assertEquals } from "jsr:@std/assert@1/assert-equals";
import { productMatchOptionsForNfeXmlUpload } from "./parseExpenseMatchBatch.ts";

Deno.test("NFe XML upload uses importBatch matcher options", () => {
  assertEquals(productMatchOptionsForNfeXmlUpload(), { importBatch: true });
});
