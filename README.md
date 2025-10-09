# 🔍 GitHub Accessibility Analyzer

> Sistema automatizado de mineração e análise de acessibilidade web em repositórios GitHub  
> **Projeto de TCC - Análise de Conformidade WCAG 2.2**

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-blue.svg)](https://github.com/features/actions)

---

## 📋 Visão Geral

Este projeto é um sistema completo para:

1. **🔍 Minerar** repositórios do GitHub que utilizam ferramentas de acessibilidade web
2. **🧪 Analisar** automaticamente a acessibilidade dessas aplicações usando múltiplas ferramentas
3. **📊 Gerar** métricas quantitativas sobre conformidade WCAG e qualidade de acessibilidade
4. **📈 Criar** um dataset para análise estatística e pesquisa acadêmica

### Ferramentas de Análise

- ✅ **AXE Core** - Testes rigorosos de acessibilidade via Puppeteer
- ✅ **Lighthouse CI** - Análise gratuita focada em acessibilidade (NOVO!)
- ✅ **GitHub API** - Mineração de repositórios via GraphQL

---

## 🚀 Quick Start

### Pré-requisitos

- Node.js 18+ ([Download](https://nodejs.org/))
- Token do GitHub ([Criar Token](https://github.com/settings/tokens))

### Instalação

```bash
# Clonar repositório
git clone https://github.com/[usuario]/scriptTCC2.git
cd scriptTCC2

# Instalar dependências
npm install

# Configurar token (opcional para testes locais)
export TOKEN_1="seu_token_aqui"  # Linux/Mac
$env:TOKEN_1="seu_token_aqui"    # Windows PowerShell
```

### Uso

```bash
# 1. Minerar repositórios do GitHub
npm run miner

# 2. Executar testes AXE
npm run tests

# 3. Executar análise Lighthouse CI (NOVO!)
npm run lighthouse
```

---

## 📁 Estrutura do Projeto

```
scriptTCC2/
├── 📄 script.js                    # Minerador principal (GraphQL)
├── 📄 run-tests.js                 # Runner de testes AXE
├── 📄 lighthouse-ci-runner.js      # Runner Lighthouse CI (NOVO!)
├── ⚙️  .lighthouserc.js            # Configuração Lighthouse (NOVO!)
├── 📦 package.json                 # Dependências Node.js
├── 📊 filtrados.csv                # Output: Repositórios filtrados (~200)
├── 📊 repositorios.json            # Output: Dados brutos de mineração
├── 📊 resultados_acessibilidade.csv # Output: Resultados AXE
├── 📊 lighthouse_ci_results.csv    # Output: Resultados Lighthouse (NOVO!)
├── 📊 lighthouse_ci_results.json   # Output: Detalhes completos (NOVO!)
├── 🔧 .github/workflows/           # Workflows CI/CD
├── 📚 memory-bank/                 # Documentação do projeto
└── 📖 README-LIGHTHOUSE.md         # Documentação Lighthouse (NOVO!)
```

---

## 🔧 Componentes

### 1. 🔍 GitHub Miner (`script.js`)

**Objetivo**: Minerar repositórios que utilizam ferramentas de acessibilidade

**Funcionalidades**:
- Busca via GraphQL com queries complexas
- Detecção de ferramentas em múltiplas linguagens (JS, Python, PHP, Java, C#, Ruby)
- Filtros inteligentes (bibliotecas vs aplicações web)
- Sistema de múltiplos tokens para evitar rate limits
- Persistência de progresso

**Ferramentas Detectadas**:
- AXE Core (axe-core, react-axe, jest-axe, etc.)
- Pa11y (pa11y, pa11y-ci, etc.)
- WAVE (wave, wave-cli, etc.)
- Lighthouse (lighthouse, lighthouse-ci, etc.)
- AChecker, Asqatasun, HTML CodeSniffer

**Execução**:
```bash
node script.js
# Output: filtrados.csv, repositorios.json
```

### 2. 🧪 AXE Test Runner (`run-tests.js`)

**Objetivo**: Executar testes de acessibilidade com AXE Core

**Funcionalidades**:
- Execução via Puppeteer (browser automation)
- Classificação por severidade (critical, serious, moderate, minor)
- Classificação por nível WCAG (A, AA, AAA)
- Cálculo de métricas (CER, Taxa de Sucesso)
- Busca automática de homepage via GitHub API

**Métricas Calculadas**:
- **Violações**: Erros críticos de acessibilidade
- **Warnings**: Avisos de potenciais problemas
- **CER**: Coverage of Error Ratio
- **Taxa de Sucesso**: % de critérios WCAG atendidos

**Execução**:
```bash
node run-tests.js
# Output: resultados_acessibilidade.csv
```

### 3. 🚦 Lighthouse CI Runner (`lighthouse-ci-runner.js`) **NOVO!**

**Objetivo**: Analisar acessibilidade usando Lighthouse CI (100% gratuito)

**Funcionalidades**:
- Execução local via @lhci/cli (sem custos)
- Foco em categoria de acessibilidade
- Score agregado 0-100
- Classificação por nível WCAG
- Output dual: CSV + JSON detalhado
- Integração com GitHub Actions

**Vantagens sobre Lighthouse API**:
- ✅ 100% gratuito (API tem custos)
- ✅ Sem limites de quota
- ✅ Execução local
- ✅ Configuração flexível

**Execução**:
```bash
node lighthouse-ci-runner.js
# Output: lighthouse_ci_results.csv, lighthouse_ci_results.json
```

**📖 Documentação Completa**: [README-LIGHTHOUSE.md](README-LIGHTHOUSE.md)

---

## 🤖 CI/CD com GitHub Actions

### Workflow: Lighthouse CI

**Arquivo**: `.github/workflows/lighthouse-ci.yml`

**Trigger**: Manual (`workflow_dispatch`)

**Funcionalidades**:
- Execução automática no GitHub Actions
- Timeout de 6 horas
- Upload de artifacts (CSV/JSON)
- Retention de 90 dias
- Opcional: commit automático de resultados

**Como Executar**:
1. Ir em **Actions** no GitHub
2. Selecionar **Lighthouse CI - Análise de Acessibilidade**
3. Clicar em **Run workflow**

---

## 📊 Resultados e Métricas

### Outputs Gerados

| Arquivo | Formato | Descrição |
|---------|---------|-----------|
| `filtrados.csv` | CSV | ~200 repositórios com ferramentas de acessibilidade |
| `repositorios.json` | JSON | Dados brutos de mineração |
| `resultados_acessibilidade.csv` | CSV | Resultados dos testes AXE |
| `lighthouse_ci_results.csv` | CSV | Resultados Lighthouse (tabular) |
| `lighthouse_ci_results.json` | JSON | Resultados Lighthouse (detalhado) |

### Métricas WCAG

Baseado em **WCAG 2.2** (58 critérios de sucesso):

- **Nível A**: Critérios básicos
- **Nível AA**: Critérios recomendados (padrão legal)
- **Nível AAA**: Critérios avançados

**Cobertura Automatizável**: ~44% dos critérios (segundo Abu Doush et al., 2023)

---

## 🔬 Análise de Dados

### Scripts de Análise (A Implementar)

```bash
# Análise estatística
python analyze-results.py

# Comparação de ferramentas
python compare-tools.py

# Geração de gráficos
python generate-charts.py
```

### Ferramentas Recomendadas

- **Python**: pandas, matplotlib, seaborn, scipy
- **R**: ggplot2, dplyr, tidyr
- **Excel/Google Sheets**: Exploração inicial

---

## 📚 Documentação

### Documentos Principais

- 📖 **[README-LIGHTHOUSE.md](README-LIGHTHOUSE.md)** - Guia completo do Lighthouse CI
- 📋 **[memory-bank/projectbrief.md](memory-bank/projectbrief.md)** - Visão geral do projeto
- 🏗️ **[memory-bank/systemPatterns.md](memory-bank/systemPatterns.md)** - Arquitetura e padrões
- 🔧 **[memory-bank/techContext.md](memory-bank/techContext.md)** - Stack técnica e setup
- 📊 **[memory-bank/progress.md](memory-bank/progress.md)** - Progresso e milestones

### Referências

- [WCAG 2.2 Guidelines](https://www.w3.org/WAI/WCAG22/quickref/)
- [AXE Core Documentation](https://github.com/dequelabs/axe-core)
- [Lighthouse CI Documentation](https://github.com/GoogleChrome/lighthouse-ci)
- [GitHub GraphQL API](https://docs.github.com/en/graphql)

---

## 🛠️ Tecnologias Utilizadas

### Core
- **Node.js 18+** - Runtime JavaScript
- **Puppeteer** - Browser automation
- **AXE Core** - Engine de testes de acessibilidade
- **Lighthouse CI** - Análise de acessibilidade

### APIs
- **GitHub GraphQL API** - Busca de repositórios
- **GitHub REST API** - Detalhes e conteúdo

### CI/CD
- **GitHub Actions** - Automação e workflows

### Formato de Dados
- **CSV** - Análise estatística
- **JSON** - Dados detalhados

---

## 📈 Status do Projeto

- ✅ **Mineração**: Completo
- ✅ **Análise AXE**: Completo
- ✅ **Lighthouse CI**: Completo (08/10/2025)
- 🔄 **Coleta de Dados**: Em andamento
- 📋 **Análise Estatística**: Planejado
- 📋 **TCC**: Em desenvolvimento

**Overall**: ~75% completo

---

## 🤝 Contribuições

Este é um projeto de TCC, mas sugestões e feedbacks são bem-vindos!

### Como Contribuir

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -am 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

---

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

---

## 👤 Autor

**Projeto de TCC** - Análise de Acessibilidade Web em Aplicações GitHub

**Orientação**: [Nome do Orientador]

**Instituição**: [Nome da Instituição]

---

## 🙏 Agradecimentos

- **Deque Systems** - AXE Core
- **Google Chrome Team** - Lighthouse
- **GitHub** - API e infraestrutura
- **W3C** - WCAG Guidelines
- **Comunidade Open Source**

---

## 📞 Contato

- GitHub: [@usuario](https://github.com/usuario)
- Email: email@exemplo.com

---

**Desenvolvido com ❤️ para melhorar a acessibilidade na web** ♿


