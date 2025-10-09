# Technical Context: GitHub Accessibility Analyzer
*Version: 1.0*
*Created: 2025-10-08*
*Last Updated: 2025-10-08*

## Technology Stack

### Runtime Environment
- **Node.js**: 18+ (LTS)
- **npm**: 8+ (gerenciador de pacotes)
- **Sistema Operacional**: Windows 10, Linux (Ubuntu 20.04+), macOS

### Core Dependencies

#### Produção
```json
{
  "node-fetch": "^2.7.0",      // HTTP requests (compatível com Node.js 18)
  "csv-parser": "^3.0.0",       // Leitura de arquivos CSV
  "csv-writer": "^1.6.0",       // Escrita de arquivos CSV
  "axe-core": "^4.10.2",        // Engine de testes de acessibilidade
  "puppeteer": "^23.9.0"        // Automação de browser (Chrome/Chromium)
}
```

#### Desenvolvimento
```json
{
  "@lhci/cli": "^0.13.0"        // Lighthouse CI para análise local
}
```

### APIs Externas

#### GitHub API
- **GraphQL API**: `https://api.github.com/graphql`
  - Busca de repositórios
  - Paginação cursor-based
  - Rate limit: 5000 pontos/hora por token
  
- **REST API v3**: `https://api.github.com`
  - Detalhes de repositórios
  - Conteúdo de arquivos
  - Commits e branches
  - Rate limit: 5000 requisições/hora por token

**Autenticação**:
```bash
# Variáveis de ambiente
TOKEN_1=ghp_xxxxxxxxxxxxxxxxxxxx
TOKEN_2=ghp_xxxxxxxxxxxxxxxxxxxx  # opcional
TOKEN_3=ghp_xxxxxxxxxxxxxxxxxxxx  # opcional
```

### Ferramentas de Acessibilidade

#### 1. AXE Core
- **Versão**: 4.10.2
- **Método**: Injeção via Puppeteer
- **Cobertura**: ~44% dos critérios WCAG automatizáveis
- **Output**: JSON com violations, passes, incomplete

#### 2. Lighthouse CI
- **Versão**: 0.13.x
- **Método**: CLI local (@lhci/cli)
- **Categorias**: Accessibility, Performance, SEO, Best Practices
- **Output**: JSON Lighthouse Report (LHR)

### Development Environment Setup

#### Pré-requisitos

**Windows**:
```powershell
# Instalar Node.js 18+
winget install OpenJS.NodeJS.LTS

# Verificar instalação
node --version
npm --version

# Clonar repositório
git clone https://github.com/[usuario]/scriptTCC2.git
cd scriptTCC2

# Instalar dependências
npm install
```

**Linux (Ubuntu/Debian)**:
```bash
# Instalar Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Dependências do Chrome (para Puppeteer/Lighthouse)
sudo apt-get install -y \
  ca-certificates \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  lsb-release \
  wget \
  xdg-utils

# Clonar e instalar
git clone https://github.com/[usuario]/scriptTCC2.git
cd scriptTCC2
npm install
```

**macOS**:
```bash
# Instalar Node.js via Homebrew
brew install node@18

# Clonar e instalar
git clone https://github.com/[usuario]/scriptTCC2.git
cd scriptTCC2
npm install
```

## Technical Constraints

### 1. Rate Limiting
- **GitHub API**: 5000 pontos/hora por token
  - Query GraphQL consome 1-10 pontos dependendo da complexidade
  - REST requests consomem 1 ponto cada
- **Solução**: Sistema de múltiplos tokens com rotação automática

### 2. Timeout Constraints
- **GitHub Actions**: Máximo 6 horas por job
- **Puppeteer**: Timeout de 60s por página
- **Lighthouse CI**: Timeout de 120s por análise
- **Solução**: Checkpoints incrementais e resumo de execução

### 3. Memory Constraints
- **Puppeteer**: ~200-500MB por instância
- **Lighthouse**: ~300-600MB por análise
- **CSV Parsing**: Proporcional ao tamanho do arquivo
- **Solução**: Processar um repositório por vez, limpar após cada análise

### 4. Network Constraints
- **Homepages indisponíveis**: ~30-40% dos repositórios
- **Timeout de rede**: Alguns sites são muito lentos
- **Redirecionamentos**: Seguir automático (max 5)
- **Solução**: Continue-on-error, skip após timeout

### 5. Browser Automation Constraints
- **Headless mode**: Necessário para CI/CD
- **Sandbox**: Desabilitado no Docker/CI (`--no-sandbox`)
- **JavaScript**: Alguns sites requerem JS habilitado
- **Cookies/Auth**: Sites com login são pulados

## Build and Deployment

### Build Process

Não há build tradicional (projeto Node.js puro), mas há setup:

```bash
# 1. Instalar dependências
npm install

# 2. Configurar tokens (opcional para testes locais)
export TOKEN_1="seu_token_aqui"

# 3. Verificar arquivos de entrada
ls -la filtrados.csv repositorios.json
```

### Deployment Procedure

#### GitHub Actions (Recomendado)

1. **Configurar Secrets**:
   - `Settings` → `Secrets and variables` → `Actions`
   - Adicionar `TOKEN_2` e `TOKEN_3` (opcional)

2. **Executar Workflow**:
   - `Actions` → Selecionar workflow
   - `Run workflow` → `Run workflow`

3. **Download Artifacts**:
   - Após conclusão, baixar CSV/JSON dos artifacts

#### Execução Local

```bash
# Mineração
node script.js

# Testes AXE
node run-tests.js

# Lighthouse CI
node lighthouse-ci-runner.js
```

### CI/CD

#### Workflows GitHub Actions

**1. Lighthouse CI** (`.github/workflows/lighthouse-ci.yml`):
- Trigger: Manual (`workflow_dispatch`)
- Runner: `ubuntu-latest`
- Timeout: 360 minutos (6 horas)
- Artifacts: CSV e JSON de resultados
- Secrets: `GITHUB_TOKEN`, `TOKEN_2`, `TOKEN_3`

**Execução**:
```yaml
jobs:
  lighthouse-analysis:
    runs-on: ubuntu-latest
    timeout-minutes: 360
    steps:
      - Checkout
      - Setup Node.js
      - Install dependencies
      - Run lighthouse-ci-runner.js
      - Upload artifacts
      - Commit results (opcional)
```

## Testing Approach

### Unit Testing
❌ **Não implementado** - Projeto focado em scripts de análise

### Integration Testing
✅ **Manual** - Testes de integração com GitHub API

### E2E Testing
✅ **Implícito** - Cada execução é um teste end-to-end

### Validation Testing
✅ **Implementado** - Validação de:
- Formato CSV de entrada
- Respostas da API GitHub
- Estrutura dos relatórios Lighthouse
- Classificação de violações WCAG

## File Structure

```
scriptTCC2/
├── .cursor/                    # Framework CursorRIPER
│   └── rules/
│       ├── core.mdc
│       ├── state.mdc
│       ├── start-phase.mdc
│       ├── riper-workflow.mdc
│       └── customization.mdc
├── .github/
│   └── workflows/
│       └── lighthouse-ci.yml   # Workflow CI/CD
├── .lighthouseci/              # Temp dir (gerado em runtime)
├── memory-bank/                # Documentação do projeto
│   ├── projectbrief.md
│   ├── systemPatterns.md
│   ├── techContext.md
│   ├── activeContext.md
│   └── progress.md
├── wave-extension/             # Extensão WAVE (referência)
├── script.js                   # Minerador principal
├── run-tests.js                # Runner AXE
├── lighthouse-ci-runner.js     # Runner Lighthouse CI (novo)
├── .lighthouserc.js            # Config Lighthouse (novo)
├── package.json                # Dependências Node.js
├── filtrados.csv               # Input: Repositórios filtrados
├── repositorios.json           # Output: Dados de mineração
├── repositorios_pulados.csv    # Output: Repos pulados
├── processed_repos.json        # State: Progresso
├── resultados_acessibilidade.csv  # Output: Resultados AXE
├── lighthouse_ci_results.csv   # Output: Resultados Lighthouse
├── lighthouse_ci_results.json  # Output: Detalhes Lighthouse
└── README-LIGHTHOUSE.md        # Documentação Lighthouse (novo)
```

## Configuration Files

### `.lighthouserc.js`
```javascript
module.exports = {
  ci: {
    collect: {
      numberOfRuns: 1,
      settings: {
        onlyCategories: ['accessibility'],
        chromeFlags: '--no-sandbox --headless --disable-gpu'
      }
    }
  }
};
```

### `package.json`
```json
{
  "name": "github-accessibility-analyzer",
  "scripts": {
    "miner": "node script.js",
    "lighthouse": "node lighthouse-ci-runner.js",
    "tests": "node run-tests.js"
  }
}
```

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `TOKEN_1` | ✅ Yes | GitHub Personal Access Token (primary) | `ghp_xxxxxxxxxxxx` |
| `TOKEN_2` | ⚠️ Optional | GitHub PAT (secondary, para rate limit) | `ghp_xxxxxxxxxxxx` |
| `TOKEN_3` | ⚠️ Optional | GitHub PAT (tertiary, para rate limit) | `ghp_xxxxxxxxxxxx` |

**Permissões necessárias do token**:
- ✅ `public_repo` (acesso a repositórios públicos)
- ✅ `read:org` (opcional, para organizações)

## Performance Considerations

### Otimizações Implementadas

1. **Cursor-based Pagination** (GraphQL)
   - Evita limite de 1000 resultados por query
   - Mais eficiente que offset-based

2. **Batch Processing**
   - Salva resultados a cada 5 repositórios
   - Evita perda de progresso

3. **Token Rotation**
   - Usa múltiplos tokens em paralelo
   - Continua mesmo com rate limit

4. **Headless Browser**
   - Chrome headless consome menos recursos
   - Flags otimizadas para CI

5. **Timeout Inteligente**
   - Skip após timeout individual
   - Não bloqueia batch inteiro

### Benchmarks

| Operação | Tempo Médio | Rate Limit Impact |
|----------|-------------|-------------------|
| GraphQL Search | 2-5s | 1-10 pontos |
| Get Repository | 1-2s | 1 ponto |
| Get File Content | 1-2s | 1 ponto |
| AXE Test | 10-30s | 0 pontos |
| Lighthouse CI | 30-90s | 0 pontos |

**Throughput estimado**:
- Mineração: ~100-200 repos/hora
- Análise AXE: ~10-20 repos/hora
- Análise Lighthouse: ~5-10 repos/hora

---

*Este documento descreve as tecnologias usadas no projeto e como elas estão configuradas.*

