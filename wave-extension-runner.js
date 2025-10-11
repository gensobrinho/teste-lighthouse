const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Sitemapper precisa de import dinâmico (ES Module)
let Sitemapper;

/**
 * Script para executar análise WAVE de acessibilidade usando a extensão completa
 * 
 * Carrega a extensão WAVE do diretório wave-extension/ no navegador:
 * 1. Inicia Puppeteer com a extensão carregada
 * 2. Navega para a URL
 * 3. Aciona a extensão WAVE
 * 4. Captura resultados via interceptação de mensagens
 * 5. Salva em wave_ci_results.csv
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
  WAVE_TIMEOUT: 90000,

  // Tempo de espera para WAVE processar (ms)
  WAVE_PROCESSING_TIME: 10000,

  // Número de tentativas em caso de erro
  MAX_RETRIES: 1,
};

// ----------------------
// Funções WAVE com Extensão
// ----------------------
async function createBrowserWithExtension() {
  const extensionPath = path.resolve('./wave-extension');
  
  // Verificar se a extensão existe
  if (!fs.existsSync(extensionPath)) {
    throw new Error('Diretório wave-extension/ não encontrado!');
  }

  // Criar manifest.json temporário sem ícones para evitar erro
  const originalManifestPath = path.join(extensionPath, 'manifest.json');
  const backupManifestPath = path.join(extensionPath, 'manifest.json.backup');
  
  try {
    // Fazer backup do manifest original
    const originalManifest = JSON.parse(fs.readFileSync(originalManifestPath, 'utf8'));
    fs.writeFileSync(backupManifestPath, JSON.stringify(originalManifest, null, 2));
    
    // Criar manifest sem referências a ícones
    const modifiedManifest = { ...originalManifest };
    delete modifiedManifest.icons;
    delete modifiedManifest.action;
    
    // Adicionar action básico sem ícones
    modifiedManifest.action = {
      default_title: "WAVE"
    };
    
    fs.writeFileSync(originalManifestPath, JSON.stringify(modifiedManifest, null, 2));
  } catch (err) {
    console.log(`   ⚠️  Aviso: Não foi possível modificar manifest.json: ${err.message}`);
  }

  const browser = await puppeteer.launch({
    headless: false, // Extensões requerem modo não-headless
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ]
  });

  return browser;
}

async function restoreOriginalManifest() {
  const extensionPath = path.resolve('./wave-extension');
  const originalManifestPath = path.join(extensionPath, 'manifest.json');
  const backupManifestPath = path.join(extensionPath, 'manifest.json.backup');
  
  try {
    if (fs.existsSync(backupManifestPath)) {
      fs.copyFileSync(backupManifestPath, originalManifestPath);
      fs.unlinkSync(backupManifestPath);
      console.log('✅ Manifest original restaurado');
    }
  } catch (err) {
    console.log(`⚠️  Aviso: Não foi possível restaurar manifest: ${err.message}`);
  }
}

async function runWaveWithExtension(browser, url, retry = 0) {
  console.log(`🌊 Rodando WAVE em ${url}`);
  const start = Date.now();
  let page;

  try {
    page = await browser.newPage();
    
    // Navegar para a página
    const response = await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: CONFIG.WAVE_TIMEOUT 
    });

    if (!response || !response.ok()) {
      throw new Error(`Falha ao carregar página (${response?.status()})`);
    }

    // Aguardar página estabilizar
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log(`   🔧 Acionando extensão WAVE (Ctrl+Shift+U)...`);
    
    // Acionar extensão WAVE via atalho de teclado
    await page.keyboard.down('Control');
    await page.keyboard.down('Shift');
    await page.keyboard.press('U');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');

    console.log(`   ⏳ Aguardando WAVE processar (${CONFIG.WAVE_PROCESSING_TIME / 1000}s)...`);
    
    // Aguardar WAVE processar a página
    await new Promise(resolve => setTimeout(resolve, CONFIG.WAVE_PROCESSING_TIME));

    // Tentar capturar resultados WAVE com múltiplas tentativas
    let result = null;
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      attempts++;
      
      result = await page.evaluate(() => {
        try {
          // Verificar se WAVE foi injetado
          const waveScript = document.getElementById('wavescript');
          const waveIframe = document.getElementById('wave5-sidebar');
          
          if (!waveScript && !waveIframe && typeof WAVE === 'undefined') {
            return { 
              success: false, 
              error: 'WAVE não foi injetado na página',
              retry: true
            };
          }

          // Tentar acessar resultados WAVE
          if (typeof WAVE !== 'undefined') {
            // Explorar estrutura do objeto WAVE
            const waveKeys = Object.keys(WAVE);
            
            // Tentar diferentes localizações de resultados
            const data = WAVE.results || WAVE.report || WAVE.data || null;
            
            if (data && data.categories) {
              return {
                success: true,
                erros: data.categories.error?.count || 0,
                alertas: data.categories.alert?.count || 0,
                features: data.categories.feature?.count || 0,
                structural: data.categories.structure?.count || 0,
                aria: data.categories.aria?.count || 0,
                contrast: data.categories.contrast?.count || 0,
                html5: data.categories.html5?.count || 0
              };
            }
            
            return {
              success: false,
              error: 'WAVE encontrado mas estrutura desconhecida',
              debug: waveKeys.join(', '),
              retry: false
            };
          }

          // Verificar se há elementos WAVE na página (extensão pode estar ativa)
          if (waveScript || waveIframe) {
            return {
              success: false,
              error: 'WAVE injetado mas objeto global não disponível',
              retry: true
            };
          }

          return { success: false, error: 'WAVE não disponível', retry: true };
        } catch (err) {
          return { success: false, error: err.message, retry: false };
        }
      });

      if (result.success || !result.retry) {
        break;
      }

      if (attempts < maxAttempts) {
        console.log(`   🔄 Tentativa ${attempts}/${maxAttempts} - aguardando mais 3s...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    console.log(`   ✅ Concluído (${((Date.now() - start) / 1000).toFixed(2)}s)`);

    if (result.success) {
      return {
        erros: result.erros,
        alertas: result.alertas,
        features: result.features,
        structural: result.structural,
        aria: result.aria,
        contrast: result.contrast,
        html5: result.html5
      };
    } else {
      console.log(`   ⚠️  ${result.error}${result.debug ? ` (${result.debug})` : ''}`);
      return {
        erros: -1,
        alertas: -1,
        features: -1,
        structural: -1,
        aria: -1,
        contrast: -1,
        html5: -1
      };
    }

  } catch (err) {
    console.error(`   ❌ ${url} - ${err.message}`);
    fs.appendFileSync('errors.log', `[${new Date().toISOString()}] ${url}\n${err.stack}\n\n`);
    
    if (retry < CONFIG.MAX_RETRIES) {
      console.log(`   🔁 Tentando novamente (${retry + 1})...`);
      await new Promise(r => setTimeout(r, 3000));
      return runWaveWithExtension(browser, url, retry + 1);
    }
    
    return {
      erros: -1,
      alertas: -1,
      features: -1,
      structural: -1,
      aria: -1,
      contrast: -1,
      html5: -1
    };
  } finally {
    if (page) await page.close().catch(() => {});
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
      urls_testadas: 0,
      urls_sucesso: 0,
      erros_total: 0,
      alertas_total: 0,
      features_total: 0,
      structural_total: 0,
      aria_total: 0,
      contrast_total: 0,
      html5_total: 0,
    };
  }

  const validResults = results.filter(r => r.erros >= 0);
  
  const totals = validResults.reduce((acc, r) => ({
    erros: acc.erros + r.erros,
    alertas: acc.alertas + r.alertas,
    features: acc.features + r.features,
    structural: acc.structural + r.structural,
    aria: acc.aria + r.aria,
    contrast: acc.contrast + r.contrast,
    html5: acc.html5 + r.html5,
  }), { 
    erros: 0, 
    alertas: 0, 
    features: 0, 
    structural: 0, 
    aria: 0, 
    contrast: 0, 
    html5: 0 
  });

  return {
    urls_testadas: results.length,
    urls_sucesso: validResults.length,
    erros_total: totals.erros,
    alertas_total: totals.alertas,
    features_total: totals.features,
    structural_total: totals.structural,
    aria_total: totals.aria,
    contrast_total: totals.contrast,
    html5_total: totals.html5,
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
      { id: 'urls_testadas', title: 'URLs_Testadas' },
      { id: 'urls_sucesso', title: 'URLs_Sucesso' },
      { id: 'erros_total', title: 'Erros_Total' },
      { id: 'alertas_total', title: 'Alertas_Total' },
      { id: 'features_total', title: 'Features_Total' },
      { id: 'structural_total', title: 'Structural_Total' },
      { id: 'aria_total', title: 'ARIA_Total' },
      { id: 'contrast_total', title: 'Contrast_Total' },
      { id: 'html5_total', title: 'HTML5_Total' },
    ],
  });

  await csvWriter.writeRecords(allResults);
  console.log('\n📄 Resultados salvos em wave_ci_results.csv');
}

// ----------------------
// Execução Principal
// ----------------------
(async () => {
  console.log('🌊 WAVE EXTENSION RUNNER - Análise de Acessibilidade');
  console.log('📌 ATENÇÃO: Este script abre um navegador VISÍVEL (não-headless)');
  console.log(`📊 Configurações: MAX_URLS=${CONFIG.MAX_URLS_PER_REPO}, USE_SITEMAP=${CONFIG.USE_SITEMAP}`);
  console.log('');
  console.log('💡 DICAS:');
  console.log('   - O script tenta acionar WAVE via Ctrl+Shift+U automaticamente');
  console.log('   - Se não funcionar, clique no ícone WAVE na barra de ferramentas');
  console.log('   - Aguarda 10s para WAVE processar cada página');
  console.log('');

  // Handler para restaurar manifest em caso de interrupção
  process.on('SIGINT', async () => {
    console.log('\n\n⚠️  Interrompido pelo usuário...');
    await restoreOriginalManifest();
    process.exit(1);
  });

  const repos = await readRepositories();
  const results = [];
  let totalRodados = 0;
  let totalErros = 0;

  console.log('🚀 Iniciando navegador com extensão WAVE...');
  let browser;
  
  try {
    browser = await createBrowserWithExtension();
    console.log('✅ Navegador iniciado com extensão carregada!\n');

    for (const repo of repos) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📦 Repositório: ${repo.repositorio}`);
      console.log(`🌐 Homepage: ${repo.homepage}`);
      console.log(`${'='.repeat(80)}`);

      const urlsToAnalyze = await getUrlsToTest(repo.homepage);
      const urlResults = [];
      let successCount = 0;

      for (let i = 0; i < urlsToAnalyze.length; i++) {
        const url = urlsToAnalyze[i];
        console.log(`\n   📄 [${i + 1}/${urlsToAnalyze.length}] ${url}`);

        const waveResult = await runWaveWithExtension(browser, url);

        if (waveResult && waveResult.erros >= 0) {
          urlResults.push(waveResult);
          successCount++;
          console.log(`      ✓ Erros: ${waveResult.erros} | Alertas: ${waveResult.alertas}`);
        } else {
          urlResults.push(waveResult);
          console.log(`      ✗ Falha`);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (successCount === 0) {
        console.log(`\n❌ Falha em todas as URLs`);
        totalErros++;
        results.push({
          repositorio: repo.repositorio,
          homepage: repo.homepage,
          urls_testadas: urlsToAnalyze.length,
          urls_sucesso: 0,
          erros_total: -1,
          alertas_total: -1,
          features_total: -1,
          structural_total: -1,
          aria_total: -1,
          contrast_total: -1,
          html5_total: -1,
        });
        continue;
      }

      const aggr = aggregateResults(urlResults);

      console.log(`\n✅ Agregado (${successCount}/${urlsToAnalyze.length}):`);
      console.log(`   Erros: ${aggr.erros_total} | Alertas: ${aggr.alertas_total} | Features: ${aggr.features_total}`);

      totalRodados++;

      results.push({
        repositorio: repo.repositorio,
        homepage: repo.homepage,
        ...aggr,
      });

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

  } finally {
    if (browser) {
      console.log('\n🔚 Fechando navegador...');
      await browser.close();
    }
    
    // Restaurar manifest original
    await restoreOriginalManifest();
  }

  // Salvar resultados
  await saveResults(results);

  // Resumo final
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 RESUMO DA ANÁLISE WAVE');
  console.log(`${'='.repeat(80)}`);
  console.log(`✅ Sucesso: ${totalRodados} | ❌ Erros: ${totalErros}`);
  console.log(`📈 Taxa: ${((totalRodados / repos.length) * 100).toFixed(1)}%`);
  console.log('\n📄 Gerado: wave_ci_results.csv\n');

  process.exit(0);
})();

