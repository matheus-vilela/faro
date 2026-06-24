import { describe, expect, it } from "vitest";
import {
  EPOC_REMOTE_CONNECTION_RESET_MESSAGE,
  humanizeEpocRemoteError,
  isEpocRemoteConnectionResetError,
} from "./epocRemoteErrorMessage";

describe("humanizeEpocRemoteError", () => {
  it("maps connection reset regardless of the configured EPOC base URL", () => {
    const urls = [
      "http://rac_coon.din.epoc.com.br:8751/acoes.php",
      "http://minha-loja.epoc.com.br:8751/acoes.php",
      "https://portal.cliente.com.br/index.php",
    ];
    for (const url of urls) {
      const raw = `error sending request from 10.0.0.1:12345 for ${url} (35.199.118.63:8751): client error (SendRequest): connection error: Connection reset by peer (os error 104)`;
      expect(isEpocRemoteConnectionResetError(raw)).toBe(true);
      expect(humanizeEpocRemoteError(raw)).toBe(
        EPOC_REMOTE_CONNECTION_RESET_MESSAGE,
      );
    }
  });

  it("keeps unrelated messages unchanged", () => {
    const raw = "Usuário ou senha inválidos.";
    expect(humanizeEpocRemoteError(raw)).toBe(raw);
  });
});
