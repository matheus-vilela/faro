# Dev Preview AI Context Matrix

Escopo desta matriz: **somente** `dev-preview-nfe-xml` (laboratório).

## Prioridade de Regras

1. Regra fixa de maço: `1 UN = 1 MCO`
2. Exceções de massa/volume da nota:
   - massa (`KG/G/MG`) => `1 UN = 100 G`
   - volume (`L/ML`) => `1 UN = 100 ML`
3. Embalagem composta no nome (ex.: `10B/400g`, `12x330ml`)
4. Unidade contável de nota (`PCT`, `CX`, `FD`, `SC`) sem medida composta:
   - `1 UN = 1 <UNIDADE_NOTA>`
   - Se o nome trouxer medida por item (ex.: `8 kg`), também `1 UN = 8 KG` (valor lido do nome).
5. Nota em `UN` + volume/peso explícito no nome (bebidas, etc.):
   - Ex.: `Cachaça Bakkana 750 ml`, `uCom=UN`, `qCom=24`
   - **Leitura:** cada unidade comercial da nota = uma garrafa de `750 ml`
   - **Saída:** `1 UN = 750 ML` (preferência por `ml` no rótulo quando equivalente a litros parseados)
   - Quantidade em UN de estoque-alvo: igual à quantidade da nota (`24`)
6. Fallback:
   - priorizar `UN` e revisão manual quando ambíguo

## Casos Curados (entrada => saída esperada)

### 1) Regra 1:1 para unidade contável

- **Entrada**: `CARVAO VEGETAL ...`, `uCom=PCT`, sem medida embutida útil
- **Saída**:
  - unidade principal sugerida: `UN`
  - conversão: `1 UN = 1 PCT`
  - quantidade em UN: igual à quantidade da nota

### 2) Embalagem composta com massa

- **Entrada**: `10B/400g`, `uCom=PCT`, `qCom=1`
- **Leitura**:
  - `10` bandejas × `400g` = `4000g` por `PCT`
  - regra base: `1 UN = 100g`
  - `4000g / 100g = 40 UN` por `PCT`
- **Saída**:
  - unidade principal sugerida: `UN`
  - conversão sugerida: `40 UN = 1 PCT`
  - quantidade em UN para a linha: `qCom * 40`

### 3) Embalagem composta com volume

- **Entrada**: `12x330ml`, `uCom=FD`, `qCom=2`
- **Leitura**:
  - `12 × 330ml = 3960ml` por `FD`
  - regra base: `1 UN = 100ml`
  - `3960 / 100 = 39.6 UN` por `FD`
- **Saída**:
  - unidade principal sugerida: `UN`
  - conversão sugerida: `39.6 UN = 1 FD`
  - quantidade em UN da linha: `2 * 39.6 = 79.2`

### 4) Exceção de massa da nota (sem unidade contável)

- **Entrada**: `uCom=KG`, qualquer nome
- **Saída**:
  - unidade principal sugerida: `UN`
  - conversão base: `1 UN = 100 G`

### 5) Exceção de volume da nota (sem unidade contável)

- **Entrada**: `uCom=ML` ou `uCom=L`, qualquer nome
- **Saída**:
  - unidade principal sugerida: `UN`
  - conversão base: `1 UN = 100 ML`

### 6) Nota em UN + conteúdo no nome (garrafa / embalagem)

- **Entrada**: `Cachaça Bakkana 750 ml`, `uCom=UN`, `qCom=24`
- **Saída**:
  - unidade principal sugerida: `UN`
  - conversão: `1 UN = 750 ML`
  - quantidade sugerida em UN: `24`

## Observações

- Esta matriz é referência de negócio para a IA no laboratório; não substitui regras financeiras/custo.
- Se houver cadastro existente com unidade principal **não `UN`**, a estratégia mantém a unidade existente e sugere apenas conversões faltantes.
