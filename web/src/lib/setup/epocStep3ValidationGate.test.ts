import { describe, expect, it, vi } from "vitest";
import {
  normalizeEpocValidateLoginResponse,
  shouldValidateEpocBeforeStep3Complete,
} from "./epocStep3ValidationGate";

describe("shouldValidateEpocBeforeStep3Complete", () => {
  it("returns false when mode is no", () => {
    expect(
      shouldValidateEpocBeforeStep3Complete(
        { mode: "no" },
        {
          hasResolvedPassword: true,
          baseUrlTrimmed: "https://x.com",
          usernameTrimmed: "u",
        },
      ),
    ).toBe(false);
  });

  it("returns false when mode is undecided", () => {
    expect(
      shouldValidateEpocBeforeStep3Complete(
        { mode: "undecided" },
        {
          hasResolvedPassword: true,
          baseUrlTrimmed: "https://x.com",
          usernameTrimmed: "u",
        },
      ),
    ).toBe(false);
  });

  it("returns false for credentials when integration is disabled", () => {
    expect(
      shouldValidateEpocBeforeStep3Complete(
        { mode: "credentials", enabled: false, username: "a" },
        {
          hasResolvedPassword: true,
          baseUrlTrimmed: "https://x.com",
          usernameTrimmed: "a",
        },
      ),
    ).toBe(false);
  });

  it("returns false when URL or user missing", () => {
    expect(
      shouldValidateEpocBeforeStep3Complete(
        { mode: "credentials", enabled: true },
        {
          hasResolvedPassword: true,
          baseUrlTrimmed: "",
          usernameTrimmed: "u",
        },
      ),
    ).toBe(false);
    expect(
      shouldValidateEpocBeforeStep3Complete(
        { mode: "credentials", enabled: true },
        {
          hasResolvedPassword: true,
          baseUrlTrimmed: "https://x.com",
          usernameTrimmed: "",
        },
      ),
    ).toBe(false);
  });

  it("returns false when password not resolved", () => {
    expect(
      shouldValidateEpocBeforeStep3Complete(
        { mode: "credentials", enabled: true },
        {
          hasResolvedPassword: false,
          baseUrlTrimmed: "https://x.com",
          usernameTrimmed: "u",
        },
      ),
    ).toBe(false);
  });

  it("returns true when credentials + enabled + fields ok", () => {
    expect(
      shouldValidateEpocBeforeStep3Complete(
        { mode: "credentials", enabled: true },
        {
          hasResolvedPassword: true,
          baseUrlTrimmed: "https://x.com",
          usernameTrimmed: "u",
        },
      ),
    ).toBe(true);
  });
});

describe("normalizeEpocValidateLoginResponse", () => {
  it("parses success", () => {
    expect(normalizeEpocValidateLoginResponse({ success: true })).toEqual({
      success: true,
    });
  });

  it("parses failure with known errorCode", () => {
    const r = normalizeEpocValidateLoginResponse({
      success: false,
      errorCode: "INVALID_CREDENTIALS",
      message: "bad",
    });
    expect(r).toEqual({
      success: false,
      errorCode: "INVALID_CREDENTIALS",
      message: "bad",
    });
  });

  it("maps unknown errorCode to UNKNOWN_ERROR", () => {
    const r = normalizeEpocValidateLoginResponse({
      success: false,
      errorCode: "OTHER",
      message: "x",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errorCode).toBe("UNKNOWN_ERROR");
    }
  });

  it("handles malformed body", () => {
    const r = normalizeEpocValidateLoginResponse(null);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errorCode).toBe("UNKNOWN_ERROR");
      expect(r.message).toMatch(/inválida/i);
    }
  });

  it("omite detalhe técnico de fase1 no texto exibido (card usa só título e lista)", () => {
    const r = normalizeEpocValidateLoginResponse({
      success: false,
      errorCode: "INVALID_CREDENTIALS",
      message:
        "Resposta de acoes.php (fase1) não contém id=ConteudoTela. Verifique credenciais, NaoMenu e o módulo configurado.",
    });
    expect(r).toEqual({
      success: false,
      errorCode: "INVALID_CREDENTIALS",
      message: "",
    });
  });

  it("omite mensagem genérica suprimida da edge", () => {
    const r = normalizeEpocValidateLoginResponse({
      success: false,
      errorCode: "INVALID_CREDENTIALS",
      message: "Verifique credenciais, NaoMenu e o módulo configurado.",
    });
    expect(r).toEqual({
      success: false,
      errorCode: "INVALID_CREDENTIALS",
      message: "",
    });
  });
});

describe("step 3 completion blocked on validation failure (simulated)", () => {
  it("does not proceed when invoke returns success false", async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: false,
      errorCode: "INVALID_CREDENTIALS",
      message: "nope",
    });
    const patchCompanyMaps = vi.fn();

    async function simulateConclude(
      shouldValidate: boolean,
    ): Promise<{ blocked: boolean }> {
      if (shouldValidate) {
        const v = await invoke();
        if (!v.success) {
          return { blocked: true };
        }
      }
      await patchCompanyMaps();
      return { blocked: false };
    }

    const gate = shouldValidateEpocBeforeStep3Complete(
      { mode: "credentials", enabled: true },
      {
        hasResolvedPassword: true,
        baseUrlTrimmed: "https://a",
        usernameTrimmed: "u",
      },
    );
    const out = await simulateConclude(gate);
    expect(out.blocked).toBe(true);
    expect(patchCompanyMaps).not.toHaveBeenCalled();
  });

  it("proceeds when invoke returns success", async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true });
    const patchCompanyMaps = vi.fn().mockResolvedValue(undefined);

    async function simulateConclude(shouldValidate: boolean): Promise<void> {
      if (shouldValidate) {
        const v = await invoke();
        if (!v.success) return;
      }
      await patchCompanyMaps();
    }

    await simulateConclude(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(patchCompanyMaps).toHaveBeenCalledTimes(1);
  });
});
