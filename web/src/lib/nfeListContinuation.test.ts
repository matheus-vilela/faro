import { describe, expect, it } from "vitest";
import {
  maxItemFocusVersion,
  resolveFetchPageContinuation,
} from "../../../supabase/functions/_shared/nfePipeline/listContinuation.ts";

describe("maxItemFocusVersion", () => {
  it("devolve o maior versao dos itens", () => {
    expect(
      maxItemFocusVersion([{ versao: 10 }, { versao: "42" }, { versao: 7 }]),
    ).toBe(42);
  });

  it("ignora itens sem versao", () => {
    expect(maxItemFocusVersion([{ chave_nfe: "x" }])).toBeNull();
  });
});

describe("resolveFetchPageContinuation", () => {
  it("continua quando x-max-version falta mas os itens avançam o cursor", () => {
    const r = resolveFetchPageContinuation({
      versao: 0,
      itemCount: 50,
      xTotalCount: 50,
      xMaxVersion: null,
      maxItemVersion: 8800,
    });
    expect(r.listDone).toBe(false);
    expect(r.nextVersao).toBe(8800);
  });

  it("usa o maior entre header e itens", () => {
    const r = resolveFetchPageContinuation({
      versao: 100,
      itemCount: 50,
      xTotalCount: 50,
      xMaxVersion: 100,
      maxItemVersion: 9400,
    });
    expect(r.listDone).toBe(false);
    expect(r.nextVersao).toBe(9400);
  });

  it("esgota numa página parcial sem avanço de cursor", () => {
    const r = resolveFetchPageContinuation({
      versao: 9400,
      itemCount: 12,
      xTotalCount: 12,
      xMaxVersion: 9400,
      maxItemVersion: 9400,
    });
    expect(r.listDone).toBe(true);
    expect(r.nextVersao).toBeNull();
  });

  it("não esgota página cheia sem cursor (não fecha onboarding aos 50)", () => {
    const r = resolveFetchPageContinuation({
      versao: 0,
      itemCount: 50,
      xTotalCount: 50,
      xMaxVersion: null,
      maxItemVersion: null,
    });
    expect(r.listDone).toBe(false);
    expect(r.nextVersao).toBeNull();
  });

  it("esgota quando x-total-count é 0", () => {
    expect(
      resolveFetchPageContinuation({
        versao: 12,
        itemCount: 0,
        xTotalCount: 0,
        xMaxVersion: null,
        maxItemVersion: null,
      }),
    ).toEqual({ listDone: true, nextVersao: null });
  });

  it("avança lista vazia se o header tiver versão maior", () => {
    const r = resolveFetchPageContinuation({
      versao: 10,
      itemCount: 0,
      xTotalCount: null,
      xMaxVersion: 50,
      maxItemVersion: null,
    });
    expect(r.listDone).toBe(false);
    expect(r.nextVersao).toBe(50);
  });
});
