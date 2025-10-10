const fs = require("fs");
const fetch = require("node-fetch");
const csv = require("csv-parser");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

/**
 * Script para extrair homepages dos repositórios
 * 
 * Lê filtrados.csv e para cada repositório:
 * 1. Busca homepage via GitHub API
 * 2. Se existir, salva em repositorios_com_homepage.csv
 */

// ----------------------
// Configuração de Tokens GitHub
// ----------------------
const tokens = ["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","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","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"].filter(Boolean);

if (tokens.length === 0) {
  console.error("❌ Erro: Nenhum token GitHub configurado!");
  console.error("   Configure TOKEN_1, TOKEN_2 ou TOKEN_3 como variável de ambiente.");
  console.error("");
  console.error("   Exemplo:");
  console.error('   export TOKEN_1="seu_token_aqui"  # Linux/Mac');
  console.error('   $env:TOKEN_1="seu_token_aqui"    # Windows PowerShell');
  process.exit(1);
}

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
      "User-Agent": "GitHub-Homepage-Extractor",
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
      `🔄 Trocando para o próximo token, rate limit baixo: ${rateLimit}`
    );
  }

  switchTokenIfNeeded(rateLimit);

  if (rateLimit < 50 && tokens.length <= 1) {
    const waitTime = Math.max(resetTime * 1000 - Date.now() + 5000, 0);
    console.log(
      `⏳ Rate limit baixo (${rateLimit}), aguardando ${Math.ceil(
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
          estrelas: row["Número de Estrelas"] || row["Numero de Estrelas"] || row["Estrelas"],
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
  const csvWriter = createCsvWriter({
    path: "repositorios_com_homepage.csv",
    header: [
      { id: "repositorio", title: "Repositorio" },
      { id: "homepage", title: "Homepage" },
      { id: "estrelas", title: "Estrelas" },
      { id: "ultimoCommit", title: "Ultimo_Commit" },
      { id: "axe", title: "AXE" },
      { id: "pa11y", title: "Pa11y" },
      { id: "wave", title: "WAVE" },
      { id: "achecker", title: "AChecker" },
      { id: "lighthouse", title: "Lighthouse" },
      { id: "asqatasun", title: "Asqatasun" },
      { id: "htmlCodeSniffer", title: "HTML_CodeSniffer" },
      { id: "aplicacaoWeb", title: "AplicacaoWeb" },
    ],
  });

  await csvWriter.writeRecords(results);
  console.log("\n📄 Resultados salvos em repositorios_com_homepage.csv");
}

// ----------------------
// Execução Principal
// ----------------------
(async () => {
  console.log("🔍 EXTRATOR DE HOMEPAGES - GitHub Repositories");
  console.log(`🔑 Tokens configurados: ${tokens.length}`);
  console.log("");

  const repos = await readRepositories();
  const results = [];
  let totalComHomepage = 0;
  let totalSemHomepage = 0;

  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    console.log(`\n[${i + 1}/${repos.length}] 📦 ${repo.repositorio}`);

    // Buscar homepage
    const homepage = await getHomepage(repo.repositorio);

    if (homepage) {
      console.log(`   ✅ Homepage encontrada: ${homepage}`);
      totalComHomepage++;
      results.push({
        repositorio: repo.repositorio,
        homepage: homepage,
        estrelas: repo.estrelas,
        ultimoCommit: repo.ultimoCommit,
        axe: repo.axe,
        pa11y: repo.pa11y,
        wave: repo.wave,
        achecker: repo.achecker,
        lighthouse: repo.lighthouse,
        asqatasun: repo.asqatasun,
        htmlCodeSniffer: repo.htmlCodeSniffer,
        aplicacaoWeb: repo.aplicacaoWeb,
      });
    } else {
      console.log(`   ⏭️  Sem homepage configurada`);
      totalSemHomepage++;
    }

    // Pausa pequena entre requisições
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Salvar resultados
  if (results.length > 0) {
    await saveResults(results);
  } else {
    console.log("\n⚠️  Nenhum repositório com homepage encontrado.");
  }

  // Resumo final
  console.log(`\n${"=".repeat(80)}`);
  console.log("📊 RESUMO DA EXTRAÇÃO");
  console.log(`${"=".repeat(80)}`);
  console.log(`📋 Total de repositórios: ${repos.length}`);
  console.log(`✅ Com homepage: ${totalComHomepage} (${((totalComHomepage / repos.length) * 100).toFixed(1)}%)`);
  console.log(`⏭️  Sem homepage: ${totalSemHomepage} (${((totalSemHomepage / repos.length) * 100).toFixed(1)}%)`);
  console.log("");
  console.log("📄 Arquivo gerado:");
  console.log("   - repositorios_com_homepage.csv");
  console.log("");

  process.exit(0);
})();

