const fs = require('fs');
const puppeteer = require('puppeteer');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Sitemapper precisa de import dinâmico (ES Module)
let Sitemapper;

/**
* NOTA: Métricas de Cobertura WCAG foram removidas devido a inconsistências metodológicas.
* 
* PROBLEMA IDENTIFICADO:
* - Ferramentas testam múltiplas versões WCAG simultaneamente (2.0, 2.1, 2.2)
* - Difícil determinar denominador correto (61, 78 ou 86 critérios?)
* - Taxa de cobertura pode estar inflada ou deflada dependendo da versão
* 
* MÉTRICAS REMOVIDAS:
* - WCAG_CriteriosTotal: Total de critérios WCAG (problemático por versão mista)
* - CriteriosTestados: Critérios únicos testados pela ferramenta
* - TaxaCobertura: Porcentagem de cobertura sobre o padrão WCAG
* 
* IMPLEMENTAÇÃO FUTURA (se necessário):
* 1. Detectar dinamicamente a versão WCAG máxima testada
* 2. Usar denominador apropriado por versão:
*    - WCAG 2.0: 61 critérios
*    - WCAG 2.1: 78 critérios  
*    - WCAG 2.2: 86 critérios
* 3. Ou usar 86 como denominador universal para consistência
* 
* REFERÊNCIA (não usada, removida por ser problemática):
* Abu Doush et al. (2023): "~44% dos critérios WCAG 2.1 podem ser totalmente automatizados"
* - Porém, essa porcentagem varia por ferramenta e versão WCAG
* - Comparação direta não é cientificamente válida sem ajustes
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
    };

  console.log(`\n✅ Análise agregada concluída (${successCount}/${urlsToAnalyze.length} URLs):`);
  console.log(`   ❌ Violações (total): ${aggregatedResult.violacoes}`);
  console.log(`   ⚠️  Warnings (total): ${aggregatedResult.warnings}`);
  console.log(`   📈 WCAG - A: ${aggregatedResult.nivelA} | AA: ${aggregatedResult.nivelAA} | AAA: ${aggregatedResult.nivelAAA}`);

  totalRodados++;

  // Calcula taxa de sucesso simples (inverso da densidade de violações)
  const totalChecks = aggregatedResult.violacoes + aggregatedResult.warnings;
  const taxaSucesso = totalChecks > 0 
    ? (1 - (aggregatedResult.violacoes / totalChecks)).toFixed(4)
    : 1.0000;

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
    taxa_sucesso_acessibilidade: taxaSucesso
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
console.log("   - axe_ci_results.csv");
console.log("");

// Força encerramento do processo para o GitHub Actions seguir para o próximo step
process.exit(0);
})();

