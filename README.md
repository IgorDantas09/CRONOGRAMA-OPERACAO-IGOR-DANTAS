# Agro Cronograma Web

Aplicação web em React + Vite para gerar cronogramas de operações agrícolas a partir de uma planilha de plantio.

## O que o sistema faz

- Lê um arquivo Excel com a base de plantio.
- Calcula a **data de plantio do talhão** como o primeiro dia em que o acumulado de `Área Plantada(ha)` atinge **70%** da `Área Total(ha)`.
- Identifica automaticamente as **variedades** e pede os parâmetros:
  - Dias para germinação
  - Ciclo total em dias
- Simula três tipos de operação:
  - Adubação
  - Pulverização
  - Colheita
- Permite cadastrar o **parque de máquinas** com:
  - Modelo
  - Número de máquinas
  - Rendimento em ha/dia
- Gera gráficos de **Programação Total x Capacidade**.
- Gera tabela de períodos em que a capacidade **atende** ou **não atende** a demanda.

## Colunas esperadas no Excel

A primeira aba do arquivo deve conter estas colunas:

- Divisão
- Safra
- Ano Agrícola
- Cultura
- Fazenda
- Talhão
- Variedade
- Data Plantio
- Área Total(ha)
- Área Plantada(ha)

## Regra de cálculo

### 1) Data de plantio do talhão

Para cada talhão, o sistema ordena os registros por `Data Plantio` e soma `Área Plantada(ha)` até atingir 70% da `Área Total(ha)`.

### 2) Emergência

`Emergência = Data de Plantio + Dias para Germinação`

### 3) Operações

- **Adubação / Pulverização**: `Data da operação = Emergência + DAE`
- **Colheita**: `Data da operação = Emergência + Ciclo total`

### 4) Capacidade

A capacidade diária total é:

`Σ (Quantidade de máquinas × Rendimento ha/dia)`

A **capacidade acumulada** sobe diariamente, mas **não ultrapassa a demanda acumulada**. Isso reproduz a lógica que você mostrou nos gráficos manuais: a máquina trabalha apenas perante a demanda.

---

## Como rodar localmente

1. Instale o Node.js 20 ou superior.
2. Abra o projeto no VS Code.
3. No terminal, rode:

```bash
npm install
npm run dev
```

4. Abra no navegador o endereço mostrado pelo Vite.

## Build de produção

```bash
npm install
npm run build
```

O build final será gerado na pasta `dist`.

## Deploy na Vercel

A Vercel reconhece projetos Vite e normalmente configura automaticamente o framework, o comando de build e o diretório de saída. Em projetos Git, cada push gera deploy automático e preview deployment. Consulte a documentação oficial da Vercel e do GitHub.
