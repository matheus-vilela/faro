/**
 * Máscaras para inputs brasileiros
 */

const onlyDigits = (value: string) => value.replace(/\D/g, '')

/** CPF: 000.000.000-00 | CNPJ: 00.000.000/0001-00 */
export function maskCpfCnpj(value: string): string {
  const digits = onlyDigits(value)
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return digits
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

/** Telefone: (00) 0000-0000 (fixo) ou (00) 00000-0000 (celular) */
export function maskPhone(value: string): string {
  const digits = onlyDigits(value).slice(0, 11)
  if (digits.length === 0) return ''
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

/** CEP: 00000-000 */
export function maskCep(value: string): string {
  const digits = onlyDigits(value).slice(0, 8)
  if (digits.length <= 5) return digits
  return `${digits.slice(0, 5)}-${digits.slice(5)}`
}

/** CPF: 000.000.000-00 */
export function maskCpf(value: string): string {
  const digits = onlyDigits(value).slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

/** Data BR: DD/MM/AAAA (apenas dígitos) */
export function maskDateBr(value: string): string {
  const digits = onlyDigits(value).slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/** Converte dígitos ddmmaaaa ou máscara DD/MM/AAAA para YYYY-MM-DD. */
export function parseDateBrToIso(value: string): string | undefined {
  const digits = onlyDigits(value)
  if (digits.length !== 8) return undefined
  const dd = digits.slice(0, 2)
  const mm = digits.slice(2, 4)
  const yyyy = digits.slice(4, 8)
  const d = Number(dd)
  const m = Number(mm)
  const y = Number(yyyy)
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return undefined
  return `${yyyy}-${mm}-${dd}`
}

/** YYYY-MM-DD → DD/MM/AAAA para exibição */
export function formatIsoDateToBr(iso: string): string {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ""
  return `${m[3]}/${m[2]}/${m[1]}`
}

/** Remove formatação (apenas dígitos) */
export function unmask(value: string): string {
  return onlyDigits(value)
}
