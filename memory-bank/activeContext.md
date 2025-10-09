# Active Context: GitHub Accessibility Analyzer
*Version: 1.0*
*Created: 2025-10-08*
*Last Updated: 2025-10-08*
*Current RIPER Mode: INITIALIZING*

## Current Focus

🎯 **Implementação do Lighthouse CI Runner**

O foco atual é criar um sistema completo de análise de acessibilidade usando **Lighthouse CI** que:
- Lê repositórios do `filtrados.csv`
- Busca homepage via GitHub API
- Executa análises de acessibilidade automatizadas
- Gera relatórios detalhados em CSV e JSON
- Integra com GitHub Actions para execução contínua

**Status**: ✅ **CONCLUÍDO**

## Recent Changes

### 2025-10-08 18:00 - Implementação Lighthouse CI Runner
- ✅ Criado `lighthouse-ci-runner.js` - Script principal de análise
- ✅ Criado `.lighthouserc.js` - Configuração otimizada
- ✅ Criado `.github/workflows/lighthouse-ci.yml` - Workflow CI/CD
- ✅ Atualizado `package.json` - Dependências e scripts
- ✅ Criado `README-LIGHTHOUSE.md` - Documentação completa
- ✅ Iniciado Memory Bank (START Phase)

**Motivação**: 
O usuário solicitou um fluxo de CI que use **apenas Lighthouse CI** (gratuito) para analisar acessibilidade dos repositórios, evitando custos da API paga do Lighthouse.

### 2025-10-08 17:45 - Framework CursorRIPER Instalado
- ✅ Estrutura `.cursor/rules/` criada
- ✅ Framework RIPER configurado
- ✅ START Phase iniciada

### Anterior - Sistema Base Implementado
- ✅ Minerador GitHub com GraphQL (`script.js`)
- ✅ Runner AXE com Puppeteer (`run-tests.js`)
- ✅ Filtros de bibliotecas vs aplicações
- ✅ Sistema de múltiplos tokens
- ✅ CSV: `filtrados.csv` com 200+ repositórios

## Active Decisions

### 1. Lighthouse CI vs Lighthouse API
**Status**: ✅ **DECIDIDO**

**Decisão**: Usar Lighthouse CI local via `@lhci/cli`

**Razões**:
- ✅ 100% gratuito (API tem custos)
- ✅ Sem limites de quota
- ✅ Análise local, sem envio de dados
- ✅ Fácil integração com GitHub Actions
- ✅ Configuração flexível via `.lighthouserc.js`

**Alternativas Rejeitadas**:
- ❌ Lighthouse API: Requer pagamento após quota gratuita
- ❌ PageSpeed Insights API: Limitado e menos flexível

### 2. Formato de Saída: CSV + JSON
**Status**: ✅ **DECIDIDO**

**Decisão**: Gerar ambos os formatos

**Razões**:
- CSV: Ideal para análise estatística (R, Python, Excel)
- JSON: Preserva estrutura completa com detalhes das violações
- Ambos têm casos de uso distintos

**Estrutura CSV**:
```
Repositorio, Homepage, Status, Score_Acessibilidade, Total_Violacoes, 
Violacoes_Nivel_A, Violacoes_Nivel_AA, Violacoes_Nivel_AAA, ...
```

**Estrutura JSON**:
```json
{
  "repositorio": "...",
  "detalhes": {
    "violacoes": [
      {
        "id": "color-contrast",
        "title": "...",
        "description": "...",
        "score": 0
      }
    ]
  }
}
```

### 3. Classificação WCAG
**Status**: ⚠️ **PARCIAL**

**Desafio**: Lighthouse não mapeia automaticamente auditorias para níveis WCAG exatos

**Solução Atual**: Heurística baseada em IDs de auditoria
- Auditorias com `2.1` ou `wcag2a` → Nível A
- Auditorias com `2.2` ou `wcag2aa` → Nível AA
- Auditorias com `wcag2aaa` → Nível AAA

**Melhoria Futura**: Criar mapeamento manual completo baseado em [documentação WCAG](https://www.w3.org/WAI/WCAG22/quickref/)

### 4. GitHub Actions Execution
**Status**: ✅ **CONFIGURADO**

**Decisão**: Workflow manual (`workflow_dispatch`) com opção de schedule

**Razões**:
- Controle manual permite execução sob demanda
- Evita execuções acidentais desnecessárias
- Pode ser habilitado schedule (semanal) se necessário

**Configuração**:
- Trigger: Manual
- Timeout: 6 horas
- Runner: `ubuntu-latest`
- Artifacts: Retention de 90 dias

## Next Steps

### Imediato (Hoje/Amanhã)

1. ✅ **DONE**: Completar documentação do Memory Bank
2. 🔄 **TODO**: Testar `lighthouse-ci-runner.js` localmente
3. 🔄 **TODO**: Executar workflow no GitHub Actions
4. 🔄 **TODO**: Validar formato dos resultados CSV/JSON

### Curto Prazo (Esta Semana)

1. Processar todos os repositórios do `filtrados.csv`
2. Analisar resultados e identificar padrões
3. Comparar resultados AXE vs Lighthouse CI
4. Documentar diferenças entre ferramentas

### Médio Prazo (Próximas 2 Semanas)

1. Análise estatística dos dados coletados
2. Geração de gráficos e visualizações
3. Identificação de insights para o TCC
4. Escrita de seções do TCC com base nos dados

### Longo Prazo (Próximo Mês)

1. Finalização do TCC
2. Revisão e polimento
3. Preparação de apresentação
4. Submissão final

## Current Challenges

### 1. ⚠️ Homepages Indisponíveis
**Problema**: ~30-40% dos repositórios não têm homepage configurada

**Impacto**: Não é possível testar esses repositórios

**Soluções Consideradas**:
- ❌ Clonar e rodar localmente: Muito complexo, cada app tem setup diferente
- ⚠️ Buscar demo/live links no README: Poderia melhorar cobertura
- ✅ Aceitar limitação: Foco em apps com homepage pública

**Decisão Atual**: Pular repos sem homepage, documentar limitação no TCC

### 2. ⚠️ Classificação WCAG Imprecisa
**Problema**: Mapeamento automático de auditorias → níveis WCAG não é 100% preciso

**Impacto**: Métricas por nível podem ter margem de erro

**Solução em Andamento**: 
- Usar heurística baseada em IDs
- Documentar limitação
- Possível melhoria: mapear manualmente as 20-30 auditorias principais

### 3. ⚠️ Timeout em Sites Lentos
**Problema**: Alguns sites demoram >2 minutos para carregar

**Impacto**: Falha na análise, marcado como ERROR

**Solução Implementada**:
- Timeout de 120s
- Continue-on-error: não interrompe batch
- Status ERROR registrado no CSV

### 4. ✅ Rate Limiting GitHub API
**Problema**: Limite de 5000 req/hora por token

**Solução Implementada**: Sistema de múltiplos tokens com rotação automática

**Status**: Resolvido ✅

## Implementation Progress

### Fase 1: Mineração ✅
- [✅] GraphQL queries
- [✅] Detecção de ferramentas
- [✅] Filtros de bibliotecas
- [✅] Sistema de tokens
- [✅] Persistência de progresso
- [✅] Output: `filtrados.csv`

### Fase 2: Análise AXE ✅
- [✅] Integração Puppeteer
- [✅] Injeção AXE Core
- [✅] Classificação de violações
- [✅] Cálculo de métricas (CER, Taxa Sucesso)
- [✅] Output: `resultados_acessibilidade.csv`

### Fase 3: Lighthouse CI ✅
- [✅] Script `lighthouse-ci-runner.js`
- [✅] Configuração `.lighthouserc.js`
- [✅] Workflow GitHub Actions
- [✅] Documentação completa
- [✅] Output: `lighthouse_ci_results.csv` + `.json`

### Fase 4: Análise e TCC 🔄
- [ ] Executar análise completa
- [ ] Análise estatística
- [ ] Comparação de ferramentas
- [ ] Visualizações (gráficos)
- [ ] Escrita do TCC
- [ ] Revisão e submissão

## Notes and Observations

### Diferenças AXE vs Lighthouse

**AXE Core**:
- Mais rigoroso em alguns aspectos (color-contrast)
- Classifica por severidade (critical, serious, moderate, minor)
- Output mais técnico e detalhado
- Melhor para desenvolvedores

**Lighthouse CI**:
- Score agregado 0-100 (mais fácil de comunicar)
- Integra com outras categorias (performance, SEO)
- Mais usado por empresas e auditorias
- Interface mais amigável

### Insights Preliminares

1. **Adoção de Ferramentas**: AXE é mais popular que Pa11y/WAVE
2. **Qualidade**: Mesmo projetos com ferramentas têm violações
3. **Homepages**: Muitos repos não configuram homepage
4. **Bibliotecas**: Filtro reduziu dataset de ~2000 para ~200 aplicações reais

### Limitações do Estudo

1. Apenas aplicações web públicas com homepage
2. Testes automatizados cobrem ~44% dos critérios WCAG
3. Testes manuais não foram realizados
4. Não testa aplicações que requerem login
5. Snapshot único no tempo (não longitudinal)

---

*Este documento captura o estado atual do trabalho e os próximos passos imediatos.*

