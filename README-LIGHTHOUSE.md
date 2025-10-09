# 🚦 Lighthouse CI Runner - Análise de Acessibilidade

Sistema automatizado para análise de acessibilidade web usando **Lighthouse CI** nos repositórios do GitHub.

## 📋 Visão Geral

Este sistema:
1. ✅ Lê repositórios do arquivo `filtrados.csv`
2. ✅ Busca a homepage de cada repositório via GitHub API
3. ✅ Executa o **Lighthouse CI** focado em acessibilidade
4. ✅ Classifica violações por nível WCAG (A, AA, AAA)
5. ✅ Gera relatórios em CSV e JSON

## 🎯 Por que Lighthouse CI?

- **100% Gratuito**: Não há custos, ao contrário do Lighthouse API pago
- **Roda Localmente**: Sem limites de rate ou quotas
- **Foco em Acessibilidade**: Configurado para analisar apenas a categoria de acessibilidade
- **Integração CI/CD**: Funciona perfeitamente com GitHub Actions

## 🔧 Instalação

### Pré-requisitos
- Node.js 18+ 
- npm ou yarn
- Token do GitHub (para acessar API)

### Instalar Dependências

```bash
npm install
```

Ou instalar manualmente:

```bash
npm install node-fetch@2 csv-parser csv-writer @lhci/cli@0.13.x
```

## 🚀 Uso

### Executar Localmente

1. **Configure os tokens do GitHub** (opcional, mas recomendado):

```bash
# Windows PowerShell
$env:TOKEN_1="seu_token_aqui"

# Linux/Mac
export TOKEN_1="seu_token_aqui"
```

2. **Execute o script**:

```bash
node lighthouse-ci-runner.js
```

### Executar no GitHub Actions

O workflow está configurado em `.github/workflows/lighthouse-ci.yml`.

**Executar manualmente:**
1. Vá para **Actions** no GitHub
2. Selecione **Lighthouse CI - Análise de Acessibilidade**
3. Clique em **Run workflow**

**Configurar tokens (opcional):**
1. Vá em **Settings** → **Secrets and variables** → **Actions**
2. Adicione `TOKEN_2` e `TOKEN_3` (além do `GITHUB_TOKEN` padrão)

## 📊 Resultados

O script gera dois arquivos:

### 1. `lighthouse_ci_results.csv`
Formato tabular com as seguintes colunas:

| Coluna | Descrição |
|--------|-----------|
| `Repositorio` | Nome completo do repositório (owner/repo) |
| `Homepage` | URL da homepage encontrada |
| `Status` | `SUCCESS`, `SKIPPED_NO_HOMEPAGE`, ou `ERROR` |
| `Score_Acessibilidade` | Score de 0 a 1 |
| `Score_Display` | Score de 0 a 100 |
| `Total_Violacoes` | Número de violações críticas |
| `Total_Warnings` | Número de avisos |
| `Violacoes_Nivel_A` | Violações WCAG Nível A |
| `Violacoes_Nivel_AA` | Violações WCAG Nível AA |
| `Violacoes_Nivel_AAA` | Violações WCAG Nível AAA |
| `Violacoes_Indefinido` | Violações sem classificação WCAG |
| `Performance_Score` | Score de performance (0-100) |
| `Best_Practices_Score` | Score de boas práticas (0-100) |
| `SEO_Score` | Score de SEO (0-100) |

### 2. `lighthouse_ci_results.json`
Formato JSON detalhado incluindo:
- Todos os campos do CSV
- `detalhes.violacoes[]`: Array com detalhes de cada violação
  - `id`: ID da auditoria Lighthouse
  - `title`: Título da violação
  - `description`: Descrição detalhada
  - `score`: Score da auditoria (0 = violação)
- `detalhes.warnings[]`: Array com detalhes de cada aviso

## 🎛️ Configuração

### `.lighthouserc.js`

Arquivo de configuração do Lighthouse CI. Principais opções:

```javascript
{
  ci: {
    collect: {
      numberOfRuns: 1,  // Número de execuções por URL
      settings: {
        onlyCategories: ['accessibility'],  // Apenas acessibilidade
        emulatedFormFactor: 'desktop',      // desktop ou mobile
        chromeFlags: '--no-sandbox --headless'
      }
    }
  }
}
```

### Modificar para analisar outras categorias

Edite `.lighthouserc.js`:

```javascript
onlyCategories: ['accessibility', 'performance', 'seo', 'best-practices']
```

## 📈 Métricas WCAG

O sistema classifica violações por nível WCAG:

- **Nível A**: Critérios básicos de acessibilidade
- **Nível AA**: Critérios recomendados (padrão da maioria das leis)
- **Nível AAA**: Critérios avançados de acessibilidade

**Referência**: [WCAG 2.2 Guidelines](https://www.w3.org/WAI/WCAG22/quickref/)

## 🔍 Auditorias de Acessibilidade

Principais auditorias verificadas pelo Lighthouse:

| Auditoria | Descrição |
|-----------|-----------|
| `color-contrast` | Contraste de cores adequado |
| `image-alt` | Imagens têm texto alternativo |
| `button-name` | Botões têm nomes acessíveis |
| `label` | Inputs têm labels associados |
| `html-has-lang` | HTML tem atributo lang |
| `aria-*` | Atributos ARIA corretos |
| `document-title` | Documento tem título |
| `bypass` | Links de pular navegação |
| `heading-order` | Ordem lógica de headings |
| `link-name` | Links têm nomes descritivos |

Veja a lista completa em: [Lighthouse Accessibility Audits](https://web.dev/lighthouse-accessibility/)

## ⚠️ Troubleshooting

### Erro: "No homepage found"
Alguns repositórios não têm homepage configurada. O script pula automaticamente.

### Erro: "Lighthouse timeout"
Aumentar o timeout em `lighthouse-ci-runner.js`:
```javascript
timeout: 120000 // 2 minutos
```

### Erro: "Rate limit exceeded"
Adicione mais tokens GitHub nas variáveis de ambiente `TOKEN_2`, `TOKEN_3`.

### Chrome não encontrado
No Linux/CI, instale dependências:
```bash
sudo apt-get install -y libgbm-dev
```

## 🤝 Comparação com Outros Métodos

| Método | Custo | Limite | Facilidade |
|--------|-------|--------|-----------|
| **Lighthouse CI** | ✅ Grátis | ✅ Ilimitado | ✅ Fácil |
| Lighthouse API | 💰 Pago | ⚠️ 500/dia grátis | ✅ Fácil |
| AXE Core | ✅ Grátis | ✅ Ilimitado | ⚠️ Requer Puppeteer |
| Pa11y | ✅ Grátis | ✅ Ilimitado | ⚠️ Menos detalhado |

## 📚 Recursos

- [Lighthouse CI Documentation](https://github.com/GoogleChrome/lighthouse-ci)
- [Lighthouse Scoring Guide](https://web.dev/performance-scoring/)
- [WCAG 2.2 Guidelines](https://www.w3.org/WAI/WCAG22/quickref/)
- [Web Accessibility Initiative](https://www.w3.org/WAI/)

## 📝 Exemplo de Uso em TCC

Este sistema pode ser usado para:

1. **Mineração de Dados**: Coletar dados reais de acessibilidade web
2. **Análise Estatística**: Avaliar tendências de acessibilidade
3. **Comparação de Ferramentas**: Comparar AXE vs Lighthouse vs Pa11y
4. **Estudos de Caso**: Analisar repositórios populares
5. **Métricas de Qualidade**: Calcular CER, taxa de conformidade WCAG

## 🔄 Fluxo Completo

```
filtrados.csv → GitHub API → Lighthouse CI → Resultados (CSV/JSON)
     ↓              ↓              ↓                    ↓
  Repositórios   Homepages   Auditorias         Análise Estatística
```

## 📧 Suporte

Para dúvidas ou problemas:
1. Verifique os logs de execução
2. Consulte a documentação do Lighthouse CI
3. Abra uma issue no repositório

---

**Desenvolvido para TCC - Análise de Acessibilidade Web** 🎓

