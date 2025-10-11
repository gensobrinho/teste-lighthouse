const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Sitemapper precisa de import dinâmico (ES Module)
let Sitemapper;

/**
 * Script para executar análise WAVE de acessibilidade
 * 
 * Usa a extensão WAVE (wave-extension/) via Puppeteer:
 * 1. Carrega wave.min.js na página
 * 2. Executa análise WAVE
 * 3. Extrai resultados (erros, alertas, features, etc)
 * 4. Salva em wave_ci_results.csv
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

  // Timeout para análise WAVE (ms)
  WAVE_TIMEOUT: 60000,
};

// ----------------------
// Funções WAVE
// ----------------------
async function runWave(url) {
  console.log(`🌊 Iniciando WAVE em ${url}`);
  
  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    
    const page = await browser.newPage();
    
    // Configurar timeout
    page.setDefaultTimeout(CONFIG.WAVE_TIMEOUT);
    
    // Navegar para a página
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: CONFIG.WAVE_TIMEOUT 
    });

    // Aguardar um pouco para garantir que a página está totalmente carregada
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Ler o arquivo wave.min.js
    const waveScriptPath = path.join(__dirname, 'wave-extension', 'wave.min.js');
    const waveScript = fs.readFileSync(waveScriptPath, 'utf8');

    // Injetar o script WAVE na página
    await page.evaluate(waveScript);

    // Aguardar um pouco para o WAVE processar
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Executar análise WAVE e capturar resultados
    const results = await page.evaluate(() => {
      return new Promise((resolve) => {
        // WAVE usa eventos customizados para retornar resultados
        // Vamos tentar acessar o objeto global WAVE que é criado
        
        // Timeout de segurança
        const timeout = setTimeout(() => {
          resolve({
            success: false,
            error: 'Timeout aguardando resultados WAVE'
          });
        }, 30000);

        // Listener para capturar resultados
        document.addEventListener('waveResults', function(e) {
          clearTimeout(timeout);
          resolve({
            success: true,
            data: e.detail.data
          });
        }, { once: true });

        // Tentar disparar evento para obter resultados
        try {
          // O WAVE pode ter diferentes formas de ser invocado
          // Vamos tentar acessar diretamente os resultados se disponíveis
          if (typeof WAVE !== 'undefined' && WAVE.results) {
            clearTimeout(timeout);
            resolve({
              success: true,
              data: WAVE.results
            });
          } else if (typeof WAVE !== 'undefined' && typeof WAVE.generateReport === 'function') {
            // Tentar gerar relatório
            document.dispatchEvent(new Event('getExtensionUrl'));
            // Aguardar evento de resposta
          } else {
            clearTimeout(timeout);
            resolve({
              success: false,
              error: 'WAVE não encontrado ou não inicializado',
              debug: typeof WAVE !== 'undefined' ? Object.keys(WAVE) : 'WAVE undefined'
            });
          }
        } catch (err) {
          clearTimeout(timeout);
          resolve({
            success: false,
            error: err.message
          });
        }
      });
    });

    await browser.close();

    if (!results.success) {
      console.error(`❌ Erro WAVE: ${results.error}`);
      if (results.debug) {
        console.error(`   Debug: ${results.debug}`);
      }
      return {
        erros: 0,
        alertas: 0,
        features: 0,
        structural: 0,
        aria: 0,
        contrast: 0,
        html5: 0,
        detalhes: 'Erro ao executar WAVE: ' + results.error
      };
    }

    // Processar resultados WAVE
    const data = results.data || {};
    const categories = data.categories || {};

    return {
      erros: categories.error?.count || 0,
      alertas: categories.alert?.count || 0,
      features: categories.feature?.count || 0,
      structural: categories.structure?.count || 0,
      aria: categories.aria?.count || 0,
      contrast: categories.contrast?.count || 0,
      html5: categories.html5?.count || 0,
      detalhes: JSON.stringify(data)
    };

  } catch (err) {
    console.error(`❌ Erro ao executar WAVE: ${err.message}`);
    return {
      erros: -1,
      alertas: -1,
      features: -1,
      structural: -1,
      aria: -1,
      contrast: -1,
      html5: -1,
      detalhes: `Erro: ${err.message}`
    };
  }
}

// ----------------------
// Funções de Sitemap
// ----------------------
async function fetchSitemap(baseUrl) {
  try {
    if (!Sitemapper) {
      const module = await import('sitemapper');
      Sitemapper = module.default;
    }

    const sitemap = new Sitemapper({
      url: `${baseUrl}/sitemap.xml`,
      timeout: CONFIG.SITEMAP_TIMEOUT,
    });

    const { sites } = await sitemap.fetch();
    return sites || [];
  } catch (err) {
    console.log(`   ⚠️  Sitemap não encontrado ou erro: ${err.message}`);
    return [];
  }
}

function prioritizeUrls(urls) {
  const scored = urls.map(url => {
    let score = 0;
    CONFIG.PRIORITY_PATTERNS.forEach((pattern, index) => {
      if (pattern.test(url)) {
        score += (CONFIG.PRIORITY_PATTERNS.length - index) * 10;
      }
    });
    return { url, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(item => item.url);
}

async function getUrlsToTest(homepage) {
  let urls = [];

  if (CONFIG.USE_SITEMAP) {
    console.log(`   🗺️  Buscando sitemap...`);
    const sitemapUrls = await fetchSitemap(homepage);
    
    if (sitemapUrls.length > 0) {
      console.log(`   ✅ Encontradas ${sitemapUrls.length} URLs no sitemap`);
      urls = prioritizeUrls(sitemapUrls);
    } else {
      console.log(`   ⚠️  Nenhuma URL encontrada no sitemap, usando apenas homepage`);
      urls = [homepage];
    }
  } else {
    urls = [homepage];
  }

  // Limitar número de URLs
  const limitedUrls = urls.slice(0, CONFIG.MAX_URLS_PER_REPO);
  console.log(`   📊 Testando ${limitedUrls.length} URL(s)`);
  
  return limitedUrls;
}

// ----------------------
// Ler CSV de Repositórios
// ----------------------
async function readRepositories() {
  return new Promise((resolve, reject) => {
    const repos = [];
    
    if (!fs.existsSync('repositorios_com_homepage.csv')) {
      console.error('❌ Arquivo repositorios_com_homepage.csv não encontrado!');
      console.error('   Execute extract-homepages.js primeiro.');
      process.exit(1);
    }

    fs.createReadStream('repositorios_com_homepage.csv')
      .pipe(csv())
      .on('data', (row) => {
        repos.push({
          repositorio: row['Repositorio'] || row['Repositório'],
          homepage: row['Homepage'],
          estrelas: row['Estrelas'],
          ultimoCommit: row['Ultimo_Commit'] || row['Último_Commit'],
        });
      })
      .on('end', () => {
        console.log(`📋 Carregados ${repos.length} repositórios com homepage`);
        resolve(repos);
      })
      .on('error', reject);
  });
}

// ----------------------
// Agregar Resultados
// ----------------------
function aggregateResults(results) {
  if (results.length === 0) {
    return {
      erros_total: 0,
      alertas_total: 0,
      features_total: 0,
      structural_total: 0,
      aria_total: 0,
      contrast_total: 0,
      html5_total: 0,
      erros_media: 0,
      alertas_media: 0,
      features_media: 0,
      urls_testadas: 0,
      urls_com_erro: 0,
    };
  }

  const totals = results.reduce((acc, r) => ({
    erros: acc.erros + Math.max(0, r.erros),
    alertas: acc.alertas + Math.max(0, r.alertas),
    features: acc.features + Math.max(0, r.features),
    structural: acc.structural + Math.max(0, r.structural),
    aria: acc.aria + Math.max(0, r.aria),
    contrast: acc.contrast + Math.max(0, r.contrast),
    html5: acc.html5 + Math.max(0, r.html5),
    comErro: acc.comErro + (r.erros === -1 ? 1 : 0),
  }), { 
    erros: 0, 
    alertas: 0, 
    features: 0, 
    structural: 0, 
    aria: 0, 
    contrast: 0, 
    html5: 0, 
    comErro: 0 
  });

  const validResults = results.filter(r => r.erros >= 0).length;

  return {
    erros_total: totals.erros,
    alertas_total: totals.alertas,
    features_total: totals.features,
    structural_total: totals.structural,
    aria_total: totals.aria,
    contrast_total: totals.contrast,
    html5_total: totals.html5,
    erros_media: validResults > 0 ? (totals.erros / validResults).toFixed(2) : 0,
    alertas_media: validResults > 0 ? (totals.alertas / validResults).toFixed(2) : 0,
    features_media: validResults > 0 ? (totals.features / validResults).toFixed(2) : 0,
    urls_testadas: results.length,
    urls_com_erro: totals.comErro,
  };
}

// ----------------------
// Salvar Resultados
// ----------------------
async function saveResults(allResults) {
  const csvWriter = createCsvWriter({
    path: 'wave_ci_results.csv',
    header: [
      { id: 'repositorio', title: 'Repositorio' },
      { id: 'homepage', title: 'Homepage' },
      { id: 'estrelas', title: 'Estrelas' },
      { id: 'erros_total', title: 'Erros_Total' },
      { id: 'alertas_total', title: 'Alertas_Total' },
      { id: 'features_total', title: 'Features_Total' },
      { id: 'structural_total', title: 'Structural_Total' },
      { id: 'aria_total', title: 'ARIA_Total' },
      { id: 'contrast_total', title: 'Contrast_Total' },
      { id: 'html5_total', title: 'HTML5_Total' },
      { id: 'erros_media', title: 'Erros_Media' },
      { id: 'alertas_media', title: 'Alertas_Media' },
      { id: 'features_media', title: 'Features_Media' },
      { id: 'urls_testadas', title: 'URLs_Testadas' },
      { id: 'urls_com_erro', title: 'URLs_Com_Erro' },
    ],
  });

  await csvWriter.writeRecords(allResults);
  console.log('\n📄 Resultados salvos em wave_ci_results.csv');
}

// ----------------------
// Execução Principal
// ----------------------
(async () => {
  console.log('🌊 WAVE CI RUNNER - Análise de Acessibilidade');
  console.log(`📊 Configurações: MAX_URLS=${CONFIG.MAX_URLS_PER_REPO}, USE_SITEMAP=${CONFIG.USE_SITEMAP}`);
  console.log('');

  // Verificar se wave.min.js existe
  const waveScriptPath = path.join(__dirname, 'wave-extension', 'wave.min.js');
  if (!fs.existsSync(waveScriptPath)) {
    console.error('❌ Arquivo wave-extension/wave.min.js não encontrado!');
    console.error('   Certifique-se de que a extensão WAVE está no diretório wave-extension/');
    process.exit(1);
  }

  const repos = await readRepositories();
  const allResults = [];
  let totalRepositorios = 0;
  let totalComErro = 0;

  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${i + 1}/${repos.length}] 📦 ${repo.repositorio}`);
    console.log(`🔗 Homepage: ${repo.homepage}`);
    console.log(`${'='.repeat(80)}`);

    try {
      // Obter URLs para testar
      const urls = await getUrlsToTest(repo.homepage);
      const urlResults = [];

      // Testar cada URL
      for (let j = 0; j < urls.length; j++) {
        const url = urls[j];
        console.log(`\n   [${j + 1}/${urls.length}] 🔍 ${url}`);
        
        const result = await runWave(url);
        urlResults.push(result);

        console.log(`   📊 Erros: ${result.erros}, Alertas: ${result.alertas}, Features: ${result.features}`);
        
        // Pausa entre requisições
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Agregar resultados
      const aggregated = aggregateResults(urlResults);
      
      allResults.push({
        repositorio: repo.repositorio,
        homepage: repo.homepage,
        estrelas: repo.estrelas,
        ...aggregated,
      });

      totalRepositorios++;
      
      if (aggregated.urls_com_erro > 0) {
        totalComErro++;
      }

      console.log(`\n   ✅ Concluído: ${aggregated.urls_testadas} URLs testadas`);
      console.log(`   📊 Total - Erros: ${aggregated.erros_total}, Alertas: ${aggregated.alertas_total}`);

    } catch (err) {
      console.error(`\n   ❌ Erro ao processar repositório: ${err.message}`);
      totalComErro++;
      
      allResults.push({
        repositorio: repo.repositorio,
        homepage: repo.homepage,
        estrelas: repo.estrelas,
        erros_total: -1,
        alertas_total: -1,
        features_total: -1,
        structural_total: -1,
        aria_total: -1,
        contrast_total: -1,
        html5_total: -1,
        erros_media: -1,
        alertas_media: -1,
        features_media: -1,
        urls_testadas: 0,
        urls_com_erro: 1,
      });
    }
  }

  // Salvar resultados
  await saveResults(allResults);

  // Resumo final
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 RESUMO DA ANÁLISE WAVE');
  console.log(`${'='.repeat(80)}`);
  console.log(`📋 Total de repositórios: ${totalRepositorios}`);
  console.log(`✅ Analisados com sucesso: ${totalRepositorios - totalComErro}`);
  console.log(`❌ Com erro: ${totalComErro}`);
  console.log('');
  console.log('📄 Arquivo gerado:');
  console.log('   - wave_ci_results.csv');
  console.log('');

  process.exit(0);
})();

