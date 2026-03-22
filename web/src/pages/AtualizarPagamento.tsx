import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ACCOUNT_TYPES = [
  { value: 'conta_corrente', label: 'Conta corrente' },
  { value: 'poupanca', label: 'Poupança' },
]

const PIX_TYPES = [
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
  { value: 'random', label: 'Chave aleatória' },
]

export function AtualizarPagamento() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [bankName, setBankName] = useState('')
  const [bankCode, setBankCode] = useState('')
  const [agency, setAgency] = useState('')
  const [account, setAccount] = useState('')
  const [accountType, setAccountType] = useState('conta_corrente')
  const [pixKey, setPixKey] = useState('')
  const [pixType, setPixType] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('Link inválido')
      setLoading(false)
      return
    }
    const load = async () => {
      const { data, error: err } = await supabase.rpc('get_supplier_update_form', {
        p_token: token,
      })
      if (err) {
        setError('Erro ao carregar')
        setLoading(false)
        return
      }
      const res = data as {
        error?: string
        supplier_name?: string
        bank_name?: string
        bank_code?: string
        agency?: string
        account?: string
        account_type?: string
        pix_key?: string
        pix_type?: string
      } | null
      if (res?.error) {
        setError(res.error)
        setLoading(false)
        return
      }
      setSupplierName(res?.supplier_name ?? '')
      setBankName(res?.bank_name ?? '')
      setBankCode(res?.bank_code ?? '')
      setAgency(res?.agency ?? '')
      setAccount(res?.account ?? '')
      setAccountType(res?.account_type ?? 'conta_corrente')
      setPixKey(res?.pix_key ?? '')
      setPixType(res?.pix_type ?? '')
      setLoading(false)
    }
    load()
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('complete_supplier_payment_update', {
      p_token: token,
      p_bank_name: bankName.trim(),
      p_bank_code: bankCode.trim(),
      p_agency: agency.trim(),
      p_account: account.trim(),
      p_account_type: accountType,
      p_pix_key: pixKey.trim(),
      p_pix_type: pixType || null,
    })
    setSaving(false)
    if (err) {
      setError('Erro ao salvar')
      return
    }
    const res = data as { success?: boolean; error?: string }
    if (!res?.success) {
      setError(res?.error ?? 'Erro ao salvar')
      return
    }
    setSuccess(true)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error && !success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Link inválido ou expirado</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Entre em contato com quem solicitou para receber um novo link.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Informações salvas</CardTitle>
            <CardDescription>
              Suas informações de pagamento foram atualizadas com sucesso.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Este link não pode mais ser utilizado.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>Atualizar dados de pagamento</CardTitle>
          <CardDescription>
            {supplierName && `Fornecedor: ${supplierName}`}
            <br />
            Preencha seus dados bancários ou PIX. Este link é válido para uma única atualização.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Banco</Label>
                <Input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="Nome do banco"
                />
              </div>
              <div>
                <Label>Código do banco</Label>
                <Input
                  value={bankCode}
                  onChange={(e) => setBankCode(e.target.value)}
                  placeholder="001"
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Agência</Label>
                <Input
                  value={agency}
                  onChange={(e) => setAgency(e.target.value)}
                  placeholder="0000"
                />
              </div>
              <div>
                <Label>Conta</Label>
                <Input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="00000-0"
                />
              </div>
            </div>
            <div>
              <Label>Tipo de conta</Label>
              <Select value={accountType} onValueChange={setAccountType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="border-t pt-4">
              <Label className="text-sm font-medium">PIX</Label>
              <div className="grid gap-2 mt-2 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Tipo da chave</Label>
                  <Select value={pixType} onValueChange={setPixType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {PIX_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Chave PIX</Label>
                  <Input
                    value={pixKey}
                    onChange={(e) => setPixKey(e.target.value)}
                    placeholder="Chave PIX"
                  />
                </div>
              </div>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
