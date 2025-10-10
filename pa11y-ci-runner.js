const fs = require('fs');
const pa11y = require('pa11y');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Sitemapper precisa de import dinâmico (ES Module)
let Sitemapper;

/**
* Pa11y (HTML_CodeSniffer) CI Runner para Análise de Acessibilidade
* 
* Baseado no framework RIPER (Research, Implement, Polish, Extend, Review)
* Usa Pa11y (wrapper estável do HTML_CodeSniffer)
* 
* WCAG 2.1 - Total de critérios de sucesso: 78
* Este script testa conformidade com WCAG 2.1 níveis A, AA e AAA
*/

const WCAG_TOTAL_CRITERIA = 78;
const WCAG_AUTOMATIZAVEL = Math.round(WCAG_TOTAL_CRITERIA * 0.44); // ~34 critérios

// ----------------------
// Configurações
// ----------------------
const CONFIG = {
  // Número máximo de URLs a analisar por repositório
  MAX_URLS_PER_REPO: 5,
  
  // Se true, tenta buscar URLs do sitemap
  USE_SITEMAP: true,
  
  // Timeout para buscar sitemap (ms)
  SITEMAP_TIMEOUT: 10000,
  
  // Priorizar certas páginas (regex patterns)
  PRIORITY_PATTERNS: [
    /\/$/, // Homepage
    /\/about/i,
    /\/contact/i,
    /\/login/i,
  ],
  
  // Standard WCAG para testar (WCAG2A, WCAG2AA, WCAG2AAA)
  WCAG_STANDARD: 'WCAG2AA', // Padrão recomendado
  
  // Timeout para análise Pa11y
  PA11Y_TIMEOUT: 60000, // 60 segundos
};

// ----------------------
// Funções Pa11y (HTML_CodeSniffer)
// ----------------------
async function runPa11y(url, standard = CONFIG.WCAG_STANDARD) {
  console.log(`🚀 Iniciando Pa11y em ${url}`);
  try {
    // Configura Pa11y
    const results = await pa11y(url, {
      standard: standard,
      timeout: CONFIG.PA11Y_TIMEOUT,
      chromeLaunchConfig: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      },
      screenCapture: false, // Não precisa de screenshot
      wait: 500, // Aguarda 500ms após carregamento
    });
    
    // Processa resultados
    const issues = results.issues || [];
    
    const errors = issues.filter(i => i.type === 'error');
    const warnings = issues.filter(i => i.type === 'warning');
    const notices = issues.filter(i => i.type === 'notice');
    
    // Classifica por nível WCAG baseado no código
    const classifyLevel = (issue) => {
      const code = issue.code || '';
      if (code.includes('WCAG2AAA')) return 'AAA';
      if (code.includes('WCAG2AA')) return 'AA';
      if (code.includes('WCAG2A')) return 'A';
      return 'indefinido';
    };
    
    const levels = { A: 0, AA: 0, AAA: 0, indefinido: 0 };
    errors.forEach(err => {
      const level = classifyLevel(err);
      levels[level]++;
    });
    
    console.log(`   ✅ Análise concluída`);
    
    return {
      errors: errors.length,
      warnings: warnings.length,
      notices: notices.length,
      nivelA: levels.A,
      nivelAA: levels.AA,
      nivelAAA: levels.AAA,
      indefinido: levels.indefinido,
      detalhes: {
        errors: errors.map(e => ({
          code: e.code,
          message: e.message,
          element: e.selector || 'unknown'
        })),
        warnings: warnings.map(w => ({
          code: w.code,
          message: w.message
        }))
      }
    };
  } catch (err) {
    console.error(`❌ Erro no Pa11y: ${err.message}`);
    return null;
  }
}

// ----------------------
// Buscar URLs do Sitemap
// ----------------------
async function getSitemapUrls(baseUrl) {
  if (!CONFIG.USE_SITEMAP) {
    return [baseUrl];
  }

  // Carrega Sitemapper dinamicamente (ES Module)
  if (!Sitemapper) {
    try {
      const sitemapperModule = await import("sitemapper");
      Sitemapper = sitemapperModule.default;
    } catch (err) {
      console.log(`   ⚠️  Erro ao carregar Sitemapper: ${err.message}`);
      console.log(`   ℹ️  Continuando sem busca de sitemap...`);
      return [baseUrl];
    }
  }

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const sitemapLocations = [
    `${normalizedBase}sitemap.xml`,
    `${normalizedBase}sitemap_index.xml`,
    `${normalizedBase}wp-sitemap.xml`,
  ];

  console.log(`🗺️  Buscando sitemap...`);

  for (const sitemapUrl of sitemapLocations) {
    try {
      const sitemap = new Sitemapper({
        url: sitemapUrl,
        timeout: CONFIG.SITEMAP_TIMEOUT,
      });

      const { sites } = await sitemap.fetch();

      if (!sites || sites.length === 0) {
        continue;
      }

      console.log(`   ✅ Encontradas ${sites.length} URLs no sitemap`);

      // Prioriza URLs importantes
      const sortedUrls = sites.sort((a, b) => {
        const scoreA = CONFIG.PRIORITY_PATTERNS.reduce(
          (score, pattern) => score + (pattern.test(a) ? 1 : 0),
          0
        );
        const scoreB = CONFIG.PRIORITY_PATTERNS.reduce(
          (score, pattern) => score + (pattern.test(b) ? 1 : 0),
          0
        );
        return scoreB - scoreA;
      });

      const selectedUrls = [baseUrl];
      for (const url of sortedUrls) {
        if (selectedUrls.length >= CONFIG.MAX_URLS_PER_REPO) break;
        if (!selectedUrls.includes(url)) {
          selectedUrls.push(url);
        }
      }

      console.log(`   ✅ Selecionadas ${selectedUrls.length} URLs`);
      return selectedUrls;
    } catch (err) {
      continue;
    }
  }

  console.log(`   ℹ️  Nenhum sitemap encontrado, usando apenas homepage`);
  return [baseUrl];
}

// ----------------------
// Ler CSV de Repositórios com Homepage
// ----------------------
async function readRepositories() {
  const csvFile = "repositorios_com_homepage.csv";
  
  if (!fs.existsSync(csvFile)) {
    console.error(`❌ ERRO: Arquivo ${csvFile} não encontrado!`);
    console.error("");
    console.error("   Execute primeiro:");
    console.error("   $ npm run extract-homepages");
    console.error("");
    process.exit(1);
  }
  
  console.log(`📂 Lendo arquivo: ${csvFile}`);
  console.log(`   ✅ Usando CSV com URLs pré-carregadas`);
  
  return new Promise((resolve, reject) => {
    const repos = [];
    fs.createReadStream(csvFile)
      .pipe(csv())
      .on("data", (row) => {
        const repositorio = row["Repositorio"] || row["Repositório"];
        const homepage = row["Homepage"];
        
        if (repositorio && homepage && homepage.trim() !== "") {
          repos.push({
            repositorio: repositorio.trim(),
            homepage: homepage.trim(),
          });
        }
      })
      .on("end", () => {
        console.log(`📋 Carregados ${repos.length} repositórios com homepage`);
        console.log("");
        resolve(repos);
      })
      .on("error", reject);
  });
}

// ----------------------
// Salvar CSV
// ----------------------
async function saveCsv(results) {
  const csvWriter = createCsvWriter({
    path: 'pa11y_ci_results.csv',
    header: [
      { id: 'repositorio', title: 'Repositorio' },
      { id: 'homepage', title: 'Homepage' },
      { id: 'urls_analisadas', title: 'URLs_Analisadas' },
      { id: 'urls_sucesso', title: 'URLs_Sucesso' },
      { id: 'status', title: 'Status' },
      { id: 'errors_total', title: 'ErrorsTotal' },
      { id: 'warnings_total', title: 'WarningsTotal' },
      { id: 'notices_total', title: 'NoticesTotal' },
      { id: 'errors_A', title: 'ErrorsA' },
      { id: 'errors_AA', title: 'ErrorsAA' },
      { id: 'errors_AAA', title: 'ErrorsAAA' },
      { id: 'errors_indefinido', title: 'ErrorsIndefinido' },
      { id: 'criterios_total', title: 'WCAG_CriteriosTotal' },
      { id: 'criterios_automatizaveis', title: 'WCAG_CriteriosAutomatizaveis' },
      { id: 'taxa_sucesso_acessibilidade', title: 'TaxaSucessoAcessibilidade' }
    ]
  });
  
  await csvWriter.writeRecords(results);
  console.log('📄 Resultados salvos em pa11y_ci_results.csv');
}

// ----------------------
// Execução principal
// ----------------------
(async () => {
  console.log("🚀 PA11Y (HTML_CODESNIFFER) RUNNER - ANÁLISE DE ACESSIBILIDADE");
  console.log("=".repeat(80));
  console.log(`📋 Padrão WCAG: ${CONFIG.WCAG_STANDARD}`);
  console.log("");

  const repos = await readRepositories();
  const results = [];
  let totalRodados = 0;
  let totalErros = 0;

  for (const repo of repos) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`📦 Repositório: ${repo.repositorio}`);
    console.log(`🌐 Homepage: ${repo.homepage}`);
    console.log(`${"=".repeat(80)}`);

    // Buscar URLs do sitemap
    const urlsToAnalyze = await getSitemapUrls(repo.homepage);

    // Executar Pa11y em cada URL
    const urlResults = [];
    let successCount = 0;

    for (let i = 0; i < urlsToAnalyze.length; i++) {
      const url = urlsToAnalyze[i];
      console.log(`\n   📄 [${i + 1}/${urlsToAnalyze.length}] Analisando: ${url}`);

      const pa11yResult = await runPa11y(url);

      if (pa11yResult) {
        urlResults.push({ url, ...pa11yResult });
        successCount++;
        console.log(`      ✓ Errors: ${pa11yResult.errors} | Warnings: ${pa11yResult.warnings} | Notices: ${pa11yResult.notices}`);
      } else {
        console.log(`      ✗ Falha na análise`);
      }

      // Pausa entre URLs
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Verifica se houve algum sucesso
    if (urlResults.length === 0) {
      console.log(`\n❌ Falha ao executar Pa11y em todas as URLs`);
      totalErros++;
      results.push({
        repositorio: repo.repositorio,
        homepage: repo.homepage,
        urls_analisadas: urlsToAnalyze.length,
        urls_sucesso: 0,
        status: 'ERROR',
        errors_total: null,
        warnings_total: null,
        notices_total: null,
        errors_A: null,
        errors_AA: null,
        errors_AAA: null,
        errors_indefinido: null,
        criterios_total: WCAG_TOTAL_CRITERIA,
        criterios_automatizaveis: WCAG_AUTOMATIZAVEL,
        taxa_sucesso_acessibilidade: null
      });
      continue;
    }

    // Agregar resultados (soma de errors/warnings/notices)
    const aggregatedResult = {
      errors: urlResults.reduce((sum, r) => sum + r.errors, 0),
      warnings: urlResults.reduce((sum, r) => sum + r.warnings, 0),
      notices: urlResults.reduce((sum, r) => sum + r.notices, 0),
      nivelA: urlResults.reduce((sum, r) => sum + r.nivelA, 0),
      nivelAA: urlResults.reduce((sum, r) => sum + r.nivelAA, 0),
      nivelAAA: urlResults.reduce((sum, r) => sum + r.nivelAAA, 0),
      indefinido: urlResults.reduce((sum, r) => sum + r.indefinido, 0),
    };

    console.log(`\n✅ Análise agregada concluída (${successCount}/${urlsToAnalyze.length} URLs):`);
    console.log(`   ❌ Errors (total): ${aggregatedResult.errors}`);
    console.log(`   ⚠️  Warnings (total): ${aggregatedResult.warnings}`);
    console.log(`   ℹ️  Notices (total): ${aggregatedResult.notices}`);
    console.log(`   📈 WCAG - A: ${aggregatedResult.nivelA} | AA: ${aggregatedResult.nivelAA} | AAA: ${aggregatedResult.nivelAAA}`);

    totalRodados++;

    results.push({
      repositorio: repo.repositorio,
      homepage: repo.homepage,
      urls_analisadas: urlsToAnalyze.length,
      urls_sucesso: successCount,
      status: 'SUCCESS',
      errors_total: aggregatedResult.errors,
      warnings_total: aggregatedResult.warnings,
      notices_total: aggregatedResult.notices,
      errors_A: aggregatedResult.nivelA,
      errors_AA: aggregatedResult.nivelAA,
      errors_AAA: aggregatedResult.nivelAAA,
      errors_indefinido: aggregatedResult.indefinido,
      criterios_total: WCAG_TOTAL_CRITERIA,
      criterios_automatizaveis: WCAG_AUTOMATIZAVEL,
      taxa_sucesso_acessibilidade: ((WCAG_AUTOMATIZAVEL - aggregatedResult.errors) / WCAG_AUTOMATIZAVEL).toFixed(2)
    });

    // Pausa entre repositórios
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  await saveCsv(results);

  // Resumo final
  console.log(`\n${"=".repeat(80)}`);
  console.log("📊 RESUMO DA EXECUÇÃO");
  console.log(`${"=".repeat(80)}`);
  console.log(`✅ Analisados com sucesso: ${totalRodados}`);
  console.log(`❌ Erros: ${totalErros}`);
  console.log(`📈 Taxa de sucesso: ${((totalRodados / repos.length) * 100).toFixed(1)}%`);
  console.log("");
  console.log("📄 Arquivo gerado:");
  console.log("   - pa11y_ci_results.csv");
  console.log("");

  process.exit(0);
})();