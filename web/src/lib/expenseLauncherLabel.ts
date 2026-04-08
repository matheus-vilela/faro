/** Resposta de `get_expense_launcher_label` (JSONB). */
export type ExpenseLauncherRpcRow = {
  error?: string
  kind?: 'whatsapp' | 'platform'
  name?: string | null
  phone?: string | null
  user_name?: string | null
  missing_phone?: boolean
  anonymous?: boolean
}

/** Formata telefone só dígitos (E.164) para exibição BR quando não há phone_display. */
export function formatPhoneDigitsForDisplay(digits: string): string {
  const d = digits.replace(/\D/g, '')
  if (d.length >= 12 && d.startsWith('55')) {
    const rest = d.slice(2)
    if (rest.length >= 10) {
      const area = rest.slice(0, 2)
      const num = rest.slice(2)
      if (num.length === 9) {
        return `+55 (${area}) ${num.slice(0, 5)}-${num.slice(5)}`
      }
      if (num.length === 8) {
        return `+55 (${area}) ${num.slice(0, 4)}-${num.slice(4)}`
      }
    }
  }
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  }
  return digits
}

export function formatExpenseLauncherLine(row: ExpenseLauncherRpcRow | null): string {
  if (!row || row.error === 'forbidden' || row.error === 'not_found') {
    return '—'
  }
  if (row.kind === 'whatsapp') {
    if (row.missing_phone) {
      return 'WhatsApp — remetente não registrado no sistema'
    }
    const raw = (row.phone ?? '').trim()
    const digitsOnly = raw.replace(/\D/g, '')
    const phone =
      raw && raw === digitsOnly && digitsOnly.length >= 10
        ? formatPhoneDigitsForDisplay(digitsOnly)
        : raw
    if (row.name && phone) {
      return `${row.name} · ${phone}`
    }
    if (row.name) return row.name
    if (phone) return `WhatsApp · ${phone}`
    return 'WhatsApp'
  }
  if (row.kind === 'platform') {
    const who = row.user_name?.trim() || 'Usuário'
    return `${who} · Plataforma Faro`
  }
  return '—'
}
