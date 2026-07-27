import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parsePtBrNumber,
  splitPaymentMethodLabel,
} from "./epocPtBrNumber.ts";

Deno.test("splitPaymentMethodLabel: sku - nome", () => {
  assertEquals(splitPaymentMethodLabel("66ad1d11ca7bb - AMEX_credito"), {
    sku: "66ad1d11ca7bb",
    name: "AMEX_credito",
  });
});

Deno.test("splitPaymentMethodLabel: sem hífen", () => {
  assertEquals(splitPaymentMethodLabel("Dinheiro"), {
    sku: "Dinheiro",
    name: "Dinheiro",
  });
});

Deno.test("parsePtBrNumber", () => {
  assertEquals(parsePtBrNumber("2.225,17"), 2225.17);
  assertEquals(parsePtBrNumber("-47,79"), -47.79);
  assertEquals(parsePtBrNumber("0,00"), 0);
});
