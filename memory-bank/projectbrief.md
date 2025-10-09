# Project Brief: GitHub Accessibility Analyzer
*Version: 1.0*
*Created: 2025-10-08*
*Last Updated: 2025-10-08*

## Project Overview

Este é um sistema de **mineração e análise de acessibilidade web** desenvolvido como parte de um **Trabalho de Conclusão de Curso (TCC)**. O projeto analisa repositórios do GitHub para identificar a adoção de ferramentas de acessibilidade (como AXE, Pa11y, WAVE, Lighthouse, etc.) em aplicações web reais e, posteriormente, executa testes automatizados para avaliar a qualidade da acessibilidade dessas aplicações.

### Objetivos Principais

1. **Minerar repositórios GitHub** que utilizam ferramentas de acessibilidade web
2. **Analisar automaticamente** a acessibilidade dessas aplicações usando múltiplas ferramentas
3. **Gerar métricas quantitativas** sobre conformidade WCAG e qualidade de acessibilidade
4. **Criar um dataset** para análise estatística e pesquisa acadêmica
5. **Comparar diferentes ferramentas** de teste de acessibilidade (AXE, Lighthouse CI, etc.)

## Core Requirements

### Requisitos Funcionais

- ✅ **RF01**: Minerar repositórios GitHub usando GraphQL API
- ✅ **RF02**: Filtrar aplicações web (excluir bibliotecas, frameworks, CLI tools)
- ✅ **RF03**: Detectar ferramentas de acessibilidade em:
  - Arquivos de dependências (package.json, requirements.txt, composer.json, etc.)
  - Arquivos de configuração (.pa11yci.json, .lighthouserc.js, etc.)
  - Workflows do GitHub Actions
  - README e descrição do repositório
- ✅ **RF04**: Buscar homepage/URL de produção via GitHub API
- ✅ **RF05**: Executar testes de acessibilidade automatizados usando:
  - AXE Core (via Puppeteer)
  - Lighthouse CI (categoria acessibilidade)
- ✅ **RF06**: Classificar violações por nível WCAG (A, AA, AAA)
- ✅ **RF07**: Calcular métricas:
  - CER (Coverage of Error Ratio)
  - Taxa de Sucesso de Acessibilidade
  - Score Lighthouse (0-100)
- ✅ **RF08**: Exportar resultados em formato CSV e JSON
- ✅ **RF09**: Gerenciar múltiplos tokens GitHub para evitar rate limits
- ✅ **RF10**: Executar via GitHub Actions com timeout de ~6 horas

### Requisitos Não-Funcionais

- **RNF01**: Performance - Processar centenas de repositórios em batch
- **RNF02**: Confiabilidade - Continuar execução mesmo com falhas individuais
- **RNF03**: Escalabilidade - Suportar análise de milhares de repositórios
- **RNF04**: Reprodutibilidade - Resultados devem ser replicáveis
- **RNF05**: Gratuidade - Usar apenas ferramentas e APIs gratuitas
- **RNF06**: Documentação - Código documentado para uso acadêmico

## Success Criteria

- ✅ **SC01**: Minerar com sucesso pelo menos 200 repositórios com ferramentas de acessibilidade
- ✅ **SC02**: Executar testes automatizados em pelo menos 50% dos repositórios com homepage
- ✅ **SC03**: Gerar dataset completo com métricas WCAG
- ✅ **SC04**: Integração CI/CD funcional no GitHub Actions
- ✅ **SC05**: Taxa de erro inferior a 20% nas execuções
- ✅ **SC06**: Documentação completa do processo e resultados

## Scope

### In Scope

- ✅ Mineração de repositórios públicos do GitHub
- ✅ Análise de aplicações web com homepage configurada
- ✅ Testes automatizados de acessibilidade (AXE, Lighthouse CI)
- ✅ Classificação de violações WCAG
- ✅ Geração de relatórios CSV/JSON
- ✅ Execução via GitHub Actions
- ✅ Análise de múltiplas linguagens (JavaScript, Python, PHP, Java, C#, Ruby)
- ✅ Sistema de múltiplos tokens para rate limiting
- ✅ Detecção de ferramentas em workflows CI/CD

### Out of Scope

- ❌ Análise de repositórios privados
- ❌ Testes manuais de acessibilidade
- ❌ Correção automática de problemas de acessibilidade
- ❌ Interface gráfica (GUI)
- ❌ Clonagem e execução local de todos os repositórios (apenas homepages públicas)
- ❌ Análise de aplicações que requerem autenticação
- ❌ Testes de performance além dos fornecidos pelo Lighthouse
- ❌ Análise de aplicações mobile nativas

## Timeline

### Fase 1: Mineração (Concluída)
- ✅ Implementação do minerador GitHub
- ✅ Filtros de bibliotecas vs aplicações
- ✅ Sistema de múltiplos tokens
- ✅ Integração com GitHub Actions

### Fase 2: Análise AXE (Concluída)
- ✅ Script de testes com AXE Core
- ✅ Classificação por nível WCAG
- ✅ Cálculo de métricas (CER, Taxa de Sucesso)

### Fase 3: Lighthouse CI (Atual)
- ✅ Implementação do Lighthouse CI Runner
- ✅ Configuração otimizada para acessibilidade
- ✅ Workflow GitHub Actions
- ✅ Documentação completa

### Fase 4: Análise e Escrita (Próxima)
- 📝 Análise estatística dos resultados
- 📝 Comparação entre ferramentas (AXE vs Lighthouse)
- 📝 Escrita do TCC
- 📝 Geração de gráficos e visualizações

## Stakeholders

- **Aluno/Pesquisador**: Desenvolvedor principal e autor do TCC
- **Orientador TCC**: Supervisão acadêmica
- **Comunidade Open Source**: Beneficiários indiretos da pesquisa
- **Desenvolvedores Web**: Público-alvo das análises e recomendações

## Technical Context

### Tecnologias Utilizadas

- **Runtime**: Node.js 18+
- **APIs**: GitHub GraphQL API, GitHub REST API
- **Ferramentas de Acessibilidade**: AXE Core, Lighthouse CI
- **Automação**: Puppeteer (para AXE), @lhci/cli (para Lighthouse)
- **CI/CD**: GitHub Actions
- **Formato de Dados**: CSV, JSON

### Limitações Técnicas

- **Rate Limiting**: GitHub API tem limites de 5000 requisições/hora por token
- **Timeout**: GitHub Actions tem timeout de 6 horas por workflow
- **Acesso**: Apenas repositórios públicos e aplicações web sem autenticação
- **Dependências**: Requer Chrome/Chromium para Puppeteer e Lighthouse

## Data Sources

### Entrada
- `filtrados.csv`: Lista de repositórios minerados com ferramentas de acessibilidade

### Saída
- `repositorios_acessibilidade.csv`: Dados de mineração
- `resultados_acessibilidade.csv`: Resultados dos testes AXE
- `lighthouse_ci_results.csv`: Resultados dos testes Lighthouse CI
- `lighthouse_ci_results.json`: Resultados detalhados em JSON
- `processed_repos.json`: Controle de repositórios já processados

## References

### Standards
- [WCAG 2.2 Guidelines](https://www.w3.org/WAI/WCAG22/quickref/)
- [Web Accessibility Initiative (WAI)](https://www.w3.org/WAI/)

### Tools Documentation
- [AXE Core](https://github.com/dequelabs/axe-core)
- [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)
- [Puppeteer](https://pptr.dev/)
- [GitHub GraphQL API](https://docs.github.com/en/graphql)

### Academic References
- Abu Doush et al. (2023) - Automação de testes WCAG (44% de critérios automatizáveis)
- WCAG 2.2 - Total de 58 critérios de sucesso

---

*Este documento serve como fundação para o projeto e informa todos os outros arquivos de memória.*

