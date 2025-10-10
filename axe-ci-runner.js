const fs = require('fs');
const puppeteer = require('puppeteer');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Sitemapper precisa de import dinâmico (ES Module)
let Sitemapper;

/**
* WCAG 2.2 - Total de critérios de sucesso
* Fonte: W3C Web Content Accessibility Guidelines (WCAG) 2.2
* https://www.w3.org/WAI/standards-guidelines/wcag/
*
* Total de critérios WCAG 2.2 = 58
*
* Cobertura automatizável (~44%) segundo Abu Doush et al. (2023):
* "apenas cerca de 44% dos critérios de acessibilidade estabelecidos pela WCAG 2.1
* podem ser totalmente automatizados com tecnologias padrão"
*
* Esse fator é mantido para WCAG 2.2 por similaridade, mas idealmente deveria ser recalculado
* com base em um mapeamento atualizado dos critérios 2.2.
*/
const WCAG_TOTAL_CRITERIA = 58;
const WCAG_AUTOMATIZAVEL = Math.round(WCAG_TOTAL_CRITERIA * 0.44); // ~26 critérios

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
};

// ----------------------
// Funções AXE
// ----------------------
function classifyByLevel(errors, extractor) {
let nivelA = 0, nivelAA = 0, nivelAAA = 0, indefinido = 0;
errors.forEach(err => {
  const level = extractor(err);
  if (!level) {
    indefinido++;
  } else if (level.includes('wcag2a') || level.includes('Level A')) {
    nivelA++;
  } else if (level.includes('wcag2aa') || level.includes('Level AA')) {
    nivelAA++;
  } else if (level.includes('wcag2aaa') || level.includes('Level AAA')) {
    nivelAAA++;
  } else {
    indefinido++;
  }
});
return { nivelA, nivelAA, nivelAAA, indefinido };
}

async function runAxe(url) {
console.log(`🚀 Iniciando AXE em ${url}`);
try {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  const axeSource = fs.readFileSync(require.resolve('axe-core'), 'utf8');
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => await axe.run());

  const confirmedViolations = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  const warnings = results.violations.filter(v => v.impact === 'moderate' || v.impact === 'minor');

  const levels = classifyByLevel(confirmedViolations, v => v.tags.join(' '));

  await browser.close();
  return {
    violacoes: confirmedViolations.length,
    warnings: warnings.length,
    erros: confirmedViolations.map(v => v.id),
    ...levels
  };
} catch (err) {
  console.error(`❌ Erro no AXE/Puppeteer: ${err.message}`);
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
  path: 'axe_ci_results.csv',
  header: [
    { id: 'repositorio', title: 'Repositorio' },
    { id: 'homepage', title: 'Homepage' },
    { id: 'urls_analisadas', title: 'URLs_Analisadas' },
    { id: 'urls_sucesso', title: 'URLs_Sucesso' },
    { id: 'status', title: 'Status' },
    { id: 'violacoes_total', title: 'ViolacoesTotal' },
    { id: 'warnings_total', title: 'WarningsTotal' },
    { id: 'violacoes_A', title: 'ViolacoesA' },
    { id: 'violacoes_AA', title: 'ViolacoesAA' },
    { id: 'violacoes_AAA', title: 'ViolacoesAAA' },
    { id: 'violacoes_indefinido', title: 'ViolacoesIndefinido' },
    { id: 'criterios_total', title: 'WCAG_CriteriosTotal' },
    { id: 'criterios_automatizaveis', title: 'WCAG_CriteriosAutomatizaveis' },
    { id: 'cer', title: 'CER' },
    { id: 'taxa_sucesso_acessibilidade', title: 'TaxaSucessoAcessibilidade' }
  ]
});
await csvWriter.writeRecords(results);
console.log('📄 Resultados salvos em axe_ci_results.csv');
}

// ----------------------
// Execução principal
// ----------------------
(async () => {
console.log("🚀 AXE CORE RUNNER - ANÁLISE DE ACESSIBILIDADE");
console.log("=".repeat(80));
console.log("");

const repos = await readRepositories();
const results = [];
const toolErrorsMap = {};
let totalRodados = 0;
let totalErros = 0;

for (const repo of repos) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📦 Repositório: ${repo.repositorio}`);
  console.log(`🌐 Homepage: ${repo.homepage}`);
  console.log(`${"=".repeat(80)}`);

  // Buscar URLs do sitemap
  const urlsToAnalyze = await getSitemapUrls(repo.homepage);

  // Executar AXE em cada URL
  const urlResults = [];
  let successCount = 0;

  for (let i = 0; i < urlsToAnalyze.length; i++) {
    const url = urlsToAnalyze[i];
    console.log(`\n   📄 [${i + 1}/${urlsToAnalyze.length}] Analisando: ${url}`);

    const axeResult = await runAxe(url);

    if (axeResult) {
      urlResults.push({ url, ...axeResult });
      successCount++;
      console.log(`      ✓ Violações: ${axeResult.violacoes} | Warnings: ${axeResult.warnings}`);
    } else {
      console.log(`      ✗ Falha na análise`);
    }

    // Pausa entre URLs
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Verifica se houve algum sucesso
  if (urlResults.length === 0) {
    console.log(`\n❌ Falha ao executar AXE em todas as URLs`);
    totalErros++;
    results.push({
      repositorio: repo.repositorio,
      homepage: repo.homepage,
      urls_analisadas: urlsToAnalyze.length,
      urls_sucesso: 0,
      status: 'ERROR',
      violacoes_total: null,
      warnings_total: null,
      violacoes_A: null,
      violacoes_AA: null,
      violacoes_AAA: null,
      violacoes_indefinido: null,
      criterios_total: WCAG_TOTAL_CRITERIA,
      criterios_automatizaveis: WCAG_AUTOMATIZAVEL,
      cer: null,
      taxa_sucesso_acessibilidade: null
    });
    continue;
  }

  // Agregar resultados (soma de violações)
  const aggregatedResult = {
    violacoes: urlResults.reduce((sum, r) => sum + r.violacoes, 0),
    warnings: urlResults.reduce((sum, r) => sum + r.warnings, 0),
    nivelA: urlResults.reduce((sum, r) => sum + r.nivelA, 0),
    nivelAA: urlResults.reduce((sum, r) => sum + r.nivelAA, 0),
    nivelAAA: urlResults.reduce((sum, r) => sum + r.nivelAAA, 0),
    indefinido: urlResults.reduce((sum, r) => sum + r.indefinido, 0),
    erros: [...new Set(urlResults.flatMap(r => r.erros))], // Unique errors
  };

  console.log(`\n✅ Análise agregada concluída (${successCount}/${urlsToAnalyze.length} URLs):`);
  console.log(`   ❌ Violações (total): ${aggregatedResult.violacoes}`);
  console.log(`   ⚠️  Warnings (total): ${aggregatedResult.warnings}`);
  console.log(`   📈 WCAG - A: ${aggregatedResult.nivelA} | AA: ${aggregatedResult.nivelAA} | AAA: ${aggregatedResult.nivelAAA}`);

  toolErrorsMap['AXE'] = new Set(aggregatedResult.erros);
  totalRodados++;

  results.push({
    repositorio: repo.repositorio,
    homepage: repo.homepage,
    urls_analisadas: urlsToAnalyze.length,
    urls_sucesso: successCount,
    status: 'SUCCESS',
    violacoes_total: aggregatedResult.violacoes,
    warnings_total: aggregatedResult.warnings,
    violacoes_A: aggregatedResult.nivelA,
    violacoes_AA: aggregatedResult.nivelAA,
    violacoes_AAA: aggregatedResult.nivelAAA,
    violacoes_indefinido: aggregatedResult.indefinido,
    criterios_total: WCAG_TOTAL_CRITERIA,
    criterios_automatizaveis: WCAG_AUTOMATIZAVEL,
    cer: 0,
    taxa_sucesso_acessibilidade: ((WCAG_AUTOMATIZAVEL - aggregatedResult.violacoes) / WCAG_AUTOMATIZAVEL).toFixed(2)
  });

  // Pausa entre repositórios
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

const allErrorsGlobal = new Set();
Object.values(toolErrorsMap).forEach(set => {
  set.forEach(err => allErrorsGlobal.add(err));
});

results.forEach(r => {
  if (r.status === 'OK' && allErrorsGlobal.size > 0) {
    const toolSet = toolErrorsMap['AXE'] || new Set();
    r.cer = (toolSet.size / allErrorsGlobal.size).toFixed(2);
  }
});

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
console.log("   - axe_ci_results.csv");
console.log("");

// Força encerramento do processo para o GitHub Actions seguir para o próximo step
process.exit(0);
})();

