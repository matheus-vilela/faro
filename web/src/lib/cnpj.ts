import { unmask } from "@/lib/masks";

/** Valida dígitos verificadores do CNPJ (14 dígitos). */
export function isValidCnpj(value: string): boolean {
  const c = unmask(value);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;

  let length = 12;
  let numbers = c.substring(0, length);
  const dv = c.substring(12);
  let sum = 0;
  let pos = length - 7;
  for (let i = length; i >= 1; i--) {
    sum += parseInt(numbers.charAt(length - i), 10) * pos--;
    if (pos < 2) pos = 9;
  }
  let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== parseInt(dv.charAt(0), 10)) return false;

  length = 13;
  numbers = c.substring(0, length);
  sum = 0;
  pos = length - 7;
  for (let i = length; i >= 1; i--) {
    sum += parseInt(numbers.charAt(length - i), 10) * pos--;
    if (pos < 2) pos = 9;
  }
  result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return result === parseInt(dv.charAt(1), 10);
}
