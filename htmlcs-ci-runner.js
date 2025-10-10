const fs = require('fs');
const puppeteer = require('puppeteer');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fetch = require('node-fetch');

let Sitemapper;

/**
* NOTA: Métricas de Cobertura WCAG foram removidas devido a inconsistências metodológicas.
* Para detalhes, consulte os comentários em axe-ci-runner.js
*/

const CONFIG = {
  MAX_URLS_PER_REPO: 10,
  USE_SITEMAP: true,
  SITEMAP_TIMEOUT: 10000,
  PRIORITY_PATTERNS: [/\/$/, /\/about/i, /\/contact/i, /\/login/i],
  WCAG_STANDARD: 'WCAG2AA',
  PAGE_TIMEOUT: 90000,
  HTMLCS_TIMEOUT: 90000,
  MAX_RETRIES: 1,
  LOCAL_HTMLCS_PATH: './HTMLCS.js',
};

async function loadHTMLCSScript() {
  if (fs.existsSync(CONFIG.LOCAL_HTMLCS_PATH)) {
    console.log('✅ Usando HTML_CodeSniffer do cache local');
    return fs.readFileSync(CONFIG.LOCAL_HTMLCS_PATH, 'utf8');
  }

  console.log('📥 Baixando HTML_CodeSniffer...');
  
  const cdnUrls = [
    'https://squizlabs.github.io/HTML_CodeSniffer/build/HTMLCS.js',
    'https://cdn.jsdelivr.net/gh/squizlabs/HTML_CodeSniffer@master/build/HTMLCS.js',
  ];

  for (const url of cdnUrls) {
    try {
      console.log(`   🔍 Tentando: ${url}`);
      const response = await fetch(url, { timeout: 30000 });
      
      if (response.ok) {
        const script = await response.text();
        fs.writeFileSync(CONFIG.LOCAL_HTMLCS_PATH, script);
        console.log(`   ✅ HTML_CodeSniffer baixado e salvo localmente`);
        return script;
      }
    } catch (err) {
      console.log(`   ⚠️  Falha: ${err.message}`);
    }
  }

  throw new Error('Não foi possível baixar HTML_CodeSniffer');
}

async function runHTMLCS(url, htmlcsScript, standard = CONFIG.WCAG_STANDARD, retry = 0) {
  console.log(`🚀 Iniciando HTML_CodeSniffer em ${url}`);
  const startTime = Date.now();
  let browser;
  
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      timeout: 60000
    });

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(CONFIG.PAGE_TIMEOUT);
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: CONFIG.PAGE_TIMEOUT });
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 2000));
    await page.addScriptTag({ content: htmlcsScript });
    await page.waitForFunction(() => typeof window.HTMLCS !== 'undefined', { timeout: 10000 });

    console.log(`   ✅ HTML_CodeSniffer pronto, executando análise...`);

    const result = await Promise.race([
      page.evaluate((wcagStandard) => {
        return new Promise((resolve, reject) => {
          try {
            const messages = [];
            
            const callback = (msg) => {
              messages.push({
                type: msg.type,
                code: msg.code,
                message: msg.msg,
                element: msg.element ? msg.element.tagName : 'unknown'
              });
            };
            
            window.HTMLCS.process(wcagStandard, document, callback, (error) => {
              if (error) {
                reject(new Error('Erro ao processar: ' + error));
                return;
              }
              
              const errors = messages.filter(m => m.type === window.HTMLCS.ERROR);
              const warnings = messages.filter(m => m.type === window.HTMLCS.WARNING);
              const notices = messages.filter(m => m.type === window.HTMLCS.NOTICE);
              
              const classifyLevel = (msg) => {
                const code = msg.code || '';
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
              
              resolve({
                errors: errors.length,
                warnings: warnings.length,
                notices: notices.length,
                nivelA: levels.A,
                nivelAA: levels.AA,
                nivelAAA: levels.AAA,
                indefinido: levels.indefinido
              });
            });
          } catch (err) {
            reject(err);
          }
        });
      }, standard),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('⏰ Timeout: 90s')), CONFIG.HTMLCS_TIMEOUT)
      )
    ]);

    await browser.close();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`   ✅ Análise concluída (${elapsed}s)`);
    return result;
    
  } catch (err) {
    console.error(`   ❌ Erro: ${err.message}`);
    if (browser) await browser.close().catch(() => {});
    
    if (retry < CONFIG.MAX_RETRIES) {
      console.log(`   🔁 Retentando (${retry + 1}/${CONFIG.MAX_RETRIES})...`);
      await new Promise(r => setTimeout(r, 3000));
      return runHTMLCS(url, htmlcsScript, standard, retry + 1);
    }
    return null;
  }
}

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
  const sitemapLocations = [`${normalizedBase}sitemap.xml`, `${normalizedBase}sitemap_index.xml`, `${normalizedBase}wp-sitemap.xml`];

  console.log(`🗺️  Buscando sitemap...`);

  for (const sitemapUrl of sitemapLocations) {
    try {
      const sitemap = new Sitemapper({ url: sitemapUrl, timeout: CONFIG.SITEMAP_TIMEOUT });
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
          repos.push({ repositorio: repositorio.trim(), homepage: homepage.trim() });
        }
      })
      .on("end", () => {
        console.log(`📋 Carregados ${repos.length} repositórios\n`);
        resolve(repos);
      })
      .on("error", reject);
  });
}

async function saveCsv(results) {
  const csvWriter = createCsvWriter({
    path: 'htmlcs_ci_results.csv',
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
      { id: 'taxa_sucesso_acessibilidade', title: 'TaxaSucessoAcessibilidade' }
    ]
  });
  
  await csvWriter.writeRecords(results);
  console.log('📄 Resultados salvos em htmlcs_ci_results.csv');
}

(async () => {
  console.log("🚀 HTML_CODESNIFFER RUNNER - ANÁLISE DE ACESSIBILIDADE");
  console.log("=".repeat(80));
  console.log(`📋 Padrão WCAG: ${CONFIG.WCAG_STANDARD}\n`);

  let htmlcsScript;
  try {
    htmlcsScript = await loadHTMLCSScript();
  } catch (err) {
    console.error(`❌ ERRO: ${err.message}\n`);
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

      const htmlcsResult = await runHTMLCS(url, htmlcsScript);

      if (htmlcsResult) {
        urlResults.push({ url, ...htmlcsResult });
        successCount++;
        console.log(`      ✓ Errors: ${htmlcsResult.errors} | Warnings: ${htmlcsResult.warnings}`);
      } else {
        console.log(`      ✗ Falha`);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
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
        warnings_total: null,
        notices_total: null,
        errors_A: null,
        errors_AA: null,
        errors_AAA: null,
        errors_indefinido: null,
        taxa_sucesso_acessibilidade: null
      });
      continue;
    }

    const aggr = {
      errors: urlResults.reduce((s, r) => s + r.errors, 0),
      warnings: urlResults.reduce((s, r) => s + r.warnings, 0),
      notices: urlResults.reduce((s, r) => s + r.notices, 0),
      nivelA: urlResults.reduce((s, r) => s + r.nivelA, 0),
      nivelAA: urlResults.reduce((s, r) => s + r.nivelAA, 0),
      nivelAAA: urlResults.reduce((s, r) => s + r.nivelAAA, 0),
      indefinido: urlResults.reduce((s, r) => s + r.indefinido, 0),
    };

    console.log(`\n✅ Agregado (${successCount}/${urlsToAnalyze.length}):`);
    console.log(`   Errors: ${aggr.errors} | Warnings: ${aggr.warnings} | A: ${aggr.nivelA} | AA: ${aggr.nivelAA}`);

    totalRodados++;

    // Calcula taxa de sucesso simples (inverso da densidade de erros)
    const totalChecks = aggr.errors + aggr.warnings;
    const taxaSucesso = totalChecks > 0 
      ? (1 - (aggr.errors / totalChecks)).toFixed(4)
      : 1.0000;

    results.push({
      repositorio: repo.repositorio,
      homepage: repo.homepage,
      urls_analisadas: urlsToAnalyze.length,
      urls_sucesso: successCount,
      status: 'SUCCESS',
      errors_total: aggr.errors,
      warnings_total: aggr.warnings,
      notices_total: aggr.notices,
      errors_A: aggr.nivelA,
      errors_AA: aggr.nivelAA,
      errors_AAA: aggr.nivelAAA,
      errors_indefinido: aggr.indefinido,
      taxa_sucesso_acessibilidade: taxaSucesso
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  await saveCsv(results);

  console.log(`\n${"=".repeat(80)}`);
  console.log("📊 RESUMO");
  console.log(`${"=".repeat(80)}`);
  console.log(`✅ Sucesso: ${totalRodados} | ❌ Erros: ${totalErros}`);
  console.log(`📈 Taxa: ${((totalRodados / repos.length) * 100).toFixed(1)}%`);
  console.log("\n📄 Gerado: htmlcs_ci_results.csv");
  console.log(`💾 Cache: ${CONFIG.LOCAL_HTMLCS_PATH}\n`);

  process.exit(0);
})();

