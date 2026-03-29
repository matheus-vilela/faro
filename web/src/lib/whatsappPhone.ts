/**
 * Normalização alinhada ao backend / edge function (DDI 55, dígitos apenas).
 */

const DIGITS_ONLY = /^\d+$/

export type PhoneValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; error: string }

export function stripToDigits(input: string): string {
  let s = input.trim().replace(/\s+/g, '')
  if (s.startsWith('+')) s = s.slice(1)
  if (s.startsWith('00')) s = s.slice(2)
  return s.replace(/\D/g, '')
}

export function validateAndNormalizePhone(input: string): PhoneValidationResult {
  const raw = stripToDigits(input)
  if (!raw) {
    return { ok: false, error: 'Telefone é obrigatório.' }
  }
  if (!DIGITS_ONLY.test(raw)) {
    return { ok: false, error: 'Telefone contém caracteres inválidos.' }
  }

  let digits = raw

  if (digits.length === 10 || digits.length === 11) {
    const ddd = digits.slice(0, 2)
    const dddNum = Number.parseInt(ddd, 10)
    if (dddNum >= 11 && dddNum <= 99) {
      digits = `55${digits}`
    }
  }

  if (digits.length < 12 || digits.length > 15) {
    return {
      ok: false,
      error:
        'Telefone inválido: use DDI + DDD + número (ex.: +55 11 99999-8888).',
    }
  }

  if (!digits.startsWith('55')) {
    return {
      ok: false,
      error: 'Apenas números com DDI 55 (Brasil) são aceitos.',
    }
  }

  const national = digits.slice(2)
  if (national.length !== 10 && national.length !== 11) {
    return { ok: false, error: 'Formato nacional inválido após DDI 55.' }
  }

  return { ok: true, normalized: digits }
}

/** Exibição amigável a partir do normalizado (13 dígitos: 55 + DDD + 9 dígitos). */
export function formatNormalizedForDisplay(normalized: string): string {
  if (normalized.length === 13 && normalized.startsWith('55')) {
    const ddd = normalized.slice(2, 4)
    const num = normalized.slice(4)
    if (num.length === 9) {
      return `+55 (${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`
    }
    if (num.length === 8) {
      return `+55 (${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`
    }
  }
  return normalized
}

/**
 * Máscara para digitação:
 * - até 11 dígitos: só DDD + número — (DD) NNNN-NNNN ou (DD) NNNNN-NNNN
 * - mais de 11 dígitos: os dois primeiros são o DDI — +XX (DD) … (sem inserir 55)
 * Normalização (ex.: DDI 55) no save via validateAndNormalizePhone.
 */
const MAX_WHATSAPP_INPUT_DIGITS = 15

export function maskWhatsappBrInput(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 0) return ''

  if (digits.length <= 11) {
    return maskNationalBr(digits)
  }

  const int = digits.slice(0, MAX_WHATSAPP_INPUT_DIGITS)
  return maskInternationalBody(int)
}

/**
 * Atualiza a string só com dígitos a partir do valor do input mascarado.
 * Corrige backspace em `)`, `-` e espaços: o browser remove só o caractere de formatação,
 * mas a contagem de dígitos não muda — nesse caso remove o último dígito.
 */
export function applyWhatsappPhoneMaskChange(
  prevDigits: string,
  newValue: string,
): string {
  const prev = prevDigits.replace(/\D/g, '')
  const next = newValue.replace(/\D/g, '')
  if (next.length > prev.length) {
    return next.slice(0, MAX_WHATSAPP_INPUT_DIGITS)
  }
  if (next.length < prev.length) {
    return next.slice(0, MAX_WHATSAPP_INPUT_DIGITS)
  }
  const prevMasked = maskWhatsappBrInput(prev)
  if (newValue.length < prevMasked.length) {
    return prev.slice(0, -1)
  }
  return next.slice(0, MAX_WHATSAPP_INPUT_DIGITS)
}

/** Parte nacional: DDD (2) + 8 (fixo) ou 9 (celular). */
function maskNationalBr(digits: string): string {
  const ddd = digits.slice(0, 2)
  const num = digits.slice(2)
  if (digits.length <= 2) {
    return digits.length === 1 ? `(${digits}` : `(${ddd})`
  }
  if (num.length <= 4) {
    return `(${ddd}) ${num}`
  }
  if (num.length <= 8) {
    return `(${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`
  }
  return `(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`
}

/** int: primeiros 2 dígitos = DDI; em seguida DDD (2) + número local. */
function maskInternationalBody(int: string): string {
  const ddi = int.slice(0, 2)
  const rest = int.slice(2)
  const ddd = rest.slice(0, 2)
  const num = rest.slice(2)
  if (rest.length === 0) return `+${ddi}`
  if (rest.length === 1) return `+${ddi} (${rest}`
  if (rest.length === 2) return `+${ddi} (${ddd})`
  if (num.length <= 4) {
    return `+${ddi} (${ddd}) ${num}`
  }
  if (num.length <= 8) {
    return `+${ddi} (${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`
  }
  return `+${ddi} (${ddd}) ${num.slice(0, 5)}-${num.slice(5, 9)}`
}
