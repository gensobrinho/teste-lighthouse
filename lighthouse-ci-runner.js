const fs = require("fs");
const fetch = require("node-fetch");
const { execSync } = require("child_process");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const csv = require("csv-parser");

// Sitemapper precisa de import dinâmico (ES Module)
let Sitemapper;

/**
 * Lighthouse CI Runner para Análise de Acessibilidade
 *
 * Este script:
 * 1. Lê repositórios do filtrados.csv
 * 2. Busca homepage via GitHub API
 * 3. Executa Lighthouse CI focado em acessibilidade
 * 4. Classifica violações por nível WCAG usando rule-wcag-levels.csv
 * 5. Salva resultados em CSV/JSON
 */

// ----------------------
// Configurações
// ----------------------
const CONFIG = {
  // Número máximo de URLs a analisar por repositório
  MAX_URLS_PER_REPO: 10,

  // Se true, tenta buscar URLs do sitemap
  USE_SITEMAP: true,

  // Se true, valida se URLs estão acessíveis antes de analisar
  VALIDATE_URLS: true,

  // Timeout para buscar sitemap (ms)
  SITEMAP_TIMEOUT: 10000,

  // Priorizar certas páginas (regex patterns)
  PRIORITY_PATTERNS: [
    /\/$/, // Homepage
    /\/about/i, // Sobre
    /\/contact/i, // Contato
    /\/dashboard/i, // Dashboard
    /\/login/i, // Login
  ],
};

/**
* NOTA: Métricas de Cobertura WCAG foram removidas devido a inconsistências metodológicas.
* Para detalhes, consulte os comentários em axe-ci-runner.js
*/

// ----------------------
// Mapeamento de Regras WCAG
// ----------------------
let wcagLevels = {
  A: [],
  AA: [],
  AAA: [],
  "Best Practice": [],
  Experimental: [],
  Deprecated: [],
  None: [],
};

// Função para carregar os níveis WCAG do CSV
async function loadWCAGLevels() {
  return new Promise((resolve, reject) => {
    const levels = {
      A: [],
      AA: [],
      AAA: [],
      "Best Practice": [],
      Experimental: [],
      Deprecated: [],
      None: [],
    };

    fs.createReadStream("rule-wcag-levels.csv")
      .pipe(csv())
      .on("data", (row) => {
        const ruleId = row.rule_id;
        const level = row.conformity_level;

        if (levels[level]) {
          levels[level].push(ruleId);
        }
      })
      .on("end", () => {
        console.log("📋 Níveis WCAG carregados:");
        console.log(`   ✓ Nível A: ${levels.A.length} regras`);
        console.log(`   ✓ Nível AA: ${levels.AA.length} regras`);
        console.log(`   ✓ Nível AAA: ${levels.AAA.length} regras`);
        console.log(
          `   ✓ Best Practice: ${levels["Best Practice"].length} regras`
        );
        console.log(`   ✓ Experimental: ${levels.Experimental.length} regras`);
        console.log(`   ✓ Deprecated: ${levels.Deprecated.length} regras`);
        console.log("");
        resolve(levels);
      })
      .on("error", reject);
  });
}

// ----------------------

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

  // Normaliza a URL base (garante que termine com /)
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  // Lista de locais comuns para sitemap
  const sitemapLocations = [
    `${normalizedBase}sitemap.xml`,
    `${normalizedBase}sitemap_index.xml`,
    `${normalizedBase}sitemap-index.xml`,
    `${normalizedBase}sitemap1.xml`,
    `${normalizedBase}wp-sitemap.xml`, // WordPress
    `${normalizedBase}sitemap/sitemap.xml`,
  ];

  console.log(`🗺️  Buscando sitemap em: ${baseUrl}`);

  // Tenta cada localização
  for (const sitemapUrl of sitemapLocations) {
    try {
      console.log(`   🔍 Tentando: ${sitemapUrl}`);

      const sitemap = new Sitemapper({
        url: sitemapUrl,
        timeout: CONFIG.SITEMAP_TIMEOUT,
        requestHeaders: {
          "User-Agent": "Lighthouse-CI-Runner/1.0",
        },
      });

      const { sites } = await sitemap.fetch();

      if (!sites || sites.length === 0) {
        console.log(`      ⚠️  Sitemap vazio, tentando próximo...`);
        continue; // Tenta próxima localização
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

      // Garante que a homepage está incluída
      const selectedUrls = [baseUrl];

      // Adiciona outras URLs até o limite
      for (const url of sortedUrls) {
        if (selectedUrls.length >= CONFIG.MAX_URLS_PER_REPO) break;
        if (!selectedUrls.includes(url)) {
          selectedUrls.push(url);
        }
      }

      console.log(
        `   ✅ Selecionadas ${selectedUrls.length} URLs para análise`
      );
      selectedUrls.forEach((url, i) => {
        console.log(`      ${i + 1}. ${url}`);
      });

      return selectedUrls; // Sucesso! Retorna as URLs
    } catch (err) {
      console.log(`      ⚠️  ${err.message}`);
      // Continua para próxima localização
    }
  }

  // Se chegou aqui, nenhum sitemap foi encontrado
  console.log(`   ℹ️  Nenhum sitemap encontrado, usando apenas homepage`);
  return [baseUrl];
}

// ----------------------
// Validar se URL está acessível
// ----------------------
async function isUrlAccessible(url) {
  try {
    const response = await fetch(url, {
      method: "HEAD", // Apenas cabeçalhos, não baixa o corpo
      timeout: 10000,
      headers: {
        "User-Agent": "Lighthouse-CI-Runner/1.0",
      },
    });

    // Considera sucesso: 200-399 (inclui redirects)
    return response.status >= 200 && response.status < 400;
  } catch (err) {
    return false;
  }
}

// ----------------------
// Executar Lighthouse CI
// ----------------------
async function runLighthouseCI(url, repoName) {
  console.log(`🚀 Executando Lighthouse CI em: ${url}`);

  try {
    // Cria diretório temporário para resultados
    const tempDir = `./.lighthouseci/${repoName.replace(/\//g, "_")}`;
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Copia o arquivo de configuração para o diretório temporário
    fs.copyFileSync(".lighthouserc.js", `${tempDir}/.lighthouserc.js`);

    // Executa Lighthouse CI via CLI usando o arquivo de configuração
    // O .lighthouserc.js contém todas as configurações (numberOfRuns, chromeFlags, categories, etc)
    const command = `npx --yes @lhci/cli@0.13.x collect --config=.lighthouserc.js --url="${url}"`;

    console.log(`   ⚙️  Executando: ${command}`);
    execSync(command, {
      cwd: tempDir,
      stdio: "inherit",
      timeout: 120000, // 2 minutos timeout
    });

    // Lê o resultado do arquivo JSON gerado
    const files = fs.readdirSync(`${tempDir}/.lighthouseci`);
    const lhrFile = files.find((f) => f.endsWith(".json"));

    if (!lhrFile) {
      console.error("❌ Nenhum arquivo de resultado encontrado");
      return null;
    }

    const lhrPath = `${tempDir}/.lighthouseci/${lhrFile}`;
    const lhr = JSON.parse(fs.readFileSync(lhrPath, "utf8"));

    // Extrai dados de acessibilidade
    const accessibility = lhr.categories.accessibility;
    const audits = lhr.audits;

    // Conta violações por nível WCAG
    let nivelA = 0,
      nivelAA = 0,
      nivelAAA = 0,
      bestPractice = 0,
      experimental = 0,
      deprecated = 0,
      indefinido = 0;
    let violacoes = [];
    let warnings = [];

    for (const [auditId, audit] of Object.entries(audits)) {
      if (audit.score !== null && audit.score < 1) {
        const details = {
          id: auditId,
          title: audit.title,
          description: audit.description,
          score: audit.score,
        };

        // Classifica por severidade
        if (audit.score === 0) {
          violacoes.push(details);

          // Classifica por nível WCAG usando o mapeamento do CSV
          if (wcagLevels.A.includes(auditId)) {
            nivelA++;
          } else if (wcagLevels.AA.includes(auditId)) {
            nivelAA++;
          } else if (wcagLevels.AAA.includes(auditId)) {
            nivelAAA++;
          } else if (wcagLevels["Best Practice"].includes(auditId)) {
            bestPractice++;
          } else if (wcagLevels.Experimental.includes(auditId)) {
            experimental++;
          } else if (wcagLevels.Deprecated.includes(auditId)) {
            deprecated++;
          } else {
            indefinido++;
          }
        } else {
          warnings.push(details);
        }
      }
    }

    // Limpa diretório temporário
    fs.rmSync(tempDir, { recursive: true, force: true });

    return {
      score: accessibility.score,
      scoreDisplay: (accessibility.score * 100).toFixed(0),
      violacoes: violacoes.length,
      warnings: warnings.length,
      nivelA,
      nivelAA,
      nivelAAA,
      bestPractice,
      experimental,
      deprecated,
      indefinido,
      detalhesViolacoes: violacoes,
      detalhesWarnings: warnings,
      numericValues: {
        performance: lhr.categories.performance?.score || 0,
        accessibility: lhr.categories.accessibility?.score || 0,
        bestPractices: lhr.categories["best-practices"]?.score || 0,
        seo: lhr.categories.seo?.score || 0,
      },
    };
  } catch (err) {
    console.error(`❌ Erro ao executar Lighthouse CI: ${err.message}`);
    return null;
  }
}

// ----------------------
// Ler CSV de Repositórios com Homepage
// ----------------------
async function readRepositories() {
  const csvFile = "repositorios_com_homepage.csv";
  
  // Verifica se o arquivo existe
  if (!fs.existsSync(csvFile)) {
    console.error(`❌ ERRO: Arquivo ${csvFile} não encontrado!`);
    console.error("");
    console.error("   Execute primeiro:");
    console.error("   $ npm run extract-homepages");
    console.error("");
    console.error("   Isso irá gerar o CSV com os repositórios e suas URLs.");
    console.error("");
    process.exit(1);
  }
  
  console.log(`📂 Lendo arquivo: ${csvFile}`);
  console.log(`   ✅ Usando CSV com URLs pré-carregadas (sem chamadas à API)`);
  
  return new Promise((resolve, reject) => {
    const repos = [];
    fs.createReadStream(csvFile)
      .pipe(csv())
      .on("data", (row) => {
        const repositorio = row["Repositorio"] || row["Repositório"];
        const homepage = row["Homepage"];
        
        // Só adiciona repos que TÊM homepage
        if (repositorio && homepage && homepage.trim() !== "") {
          repos.push({
            repositorio: repositorio.trim(),
            homepage: homepage.trim(),
          });
        }
      })
      .on("end", () => {
        console.log(`📋 Carregados ${repos.length} repositórios com homepage`);
        console.log(`   ✅ Todos prontos para análise!`);
        console.log("");
        resolve(repos);
      })
      .on("error", reject);
  });
}

// ----------------------
// Salvar Resultados
// ----------------------
async function saveResults(results) {
  // Salvar CSV
  const csvWriter = createCsvWriter({
    path: "lighthouse_ci_results.csv",
    header: [
      { id: "repositorio", title: "Repositorio" },
      { id: "homepage", title: "Homepage" },
      { id: "urls_analisadas", title: "URLs_Analisadas" },
      { id: "urls_sucesso", title: "URLs_Sucesso" },
      { id: "status", title: "Status" },
      { id: "score", title: "Score_Acessibilidade" },
      { id: "scoreDisplay", title: "Score_Display" },
      { id: "violacoes", title: "Total_Violacoes" },
      { id: "warnings", title: "Total_Warnings" },
      { id: "nivelA", title: "Violacoes_Nivel_A" },
      { id: "nivelAA", title: "Violacoes_Nivel_AA" },
      { id: "nivelAAA", title: "Violacoes_Nivel_AAA" },
      { id: "bestPractice", title: "Violacoes_Best_Practice" },
      { id: "experimental", title: "Violacoes_Experimental" },
      { id: "deprecated", title: "Violacoes_Deprecated" },
      { id: "indefinido", title: "Violacoes_Indefinido" },
      { id: "taxa_sucesso_acessibilidade", title: "TaxaSucessoAcessibilidade" },
      { id: "performance", title: "Performance_Score" },
      { id: "bestPractices", title: "Best_Practices_Score" },
      { id: "seo", title: "SEO_Score" },
    ],
  });

  await csvWriter.writeRecords(results);
  console.log("📄 Resultados salvos em lighthouse_ci_results.csv");

  // Salvar JSON detalhado
  fs.writeFileSync(
    "lighthouse_ci_results.json",
    JSON.stringify(results, null, 2)
  );
  console.log("📄 Resultados detalhados salvos em lighthouse_ci_results.json");
}

// ----------------------
// Execução Principal
// ----------------------
(async () => {
  console.log("🚀 LIGHTHOUSE CI RUNNER - ANÁLISE DE ACESSIBILIDADE");
  console.log("=".repeat(80));
  console.log("");

  // Carregar mapeamento de níveis WCAG
  wcagLevels = await loadWCAGLevels();

  const repos = await readRepositories();
  const results = [];
  let totalRodados = 0;
  let totalPulados = 0;
  let totalErros = 0;

  for (const repo of repos) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`📦 Repositório: ${repo.repositorio}`);
    console.log(`🌐 Homepage: ${repo.homepage}`);
    console.log(`${"=".repeat(80)}`);

    // Buscar URLs do sitemap
    const urlsToAnalyze = await getSitemapUrls(repo.homepage);

    // Executar Lighthouse CI em cada URL
    const urlResults = [];
    let successCount = 0;

    for (let i = 0; i < urlsToAnalyze.length; i++) {
      const url = urlsToAnalyze[i];
      console.log(
        `\n   📄 [${i + 1}/${urlsToAnalyze.length}] Analisando: ${url}`
      );

      // Valida se a URL está acessível antes de rodar Lighthouse (se habilitado)
      if (CONFIG.VALIDATE_URLS) {
        console.log(`      🔍 Verificando se URL está acessível...`);
        const isAccessible = await isUrlAccessible(url);

        if (!isAccessible) {
          console.log(`      ⚠️  URL não acessível (404 ou erro), pulando...`);
          continue; // Pula para próxima URL
        }

        console.log(`      ✓ URL acessível, iniciando análise...`);
      }
      const lhciResult = await runLighthouseCI(
        url,
        `${repo.repositorio.replace(/\//g, "_")}_${i}`
      );

      if (lhciResult) {
        urlResults.push({ url, ...lhciResult });
        successCount++;
        console.log(
          `      ✓ Score: ${lhciResult.scoreDisplay}/100 | Violações: ${lhciResult.violacoes}`
        );
      } else {
        console.log(`      ✗ Falha na análise`);
      }

      // Pausa entre URLs
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Verifica se houve algum sucesso
    if (urlResults.length === 0) {
      console.log(`\n❌ Falha ao executar Lighthouse CI em todas as URLs`);
      totalErros++;
      results.push({
        repositorio: repo.repositorio,
        homepage: repo.homepage,
        urls_analisadas: urlsToAnalyze.length,
        urls_sucesso: 0,
        status: "ERROR",
        score: null,
        scoreDisplay: null,
        violacoes: null,
        warnings: null,
        nivelA: null,
        nivelAA: null,
        nivelAAA: null,
        bestPractice: null,
        experimental: null,
        deprecated: null,
        indefinido: null,
        performance: null,
        bestPractices: null,
        seo: null,
        detalhes: null,
      });
      continue;
    }

    // Agregar resultados (pior score, soma de violações)
    const aggregatedResult = {
      score: Math.min(...urlResults.map((r) => r.score)),
      scoreDisplay: Math.min(
        ...urlResults.map((r) => parseFloat(r.scoreDisplay))
      ).toFixed(0),
      violacoes: urlResults.reduce((sum, r) => sum + r.violacoes, 0),
      warnings: urlResults.reduce((sum, r) => sum + r.warnings, 0),
      nivelA: urlResults.reduce((sum, r) => sum + r.nivelA, 0),
      nivelAA: urlResults.reduce((sum, r) => sum + r.nivelAA, 0),
      nivelAAA: urlResults.reduce((sum, r) => sum + r.nivelAAA, 0),
      bestPractice: urlResults.reduce((sum, r) => sum + r.bestPractice, 0),
      experimental: urlResults.reduce((sum, r) => sum + r.experimental, 0),
      deprecated: urlResults.reduce((sum, r) => sum + r.deprecated, 0),
      indefinido: urlResults.reduce((sum, r) => sum + r.indefinido, 0),
      performance: (
        (urlResults.reduce((sum, r) => sum + r.numericValues.performance, 0) /
          urlResults.length) *
        100
      ).toFixed(0),
      bestPractices: (
        (urlResults.reduce((sum, r) => sum + r.numericValues.bestPractices, 0) /
          urlResults.length) *
        100
      ).toFixed(0),
      seo: (
        (urlResults.reduce((sum, r) => sum + r.numericValues.seo, 0) /
          urlResults.length) *
        100
      ).toFixed(0),
      detalhesViolacoes: urlResults.flatMap((r) => r.detalhesViolacoes),
      detalhesWarnings: urlResults.flatMap((r) => r.detalhesWarnings),
    };

    console.log(
      `\n✅ Análise agregada concluída (${successCount}/${urlsToAnalyze.length} URLs):`
    );
    console.log(`   📊 Score (pior): ${aggregatedResult.scoreDisplay}/100`);
    console.log(`   ❌ Violações (total): ${aggregatedResult.violacoes}`);
    console.log(`   ⚠️  Warnings (total): ${aggregatedResult.warnings}`);
    console.log(
      `   📈 WCAG - A: ${aggregatedResult.nivelA} | AA: ${aggregatedResult.nivelAA} | AAA: ${aggregatedResult.nivelAAA}`
    );
    console.log(
      `   📋 Outras - Best Practice: ${aggregatedResult.bestPractice} | Experimental: ${aggregatedResult.experimental} | Deprecated: ${aggregatedResult.deprecated}`
    );

    totalRodados++;
    
    // Calcula taxa de sucesso simples baseada no score do Lighthouse
    const taxaSucesso = aggregatedResult.score.toFixed(4);

    results.push({
      repositorio: repo.repositorio,
      homepage: repo.homepage,
      urls_analisadas: urlsToAnalyze.length,
      urls_sucesso: successCount,
      status: "SUCCESS",
      score: aggregatedResult.score,
      scoreDisplay: aggregatedResult.scoreDisplay,
      violacoes: aggregatedResult.violacoes,
      warnings: aggregatedResult.warnings,
      nivelA: aggregatedResult.nivelA,
      nivelAA: aggregatedResult.nivelAA,
      nivelAAA: aggregatedResult.nivelAAA,
      bestPractice: aggregatedResult.bestPractice,
      experimental: aggregatedResult.experimental,
      deprecated: aggregatedResult.deprecated,
      indefinido: aggregatedResult.indefinido,
      taxa_sucesso_acessibilidade: taxaSucesso,
      performance: aggregatedResult.performance,
      bestPractices: aggregatedResult.bestPractices,
      seo: aggregatedResult.seo,
      detalhes: {
        urls: urlResults.map((r) => r.url),
        violacoes: aggregatedResult.detalhesViolacoes,
        warnings: aggregatedResult.detalhesWarnings,
      },
    });

    // Pausa pequena entre análises
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Salvar resultados
  await saveResults(results);

  // Resumo final
  console.log(`\n${"=".repeat(80)}`);
  console.log("📊 RESUMO DA EXECUÇÃO");
  console.log(`${"=".repeat(80)}`);
  console.log(`✅ Analisados com sucesso: ${totalRodados}`);
  console.log(`⏭️  Pulados (sem homepage): ${totalPulados}`);
  console.log(`❌ Erros: ${totalErros}`);
  console.log(
    `📈 Taxa de sucesso: ${((totalRodados / repos.length) * 100).toFixed(1)}%`
  );
  console.log("");
  console.log("📄 Arquivos gerados:");
  console.log("   - lighthouse_ci_results.csv (formato tabular)");
  console.log("   - lighthouse_ci_results.json (formato detalhado)");
  console.log("");

  process.exit(0);
})();
