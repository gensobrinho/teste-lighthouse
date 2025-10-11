const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

let Sitemapper;

/**
 * WAVE Standalone Runner
 * 
 * Baseado no framework RIPER (Research, Innovate, Plan, Execute, Review)
 * 
 * ⚠️ LIMITAÇÃO CONHECIDA:
 * wave.min.js da extensão NÃO funciona standalone sem contexto de extensão Chrome.
 * O objeto WAVE não se inicializa fora do ambiente de extensão.
 * 
 * 💡 ALTERNATIVAS RECOMENDADAS:
 * 1. Use wave-extension-runner.js (carrega extensão completa - RECOMENDADO)
 * 2. Use WAVE API oficial da WebAIM (requer chave de API)
 * 3. Execute extensão WAVE manualmente e capture resultados
 * 
 * ESTE SCRIPT SERVE COMO:
 * - Tentativa de implementação standalone
 * - Documentação do problema
 * - Base para adaptação futura
 * 
 * IMPLEMENTAÇÃO:
 * - Tenta usar wave.min.js da extensão WAVE como engine standalone
 * - Injeta e executa análise via Puppeteer headless
 * - Segue padrão dos outros runners (axe, pa11y, htmlcs)
 * - Classifica resultados por categorias WAVE
 * 
 * CATEGORIAS WAVE:
 * - Errors: Erros de acessibilidade confirmados
 * - Alerts: Possíveis problemas que requerem revisão manual
 * - Features: Recursos de acessibilidade presentes
 * - Structural: Elementos estruturais (headings, landmarks)
 * - ARIA: Uso de atributos ARIA
 * - Contrast: Problemas de contraste de cores
 * 
 * NOTA: Métricas de Cobertura WCAG foram removidas devido a inconsistências metodológicas.
 * Para detalhes, consulte os comentários em axe-ci-runner.js
 */

// ----------------------
// Configurações
// ----------------------
const CONFIG = {
  // Número máximo de URLs a analisar por repositório
  MAX_URLS_PER_REPO: 10,
  
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
  
  // Timeout para análise WAVE
  PAGE_TIMEOUT: 90000,
  WAVE_TIMEOUT: 60000,
  
  // Número de tentativas em caso de erro
  MAX_RETRIES: 1,
  
  // Caminho para o script WAVE
  WAVE_SCRIPT_PATH: './wave-extension/wave.min.js',
};

// ----------------------
// Função Principal WAVE
// ----------------------
async function runWave(url, retry = 0) {
  console.log(`🌊 Rodando WAVE em ${url}`);
  const start = Date.now();
  let browser;

  try {
    // Verificar se wave.min.js existe
    if (!fs.existsSync(CONFIG.WAVE_SCRIPT_PATH)) {
      throw new Error(`WAVE script não encontrado em ${CONFIG.WAVE_SCRIPT_PATH}`);
    }

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--ignore-certificate-errors'
      ]
    });

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(CONFIG.PAGE_TIMEOUT);
    
    // Navegar para a página
    const response = await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: CONFIG.PAGE_TIMEOUT 
    });

    if (!response || !response.ok()) {
      throw new Error(`Falha ao carregar página (${response?.status()})`);
    }

    // Aguardar página estabilizar
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Ler e injetar WAVE script
    const waveScript = fs.readFileSync(CONFIG.WAVE_SCRIPT_PATH, 'utf8');
    await page.addScriptTag({ content: waveScript });

    // Aguardar um pouco para WAVE carregar
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verificar se WAVE foi carregado
    const waveLoaded = await page.evaluate(() => {
      return typeof WAVE !== 'undefined';
    });

    if (!waveLoaded) {
      // WAVE da extensão não funciona standalone sem contexto de extensão
      console.log('   ⚠️  wave.min.js não carregou como standalone');
      console.log('   💡 SOLUÇÃO: Use wave-extension-runner.js que carrega a extensão completa');
      console.log('   💡 OU use a WAVE API oficial (requer chave)');
      throw new Error('WAVE não disponível standalone. Use wave-extension-runner.js ou WAVE API.');
    }

    // Executar análise WAVE e aguardar resultados
    const result = await Promise.race([
      page.evaluate(() => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout aguardando resultados WAVE'));
        }, 45000);

        try {
          // WAVE já verificado como disponível

          // Listener para capturar resultados
          const checkResults = () => {
            // WAVE pode emitir evento ou preencher objeto
            if (document.addEventListener) {
              document.addEventListener('waveResults', function(e) {
                clearTimeout(timeout);
                if (e.detail && e.detail.data) {
                  resolve({
                    success: true,
                    data: e.detail.data
                  });
                } else {
                  reject(new Error('Dados WAVE inválidos'));
                }
              }, { once: true });
            }

            // Tentar inicializar WAVE
            if (typeof WAVE.generateReport === 'function') {
              // Disparar análise
              const event = new Event('getExtensionUrl');
              document.dispatchEvent(event);
              
              // Polling para resultados (fallback)
              let attempts = 0;
              const pollResults = setInterval(() => {
                attempts++;
                
                // Tentar acessar resultados de várias formas
                const results = window.waveResults || 
                               window.WAVE.results || 
                               window.WAVE.report ||
                               (window.WAVE.data ? window.WAVE.data.results : null);
                
                if (results && results.categories) {
                  clearTimeout(timeout);
                  clearInterval(pollResults);
                  resolve({
                    success: true,
                    data: results
                  });
                } else if (attempts > 100) { // 10 segundos
                  clearTimeout(timeout);
                  clearInterval(pollResults);
                  reject(new Error('Timeout no polling de resultados WAVE'));
                }
              }, 100);
            } else {
              clearTimeout(timeout);
              reject(new Error('WAVE.generateReport não disponível'));
            }
          };

          checkResults();

        } catch (err) {
          clearTimeout(timeout);
          reject(err);
        }
      })),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout externo WAVE')), CONFIG.WAVE_TIMEOUT)
      )
    ]);

    // Processar resultados
    if (result.success && result.data && result.data.categories) {
      const categories = result.data.categories;
      
      const finalResult = {
        errors: categories.error?.count || 0,
        alerts: categories.alert?.count || 0,
        features: categories.feature?.count || 0,
        structural: categories.structure?.count || 0,
        aria: categories.aria?.count || 0,
        contrast: categories.contrast?.count || 0,
      };

      console.log(`   ✅ Concluído (${((Date.now() - start) / 1000).toFixed(2)}s)`);
      console.log(`      • Erros: ${finalResult.errors}, Alertas: ${finalResult.alerts}, Features: ${finalResult.features}`);
      
      return finalResult;
    } else {
      throw new Error('Estrutura de dados WAVE inválida');
    }

  } catch (err) {
    const errorMsg = err.message || String(err);
    console.error(`   ❌ ${url} - ${errorMsg}`);
    
    // Log detalhado de erro
    const errorLog = `
[${new Date().toISOString()}] ERRO WAVE
URL: ${url}
Retry: ${retry}
Erro: ${errorMsg}
Stack: ${err.stack || 'N/A'}
${'='.repeat(80)}
`;
    fs.appendFileSync('errors.log', errorLog);
    
    if (retry < CONFIG.MAX_RETRIES) {
      console.log(`   🔁 Tentando novamente (${retry + 1}/${CONFIG.MAX_RETRIES})...`);
      await new Promise(r => setTimeout(r, 3000));
      return runWave(url, retry + 1);
    }
    
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ----------------------
// Funções de Sitemap
// ----------------------
async function getSitemapUrls(baseUrl) {
  if (!CONFIG.USE_SITEMAP) return [baseUrl];

  if (!Sitemapper) {
    try {
      const sitemapperModule = await import("sitemapper");
      Sitemapper = sitemapperModule.default;
    } catch (err) {
      console.log(`   ⚠️  Erro ao carregar Sitemapper`);
      return [baseUrl];
    }
  }

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const sitemapLocations = [
    `${normalizedBase}sitemap.xml`,
    `${normalizedBase}sitemap_index.xml`,
    `${normalizedBase}wp-sitemap.xml`
  ];

  console.log(`🗺️  Buscando sitemap...`);

  for (const sitemapUrl of sitemapLocations) {
    try {
      const sitemap = new Sitemapper({ 
        url: sitemapUrl, 
        timeout: CONFIG.SITEMAP_TIMEOUT 
      });
      const { sites } = await sitemap.fetch();
      
      if (!sites || sites.length === 0) continue;

      console.log(`   ✅ Encontradas ${sites.length} URLs`);

      const sortedUrls = sites.sort((a, b) => {
        const scoreA = CONFIG.PRIORITY_PATTERNS.reduce((s, p) => s + (p.test(a) ? 1 : 0), 0);
        const scoreB = CONFIG.PRIORITY_PATTERNS.reduce((s, p) => s + (p.test(b) ? 1 : 0), 0);
        return scoreB - scoreA;
      });

      const selectedUrls = [baseUrl];
      for (const url of sortedUrls) {
        if (selectedUrls.length >= CONFIG.MAX_URLS_PER_REPO) break;
        if (!selectedUrls.includes(url)) selectedUrls.push(url);
      }

      console.log(`   ✅ Selecionadas ${selectedUrls.length} URLs`);
      return selectedUrls;
    } catch (err) {
      continue;
    }
  }

  console.log(`   ℹ️  Nenhum sitemap encontrado`);
  return [baseUrl];
}

// ----------------------
// Ler CSV de Repositórios
// ----------------------
async function readRepositories() {
  const csvFile = "repositorios_com_homepage.csv";
  if (!fs.existsSync(csvFile)) {
    console.error(`❌ Arquivo ${csvFile} não encontrado!`);
    process.exit(1);
  }
  
  console.log(`📂 Lendo arquivo: ${csvFile}`);
  
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
            homepage: homepage.trim() 
          });
        }
      })
      .on("end", () => {
        console.log(`📋 Carregados ${repos.length} repositórios\n`);
        resolve(repos);
      })
      .on("error", reject);
  });
}

// ----------------------
// Salvar Resultados CSV
// ----------------------
async function saveCsv(results) {
  const csvWriter = createCsvWriter({
    path: 'wave_ci_results.csv',
    header: [
      { id: 'repositorio', title: 'Repositorio' },
      { id: 'homepage', title: 'Homepage' },
      { id: 'urls_analisadas', title: 'URLs_Analisadas' },
      { id: 'urls_sucesso', title: 'URLs_Sucesso' },
      { id: 'status', title: 'Status' },
      { id: 'errors_total', title: 'ErrorsTotal' },
      { id: 'alerts_total', title: 'AlertsTotal' },
      { id: 'features_total', title: 'FeaturesTotal' },
      { id: 'structural_total', title: 'StructuralTotal' },
      { id: 'aria_total', title: 'ARIATotal' },
      { id: 'contrast_total', title: 'ContrastTotal' },
    ]
  });
  
  await csvWriter.writeRecords(results);
  console.log('📄 Resultados salvos em wave_ci_results.csv');
}

// ----------------------
// Execução Principal
// ----------------------
(async () => {
  console.log("🌊 WAVE STANDALONE RUNNER - ANÁLISE DE ACESSIBILIDADE");
  console.log("=".repeat(80));
  console.log(`📊 Framework: RIPER (Research, Innovate, Plan, Execute, Review)`);
  console.log(`📊 Engine: WAVE Extension (${CONFIG.WAVE_SCRIPT_PATH})`);
  console.log("");
  console.log("⚠️  AVISO: wave.min.js pode não funcionar standalone!");
  console.log("💡 Se falhar, use: wave-extension-runner.js (extensão completa)");
  console.log("");

  // Verificar se WAVE existe
  if (!fs.existsSync(CONFIG.WAVE_SCRIPT_PATH)) {
    console.error(`❌ ERRO: WAVE script não encontrado em ${CONFIG.WAVE_SCRIPT_PATH}`);
    console.error(`   Certifique-se de que wave-extension/wave.min.js existe.\n`);
    process.exit(1);
  }

  const repos = await readRepositories();
  const results = [];
  let totalRodados = 0, totalErros = 0;

  for (const repo of repos) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`📦 Repositório: ${repo.repositorio}`);
    console.log(`🌐 Homepage: ${repo.homepage}`);
    console.log(`${"=".repeat(80)}`);

    const urlsToAnalyze = await getSitemapUrls(repo.homepage);
    const urlResults = [];
    let successCount = 0;

    for (let i = 0; i < urlsToAnalyze.length; i++) {
      const url = urlsToAnalyze[i];
      console.log(`\n   📄 [${i + 1}/${urlsToAnalyze.length}] ${url}`);

      const waveResult = await runWave(url);

      if (waveResult) {
        urlResults.push(waveResult);
        successCount++;
        console.log(`      ✓ OK`);
      } else {
        console.log(`      ✗ Falha`);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (urlResults.length === 0) {
      console.log(`\n❌ Falha em todas as URLs`);
      totalErros++;
      results.push({
        repositorio: repo.repositorio,
        homepage: repo.homepage,
        urls_analisadas: urlsToAnalyze.length,
        urls_sucesso: 0,
        status: 'ERROR',
        errors_total: null,
        alerts_total: null,
        features_total: null,
        structural_total: null,
        aria_total: null,
        contrast_total: null,
      });
      continue;
    }

    // Agregar resultados
    const aggr = {
      errors: urlResults.reduce((s, r) => s + r.errors, 0),
      alerts: urlResults.reduce((s, r) => s + r.alerts, 0),
      features: urlResults.reduce((s, r) => s + r.features, 0),
      structural: urlResults.reduce((s, r) => s + r.structural, 0),
      aria: urlResults.reduce((s, r) => s + r.aria, 0),
      contrast: urlResults.reduce((s, r) => s + r.contrast, 0),
    };

    console.log(`\n✅ Agregado (${successCount}/${urlsToAnalyze.length}):`);
    console.log(`   Erros: ${aggr.errors} | Alertas: ${aggr.alerts} | Features: ${aggr.features}`);

    totalRodados++;

    results.push({
      repositorio: repo.repositorio,
      homepage: repo.homepage,
      urls_analisadas: urlsToAnalyze.length,
      urls_sucesso: successCount,
      status: 'SUCCESS',
      errors_total: aggr.errors,
      alerts_total: aggr.alerts,
      features_total: aggr.features,
      structural_total: aggr.structural,
      aria_total: aggr.aria,
      contrast_total: aggr.contrast,
    });

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  await saveCsv(results);

  console.log(`\n${"=".repeat(80)}`);
  console.log("📊 RESUMO");
  console.log(`${"=".repeat(80)}`);
  console.log(`✅ Sucesso: ${totalRodados} | ❌ Erros: ${totalErros}`);
  console.log(`📈 Taxa: ${((totalRodados / repos.length) * 100).toFixed(1)}%`);
  console.log("\n📄 Gerado: wave_ci_results.csv");
  console.log(`🌊 Engine: ${CONFIG.WAVE_SCRIPT_PATH}\n`);

  process.exit(0);
})();

