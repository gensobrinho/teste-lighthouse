const fs = require("fs");
const fetch = require("node-fetch");
const { execSync } = require("child_process");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const csv = require("csv-parser");

/**
 * Lighthouse CI Runner para Análise de Acessibilidade
 *
 * Este script:
 * 1. Lê repositórios do filtrados.csv
 * 2. Busca homepage via GitHub API
 * 3. Executa Lighthouse CI focado em acessibilidade
 * 4. Salva resultados em CSV/JSON
 */

// ----------------------
// Configuração de Tokens GitHub
// ----------------------
const tokens = [
  process.env.TOKEN_1,
  process.env.TOKEN_2,
  process.env.TOKEN_3,
].filter(Boolean);

let tokenIndex = 0;
let token = tokens[0];
let tokenLimits = Array(tokens.length).fill(null);

function nextToken() {
  tokenIndex = (tokenIndex + 1) % tokens.length;
  token = tokens[tokenIndex];
}

function switchTokenIfNeeded(rateLimit) {
  if (rateLimit !== null && rateLimit <= 0) {
    let startIndex = tokenIndex;
    let found = false;
    for (let i = 1; i <= tokens.length; i++) {
      let nextIndex = (startIndex + i) % tokens.length;
      if (!tokenLimits[nextIndex] || tokenLimits[nextIndex] > 0) {
        tokenIndex = nextIndex;
        token = tokens[tokenIndex];
        found = true;
        break;
      }
    }
    if (!found) {
      console.log(
        "⏳ Todos os tokens atingiram o rate limit. Aguardando reset..."
      );
    }
  }
}

async function makeRestRequest(url) {
  const options = {
    headers: {
      "User-Agent": "Lighthouse-CI-Runner",
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${token}`,
    },
    timeout: 20000,
  };

  const response = await fetch(url, options);
  const rateLimit = parseInt(response.headers.get("x-ratelimit-remaining"));
  const resetTime = parseInt(response.headers.get("x-ratelimit-reset"));
  tokenLimits[tokenIndex] = rateLimit;

  if (rateLimit < 50 && tokens.length > 1) {
    nextToken();
    tokenLimits[tokenIndex] = null;
    console.log(
      `🔄 Trocando para o próximo token (REST), rate limit baixo: ${rateLimit}`
    );
  }

  switchTokenIfNeeded(rateLimit);

  if (rateLimit < 50 && tokens.length <= 1) {
    const waitTime = Math.max(resetTime * 1000 - Date.now() + 5000, 0);
    console.log(
      `⏳ Rate limit REST baixo (${rateLimit}), aguardando ${Math.ceil(
        waitTime / 1000
      )}s...`
    );
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  return await response.json();
}

// ----------------------
// Buscar Homepage via GitHub API
// ----------------------
async function getHomepage(repoFullName) {
  try {
    console.log(`🔍 Buscando homepage para ${repoFullName}`);
    const data = await makeRestRequest(
      `https://api.github.com/repos/${repoFullName}`
    );
    return data.homepage || null;
  } catch (err) {
    console.error(`❌ Erro ao buscar homepage: ${err.message}`);
    return null;
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

    // Executa Lighthouse CI via CLI
    // --collect: coleta as métricas
    // --url: URL a ser testada
    // --only-categories=accessibility: apenas acessibilidade
    const command = `npx --yes @lhci/cli@0.13.x collect --url="${url}" --numberOfRuns=1 --settings.chromeFlags="--no-sandbox --headless --disable-gpu" --settings.onlyCategories=accessibility`;

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

          // Classifica por nível WCAG baseado nas tags
          if (audit.id.includes("2.1") || audit.id.includes("wcag2a")) {
            nivelA++;
          } else if (audit.id.includes("2.2") || audit.id.includes("wcag2aa")) {
            nivelAA++;
          } else if (audit.id.includes("wcag2aaa")) {
            nivelAAA++;
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
// Ler CSV de Repositórios
// ----------------------
async function readRepositories() {
  return new Promise((resolve, reject) => {
    const repos = [];
    fs.createReadStream("filtrados.csv")
      .pipe(csv())
      .on("data", (row) => {
        repos.push({
          repositorio: row["Repositório"] || row["Repositorio"],
          estrelas: row["Número de Estrelas"] || row["Numero de Estrelas"],
          ultimoCommit: row["Último Commit"] || row["Ultimo Commit"],
          axe: row["AXE"],
          pa11y: row["Pa11y"],
          wave: row["WAVE"],
          achecker: row["AChecker"],
          lighthouse: row["Lighthouse"],
          asqatasun: row["Asqatasun"],
          htmlCodeSniffer: row["HTML_CodeSniffer"],
          aplicacaoWeb: row["AplicacaoWeb"],
        });
      })
      .on("end", () => {
        console.log(`📋 Carregados ${repos.length} repositórios do CSV`);
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
      { id: "status", title: "Status" },
      { id: "score", title: "Score_Acessibilidade" },
      { id: "scoreDisplay", title: "Score_Display" },
      { id: "violacoes", title: "Total_Violacoes" },
      { id: "warnings", title: "Total_Warnings" },
      { id: "nivelA", title: "Violacoes_Nivel_A" },
      { id: "nivelAA", title: "Violacoes_Nivel_AA" },
      { id: "nivelAAA", title: "Violacoes_Nivel_AAA" },
      { id: "indefinido", title: "Violacoes_Indefinido" },
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
  console.log(`🔑 Token configurado: ${token ? "✅" : "❌"}`);
  console.log("");

  const repos = await readRepositories();
  const results = [];
  let totalRodados = 0;
  let totalPulados = 0;
  let totalErros = 0;

  for (const repo of repos) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`📦 Processando: ${repo.repositorio} (⭐ ${repo.estrelas})`);
    console.log(`${"=".repeat(80)}`);

    // Buscar homepage
    const homepage = await getHomepage(repo.repositorio);

    if (!homepage) {
      console.log(`⏭️  Pulando - sem homepage configurada`);
      totalPulados++;
      results.push({
        repositorio: repo.repositorio,
        homepage: null,
        status: "SKIPPED_NO_HOMEPAGE",
        score: null,
        scoreDisplay: null,
        violacoes: null,
        warnings: null,
        nivelA: null,
        nivelAA: null,
        nivelAAA: null,
        indefinido: null,
        performance: null,
        bestPractices: null,
        seo: null,
        detalhes: null,
      });
      continue;
    }

    console.log(`🌐 Homepage encontrada: ${homepage}`);

    // Executar Lighthouse CI
    const lhciResult = await runLighthouseCI(homepage, repo.repositorio);

    if (!lhciResult) {
      console.log(`❌ Falha ao executar Lighthouse CI`);
      totalErros++;
      results.push({
        repositorio: repo.repositorio,
        homepage: homepage,
        status: "ERROR",
        score: null,
        scoreDisplay: null,
        violacoes: null,
        warnings: null,
        nivelA: null,
        nivelAA: null,
        nivelAAA: null,
        indefinido: null,
        performance: null,
        bestPractices: null,
        seo: null,
        detalhes: null,
      });
      continue;
    }

    console.log(`✅ Análise concluída:`);
    console.log(`   📊 Score: ${lhciResult.scoreDisplay}/100`);
    console.log(`   ❌ Violações: ${lhciResult.violacoes}`);
    console.log(`   ⚠️  Warnings: ${lhciResult.warnings}`);
    console.log(
      `   📈 Nível A: ${lhciResult.nivelA} | AA: ${lhciResult.nivelAA} | AAA: ${lhciResult.nivelAAA}`
    );

    totalRodados++;
    results.push({
      repositorio: repo.repositorio,
      homepage: homepage,
      status: "SUCCESS",
      score: lhciResult.score,
      scoreDisplay: lhciResult.scoreDisplay,
      violacoes: lhciResult.violacoes,
      warnings: lhciResult.warnings,
      nivelA: lhciResult.nivelA,
      nivelAA: lhciResult.nivelAA,
      nivelAAA: lhciResult.nivelAAA,
      indefinido: lhciResult.indefinido,
      performance: (lhciResult.numericValues.performance * 100).toFixed(0),
      bestPractices: (lhciResult.numericValues.bestPractices * 100).toFixed(0),
      seo: (lhciResult.numericValues.seo * 100).toFixed(0),
      detalhes: {
        violacoes: lhciResult.detalhesViolacoes,
        warnings: lhciResult.detalhesWarnings,
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
