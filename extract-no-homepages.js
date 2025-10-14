const fs = require("fs");
const fetch = require("node-fetch");
const csv = require("csv-parser");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

/**
 * Script para extrair repositórios SEM homepage
 * 
 * Lê filtrados.csv e para cada repositório:
 * 1. Busca homepage via GitHub API
 * 2. Se NÃO existir, busca o comando de execução e salva em repositorios_sem_homepage.csv
 */

// ----------------------
// Configuração de Tokens GitHub
// ----------------------
const tokens = [ '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',
  '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',
].filter(Boolean);

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
// Detectar Framework e Porta Padrão
// ----------------------
function detectFrameworkAndPort(packageJson) {
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  // Mapeamento de frameworks e suas portas padrão
  const frameworks = [
    { name: "create-react-app", deps: ["react-scripts"], port: 3000 },
    { name: "Next.js", deps: ["next"], port: 3000 },
    { name: "Vue CLI", deps: ["@vue/cli-service"], port: 8080 },
    { name: "Nuxt.js", deps: ["nuxt"], port: 3000 },
    { name: "Angular", deps: ["@angular/cli", "@angular/core"], port: 4200 },
    { name: "Vite", deps: ["vite"], port: 5173 },
    { name: "Gatsby", deps: ["gatsby"], port: 8000 },
    { name: "Svelte", deps: ["svelte"], port: 5000 },
    { name: "Remix", deps: ["@remix-run/dev"], port: 3000 },
    { name: "Astro", deps: ["astro"], port: 3000 },
    { name: "Express", deps: ["express"], port: 3000 },
    { name: "Fastify", deps: ["fastify"], port: 3000 },
    { name: "NestJS", deps: ["@nestjs/core"], port: 3000 },
  ];

  for (const framework of frameworks) {
    const hasFramework = framework.deps.some((dep) => deps[dep]);
    if (hasFramework) {
      return { framework: framework.name, defaultPort: framework.port };
    }
  }

  return { framework: null, defaultPort: null };
}

// ----------------------
// Extrair Porta do Script
// ----------------------
function extractPortFromScript(scriptCommand) {
  if (!scriptCommand) return null;

  // Padrões de porta em scripts
  const portPatterns = [
    /PORT[=:\s]+(\d+)/i, // PORT=3000 ou PORT:3000 ou PORT 3000
    /--port[=:\s]+(\d+)/i, // --port=3000 ou --port 3000
    /-p[=:\s]+(\d+)/i, // -p=3000 ou -p 3000
    /port[=:\s]+(\d+)/i, // port=3000
    /:(\d{4,5})\b/, // :3000 (número de porta isolado)
  ];

  for (const pattern of portPatterns) {
    const match = scriptCommand.match(pattern);
    if (match && match[1]) {
      const port = parseInt(match[1]);
      if (port >= 1000 && port <= 65535) {
        return port;
      }
    }
  }

  return null;
}

// ----------------------
// Detectar Gerenciador de Pacotes via API GitHub
// ----------------------
async function detectPackageManager(repoFullName) {
  try {
    // Verificar arquivos de lock em paralelo para otimização
    const lockFiles = [
      { file: "yarn.lock", manager: "yarn" },
      { file: "pnpm-lock.yaml", manager: "pnpm" },
      { file: "bun.lockb", manager: "bun" },
      { file: "package-lock.json", manager: "npm" },
    ];

    for (const { file, manager } of lockFiles) {
      try {
        const response = await makeRestRequest(
          `https://api.github.com/repos/${repoFullName}/contents/${file}`
        );
        
        // Se encontrou o arquivo, retorna o gerenciador
        if (response && response.name === file) {
          return manager;
        }
      } catch (err) {
        // Arquivo não existe, continua para o próximo
        continue;
      }
    }

    // Se não encontrou nenhum lock file, assume npm como padrão
    return "npm";
  } catch (err) {
    console.error(`   ⚠️  Erro ao detectar gerenciador: ${err.message}`);
    return "npm"; // Fallback para npm
  }
}

// ----------------------
// Buscar Comando de Execução, Porta e Gerenciador via package.json
// ----------------------
async function getRunCommandAndPort(repoFullName) {
  try {
    const data = await makeRestRequest(
      `https://api.github.com/repos/${repoFullName}/contents/package.json`
    );

    if (!data || !data.content) {
      return { 
        command: "N/A", 
        port: "N/A", 
        packageManager: "N/A",
        hasPackageJson: false 
      };
    }

    // Decodificar conteúdo base64
    const packageJsonContent = Buffer.from(data.content, "base64").toString(
      "utf-8"
    );
    const packageJson = JSON.parse(packageJsonContent);

    if (!packageJson.scripts) {
      // Mesmo sem scripts, detectar gerenciador
      const packageManager = await detectPackageManager(repoFullName);
      return { 
        command: "Sem scripts", 
        port: "N/A",
        packageManager: packageManager,
        scriptName: null,
        hasPackageJson: true
      };
    }

    const scripts = packageJson.scripts;

    // Ordem de prioridade dos comandos de execução (apenas nome do script, não comando completo)
    const commandPriority = ["start", "dev", "serve", "start:dev", "develop", "server", "start:local"];

    let scriptName = null;
    let selectedScript = null;

    // Verificar qual comando está disponível
    for (const key of commandPriority) {
      if (scripts[key]) {
        scriptName = key;
        selectedScript = scripts[key];
        break;
      }
    }

    // Se não encontrar nenhum comando conhecido, verificar se tem algum com "start" ou "dev" no nome
    if (!scriptName) {
      const scriptKeys = Object.keys(scripts);
      const startOrDevKey = scriptKeys.find(
        (key) => key.includes("start") || key.includes("dev")
      );

      if (startOrDevKey) {
        scriptName = startOrDevKey;
        selectedScript = scripts[startOrDevKey];
      } else {
        const packageManager = await detectPackageManager(repoFullName);
        return { 
          command: "Comando não identificado", 
          port: "N/A",
          packageManager: packageManager,
          scriptName: null,
          hasPackageJson: true
        };
      }
    }

    // Detectar porta
    let port = null;

    // 1. Tentar extrair porta do script
    port = extractPortFromScript(selectedScript);

    // 2. Se não encontrar no script, verificar framework e porta padrão
    if (!port) {
      const { framework, defaultPort } = detectFrameworkAndPort(packageJson);
      if (defaultPort) {
        port = `${defaultPort} (${framework} padrão)`;
      }
    }

    // 3. Se ainda não encontrar, tentar verificar em outros scripts
    if (!port) {
      for (const scriptValue of Object.values(scripts)) {
        const foundPort = extractPortFromScript(scriptValue);
        if (foundPort) {
          port = `${foundPort} (detectado em scripts)`;
          break;
        }
      }
    }

    // Detectar gerenciador de pacotes
    console.log(`   🔍 Detectando gerenciador de pacotes...`);
    const packageManager = await detectPackageManager(repoFullName);

    return {
      command: scriptName, // Retorna apenas o nome do script (ex: "start", "dev")
      port: port || "Porta não identificada",
      packageManager: packageManager,
      scriptName: scriptName,
      hasPackageJson: true
    };
  } catch (err) {
    if (err.message && err.message.includes("404")) {
      return { 
        command: "Sem package.json", 
        port: "N/A",
        packageManager: "N/A",
        scriptName: null,
        hasPackageJson: false
      };
    }
    console.error(`❌ Erro ao buscar comando de execução: ${err.message}`);
    return { 
      command: "Erro ao buscar", 
      port: "N/A",
      packageManager: "N/A",
      scriptName: null,
      hasPackageJson: false
    };
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
    path: "repositorios_sem_homepage.csv",
    header: [
      { id: "repositorio", title: "Repositorio" },
      { id: "estrelas", title: "Estrelas" },
      { id: "ultimoCommit", title: "Ultimo_Commit" },
      { id: "scriptName", title: "Script_Name" },
      { id: "porta", title: "Porta" },
      { id: "packageManager", title: "Package_Manager" },
      { id: "hasPackageJson", title: "Has_Package_Json" },
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
  console.log("\n📄 Resultados salvos em repositorios_sem_homepage.csv");
}

// ----------------------
// Execução Principal
// ----------------------
(async () => {
  console.log("🔍 EXTRATOR DE REPOSITÓRIOS SEM HOMEPAGE - GitHub");
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
      console.log(`   ⏭️  Com homepage: ${homepage}`);
      totalComHomepage++;
    } else {
      console.log(`   ✅ Sem homepage - buscando informações para execução local...`);
      
      // Buscar comando de execução, porta e gerenciador
      const { command, port, packageManager, scriptName, hasPackageJson } = 
        await getRunCommandAndPort(repo.repositorio);
      
      console.log(`   🚀 Script: ${scriptName || command}`);
      console.log(`   🔌 Porta: ${port}`);
      console.log(`   📦 Gerenciador: ${packageManager}`);
      
      totalSemHomepage++;
      results.push({
        repositorio: repo.repositorio,
        estrelas: repo.estrelas,
        ultimoCommit: repo.ultimoCommit,
        scriptName: scriptName || command,
        porta: port,
        packageManager: packageManager,
        hasPackageJson: hasPackageJson ? "sim" : "não",
        axe: repo.axe,
        pa11y: repo.pa11y,
        wave: repo.wave,
        achecker: repo.achecker,
        lighthouse: repo.lighthouse,
        asqatasun: repo.asqatasun,
        htmlCodeSniffer: repo.htmlCodeSniffer,
        aplicacaoWeb: repo.aplicacaoWeb,
      });
    }

    // Pausa pequena entre requisições
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Salvar resultados
  if (results.length > 0) {
    await saveResults(results);
  } else {
    console.log("\n⚠️  Todos os repositórios possuem homepage configurada.");
  }

  // Resumo final
  console.log(`\n${"=".repeat(80)}`);
  console.log("📊 RESUMO DA EXTRAÇÃO");
  console.log(`${"=".repeat(80)}`);
  console.log(`📋 Total de repositórios: ${repos.length}`);
  console.log(`✅ Sem homepage: ${totalSemHomepage} (${((totalSemHomepage / repos.length) * 100).toFixed(1)}%)`);
  console.log(`⏭️  Com homepage: ${totalComHomepage} (${((totalComHomepage / repos.length) * 100).toFixed(1)}%)`);
  console.log("");
  console.log("📄 Arquivo gerado:");
  console.log("   - repositorios_sem_homepage.csv");
  console.log("");

  process.exit(0);
})();


