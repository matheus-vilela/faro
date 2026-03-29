# Telefones autorizados por empresa (WhatsApp / Z-API)

## Modelo de dados

| Onde | Campo | Uso |
|------|--------|-----|
| `companies` | `owner_whatsapp_normalized` | Telefone do proprietário (comparação no webhook) |
| `companies` | `owner_whatsapp_display` | Exibição opcional na UI |
| `company_members` | `phone_normalized`, `is_active`, … | Até **3 membros ativos** por empresa; inativos não autorizam |

O número da linha Z-API (`connectedPhone`) é **o mesmo para toda a plataforma** e **não** fica na tabela `companies`.

Regras no banco: limite de 3 ativos, unicidade de telefone entre membros ativos, telefone de membro ≠ telefone do owner. Migração: `20240321000018_company_whatsapp_authorization.sql`.

## Resolução no webhook

1. Normaliza o **remetente** (`phone` ou `participantPhone` em grupo).
2. Busca empresas em que esse número é **owner** ou **membro ativo**.
3. **0** empresas → 403 `SENDER_NOT_AUTHORIZED`.
4. **1** empresa → 200, `role` = `owner` ou `member`.
5. **2+** empresas → 409 `AMBIGUOUS_COMPANY` (mesmo telefone em mais de uma empresa).

`connectedPhone` no payload é só informativo (log / `connectedNormalized` na resposta quando válido).

## Configuração na UI

Em **Configurações → Usuários e membros** (`/app/configuracoes/usuarios-membros`), o proprietário cadastra nome, WhatsApp e membros (máscara +55; normalização ao salvar).

## API Node (`server/`) — se existir no repositório

Base: `http://localhost:8787` (ou `PORT`). Header: `Authorization: Bearer <JWT Supabase>`.

### PATCH `/api/companies/:companyId/owner-phone`

```json
{ "phone": "+55 11 98765-4321", "display": "(11) 98765-4321" }
```

### GET `/api/companies/:companyId/members`

### POST `/api/companies/:companyId/members`

```json
{
  "name": "Maria",
  "phone": "(11) 91234-5678",
  "phoneDisplay": "(11) 91234-5678",
  "isActive": true
}
```

### PATCH `/api/companies/:companyId/members/:memberId`

```json
{ "isActive": false }
```

## Edge function `received-whatsapp-message`

URL: `https://<PROJECT_REF>.supabase.co/functions/v1/received-whatsapp-message`

Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Opcional: `ZAPI_WEBHOOK_SECRET`.

### Exemplo de payload Z-API (trecho)

```json
{
  "type": "ReceivedCallback",
  "connectedPhone": "551133334444",
  "phone": "5511987654321",
  "fromMe": false,
  "isGroup": false,
  "messageId": "ABC123"
}
```

### Resposta autorizada (200)

```json
{
  "success": true,
  "processed": true,
  "companyId": "uuid",
  "role": "owner",
  "senderNormalized": "5511987654321",
  "connectedNormalized": "551133334444",
  "messageId": "ABC123",
  "type": "ReceivedCallback"
}
```

`connectedNormalized` pode ser `null` se `connectedPhone` estiver ausente ou inválido.

### Ambiguidade (409)

```json
{
  "success": false,
  "processed": false,
  "code": "AMBIGUOUS_COMPANY",
  "message": "Este telefone está associado a mais de uma empresa. Ajuste o cadastro para que seja único."
}
```

### Remetente não autorizado (403)

```json
{
  "success": false,
  "processed": false,
  "code": "SENDER_NOT_AUTHORIZED",
  "message": "Telefone do remetente não está autorizado em nenhuma empresa (proprietário ou membro ativo)."
}
```

## Testes

```bash
cd server && npm install && npm test
```
