const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");
const csv = require("csv-parser");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const fetch = require("node-fetch");

/**
 * LOCAL REPOSITORY RUNNER
 * 
 * Fluxo automatizado para testar repositórios localmente:
 * 1. Clone o repositório
 * 2. Detecta gerenciador de pacotes e instala dependências
 * 3. Inicia a aplicação localmente
 * 4. Executa ferramentas de acessibilidade
 * 5. Salva resultados
 * 6. Cleanup (mata processos e deleta repo)
 * 7. Próximo repositório
 */

// ----------------------
// Configurações
// ----------------------
const CONFIG = {
  // Diretório temporário para clonar repositórios
  TEMP_DIR: path.join(__dirname, "temp_repos"),
  
  // Tempo máximo para instalar dependências (ms)
  INSTALL_TIMEOUT: 300000, // 5 minutos
  
  // Tempo máximo para aguardar aplicação iniciar (ms)
  STARTUP_TIMEOUT: 120000, // 2 minutos
  
  // Intervalo de health check (ms)
  HEALTH_CHECK_INTERVAL: 2000, // 2 segundos
  
  // Timeout para health check HTTP
  HTTP_TIMEOUT: 5000, // 5 segundos
  
  // Ferramentas para executar (pode escolher quais usar)
  TOOLS: {
    axe: true,
    pa11y: true,
    lighthouse: true,
    wave: false, // WAVE precisa de extensão, mais complexo
  },
  
  // Número máximo de tentativas de health check
  MAX_HEALTH_CHECKS: 60, // 60 * 2s = 2 minutos
  
  // Se true, mantém repos com erro para debug
  KEEP_FAILED_REPOS: true,
};

// ----------------------
// Token GitHub (para clonar repos privados se necessário)
// ----------------------
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

// ----------------------
// Gerenciamento de Processos
// ----------------------
const runningProcesses = new Map();

function killProcess(pid) {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: "ignore" });
    }
    console.log(`   ✓ Processo ${pid} finalizado`);
  } catch (err) {
    console.log(`   ⚠️  Erro ao finalizar processo ${pid}: ${err.message}`);
  }
}

function cleanupProcesses() {
  console.log("\n🧹 Finalizando processos...");
  for (const [repoName, pid] of runningProcesses.entries()) {
    console.log(`   Finalizando ${repoName} (PID: ${pid})`);
    killProcess(pid);
  }
  runningProcesses.clear();
}

// Garantir cleanup em caso de interrupção
process.on("SIGINT", () => {
  console.log("\n\n🛑 Interrupção detectada!");
  cleanupProcesses();
  process.exit(0);
});

process.on("exit", () => {
  cleanupProcesses();
});

// ----------------------
// Utilitários de Sistema
// ----------------------
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function removeDir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      if (process.platform === "win32") {
        execSync(`rmdir /s /q "${dirPath}"`, { stdio: "ignore" });
      } else {
        execSync(`rm -rf "${dirPath}"`, { stdio: "ignore" });
      }
      console.log(`   ✓ Diretório removido: ${dirPath}`);
    }
  } catch (err) {
    console.log(`   ⚠️  Erro ao remover diretório: ${err.message}`);
  }
}

// ----------------------
// Validação de Gerenciador de Pacotes
// ----------------------
function validatePackageManager(packageManager) {
  const validManagers = ["npm", "yarn", "pnpm", "bun"];
  return validManagers.includes(packageManager) ? packageManager : "npm";
}

function getInstallCommand(packageManager) {
  const commands = {
    npm: "npm install",
    yarn: "yarn install",
    pnpm: "pnpm install",
    bun: "bun install",
  };
  return commands[packageManager] || "npm install";
}

function getRunCommand(packageManager, scriptName) {
  const commands = {
    npm: `npm ${scriptName === "start" ? "start" : `run ${scriptName}`}`,
    yarn: `yarn ${scriptName}`,
    pnpm: `pnpm ${scriptName}`,
    bun: `bun ${scriptName}`,
  };
  return commands[packageManager] || `npm run ${scriptName}`;
}

// ----------------------
// Buscar Informações do Repositório
// ----------------------
async function getRepoInfo(repoFullName) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repoFullName}/contents/package.json`,
      {
        headers: {
          Authorization: GITHUB_TOKEN ? `token ${GITHUB_TOKEN}` : undefined,
          "User-Agent": "Local-Repo-Runner",
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const packageJsonContent = Buffer.from(data.content, "base64").toString(
      "utf-8"
    );
    const packageJson = JSON.parse(packageJsonContent);

    // Detectar comando e porta (reutilizando lógica do extract-no-homepages.js)
    const scripts = packageJson.scripts || {};
    const commandPriority = ["start", "dev", "serve", "start:dev", "develop"];

    let scriptName = null;
    for (const cmd of commandPriority) {
      if (scripts[cmd]) {
        scriptName = cmd;
        break;
      }
    }

    if (!scriptName) {
      const keys = Object.keys(scripts);
      scriptName = keys.find((k) => k.includes("start") || k.includes("dev"));
    }

    // Detectar porta
    let port = null;
    if (scriptName && scripts[scriptName]) {
      const portMatch = scripts[scriptName].match(/port[=:\s]+(\d+)/i);
      if (portMatch) {
        port = parseInt(portMatch[1]);
      }
    }

    // Porta padrão por framework
    if (!port) {
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      const frameworks = [
        { deps: ["next"], port: 3000 },
        { deps: ["react-scripts"], port: 3000 },
        { deps: ["@vue/cli-service"], port: 8080 },
        { deps: ["@angular/cli"], port: 4200 },
        { deps: ["vite"], port: 5173 },
        { deps: ["gatsby"], port: 8000 },
      ];

      for (const fw of frameworks) {
        if (fw.deps.some((d) => deps[d])) {
          port = fw.port;
          break;
        }
      }
    }

    return {
      scriptName: scriptName || "start",
      port: port || 3000, // Porta padrão fallback
      packageJson,
    };
  } catch (err) {
    console.error(`   ❌ Erro ao buscar package.json: ${err.message}`);
    return null;
  }
}

// ----------------------
// Clone do Repositório
// ----------------------
async function cloneRepository(repoFullName, destPath) {
  console.log(`\n📦 Clonando ${repoFullName}...`);
  try {
    const cloneUrl = `https://github.com/${repoFullName}.git`;
    execSync(`git clone --depth 1 ${cloneUrl} "${destPath}"`, {
      stdio: "inherit",
      timeout: 60000, // 1 minuto
    });
    console.log(`   ✓ Repositório clonado`);
    return true;
  } catch (err) {
    console.error(`   ❌ Erro ao clonar: ${err.message}`);
    return false;
  }
}

// ----------------------
// Instalação de Dependências
// ----------------------
async function installDependencies(repoPath, packageManager) {
  console.log(`\n📚 Instalando dependências (${packageManager})...`);
  try {
    const installCmd = getInstallCommand(packageManager);
    execSync(installCmd, {
      cwd: repoPath,
      stdio: "inherit",
      timeout: CONFIG.INSTALL_TIMEOUT,
    });
    console.log(`   ✓ Dependências instaladas`);
    return true;
  } catch (err) {
    console.error(`   ❌ Erro ao instalar dependências: ${err.message}`);
    return false;
  }
}

// ----------------------
// Health Check
// ----------------------
async function checkHealth(url, timeout = CONFIG.HTTP_TIMEOUT) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Local-Repo-Runner" },
    });

    clearTimeout(timeoutId);
    return response.ok || response.status === 304;
  } catch (err) {
    return false;
  }
}

async function waitForAppReady(url, maxAttempts = CONFIG.MAX_HEALTH_CHECKS) {
  console.log(`\n🏥 Aguardando aplicação iniciar em ${url}...`);

  for (let i = 0; i < maxAttempts; i++) {
    const isReady = await checkHealth(url);

    if (isReady) {
      console.log(`   ✓ Aplicação pronta! (${i + 1} tentativas)`);
      return true;
    }

    process.stdout.write(`\r   Tentativa ${i + 1}/${maxAttempts}...`);
    await new Promise((resolve) =>
      setTimeout(resolve, CONFIG.HEALTH_CHECK_INTERVAL)
    );
  }

  console.log(`\n   ❌ Timeout: aplicação não respondeu`);
  return false;
}

// ----------------------
// Iniciar Aplicação
// ----------------------
async function startApplication(repoPath, packageManager, scriptName, port) {
  console.log(`\n🚀 Iniciando aplicação...`);
  console.log(`   Script: ${scriptName}`);
  console.log(`   Porta: ${port}`);

  try {
    const runCmd = getRunCommand(packageManager, scriptName);
    const [command, ...args] = runCmd.split(" ");

    const appProcess = spawn(command, args, {
      cwd: repoPath,
      stdio: "ignore", // Ignorar output para não poluir console
      detached: false,
      env: {
        ...process.env,
        PORT: port.toString(),
        NODE_ENV: "development",
      },
    });

    if (!appProcess.pid) {
      throw new Error("Falha ao iniciar processo");
    }

    console.log(`   ✓ Processo iniciado (PID: ${appProcess.pid})`);
    return appProcess;
  } catch (err) {
    console.error(`   ❌ Erro ao iniciar aplicação: ${err.message}`);
    return null;
  }
}

// ----------------------
// Executar Ferramentas de Acessibilidade
// ----------------------
async function runAccessibilityTools(url, repoName) {
  console.log(`\n🔍 Executando ferramentas de acessibilidade...`);

  const results = {
    repositorio: repoName,
    url: url,
    testedAt: new Date().toISOString(),
  };

  // AXE
  if (CONFIG.TOOLS.axe) {
    try {
      console.log(`   🪓 Executando AXE...`);
      const puppeteer = require("puppeteer");
      const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox"],
      });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

      const axeSource = fs.readFileSync(require.resolve("axe-core"), "utf8");
      await page.evaluate(axeSource);
      const axeResults = await page.evaluate(async () => await axe.run());

      results.axe_violations = axeResults.violations.length;
      results.axe_passes = axeResults.passes.length;
      console.log(`      ✓ Violações: ${axeResults.violations.length}`);

      await browser.close();
    } catch (err) {
      console.error(`      ❌ Erro AXE: ${err.message}`);
      results.axe_error = err.message;
    }
  }

  // PA11Y
  if (CONFIG.TOOLS.pa11y) {
    try {
      console.log(`   🔎 Executando Pa11y...`);
      const pa11y = require("pa11y");
      const pa11yResults = await pa11y(url, {
        standard: "WCAG2AA",
        timeout: 30000,
        chromeLaunchConfig: { args: ["--no-sandbox"] },
      });

      const errors = pa11yResults.issues.filter((i) => i.type === "error");
      results.pa11y_errors = errors.length;
      results.pa11y_total = pa11yResults.issues.length;
      console.log(`      ✓ Erros: ${errors.length}`);
    } catch (err) {
      console.error(`      ❌ Erro Pa11y: ${err.message}`);
      results.pa11y_error = err.message;
    }
  }

  // LIGHTHOUSE
  if (CONFIG.TOOLS.lighthouse) {
    try {
      console.log(`   💡 Executando Lighthouse...`);
      const lighthouse = require("lighthouse");
      const chromeLauncher = require("chrome-launcher");

      const chrome = await chromeLauncher.launch({
        chromeFlags: ["--headless", "--no-sandbox"],
      });

      const options = {
        logLevel: "error",
        output: "json",
        port: chrome.port,
        onlyCategories: ["accessibility"],
      };

      const runnerResult = await lighthouse(url, options);
      const lhScore = runnerResult.lhr.categories.accessibility.score * 100;

      results.lighthouse_score = lhScore;
      console.log(`      ✓ Score: ${lhScore}`);

      await chrome.kill();
    } catch (err) {
      console.error(`      ❌ Erro Lighthouse: ${err.message}`);
      results.lighthouse_error = err.message;
    }
  }

  return results;
}

// ----------------------
// Processar Repositório Completo
// ----------------------
async function processRepository(repoFullName) {
  const repoName = repoFullName.replace("/", "_");
  const repoPath = path.join(CONFIG.TEMP_DIR, repoName);

  console.log(`\n${"=".repeat(80)}`);
  console.log(`📦 PROCESSANDO: ${repoFullName}`);
  console.log(`${"=".repeat(80)}`);

  const result = {
    repositorio: repoFullName,
    status: "pending",
    error: null,
  };

  let appProcess = null;

  try {
    // 1. Buscar informações do repositório
    console.log("\n📋 Buscando informações do repositório...");
    const repoInfo = await getRepoInfo(repoFullName);

    if (!repoInfo) {
      throw new Error("Repositório não possui package.json ou não é Node.js");
    }

    console.log(`   ✓ Script: ${repoInfo.scriptName}`);
    console.log(`   ✓ Porta: ${repoInfo.port}`);

    // 2. Clonar repositório
    const cloned = await cloneRepository(repoFullName, repoPath);
    if (!cloned) {
      throw new Error("Falha ao clonar repositório");
    }

    // 3. Detectar e instalar dependências
    const packageManager = detectPackageManager(repoPath);
    console.log(`   ✓ Gerenciador detectado: ${packageManager}`);

    const installed = await installDependencies(repoPath, packageManager);
    if (!installed) {
      throw new Error("Falha ao instalar dependências");
    }

    // 4. Iniciar aplicação
    appProcess = await startApplication(
      repoPath,
      packageManager,
      repoInfo.scriptName,
      repoInfo.port
    );

    if (!appProcess) {
      throw new Error("Falha ao iniciar aplicação");
    }

    runningProcesses.set(repoName, appProcess.pid);

    // 5. Aguardar aplicação ficar pronta
    const url = `http://localhost:${repoInfo.port}`;
    const isReady = await waitForAppReady(url);

    if (!isReady) {
      throw new Error("Aplicação não iniciou no tempo esperado");
    }

    // 6. Executar ferramentas de acessibilidade
    const toolResults = await runAccessibilityTools(url, repoFullName);
    Object.assign(result, toolResults);
    result.status = "success";

    console.log(`\n✅ Repositório processado com sucesso!`);
  } catch (err) {
    console.error(`\n❌ Erro ao processar repositório: ${err.message}`);
    result.status = "error";
    result.error = err.message;
  } finally {
    // 7. Cleanup
    console.log(`\n🧹 Limpeza...`);

    // Finalizar processo da aplicação
    if (appProcess && appProcess.pid) {
      killProcess(appProcess.pid);
      runningProcesses.delete(repoName);
    }

    // Remover repositório clonado
    if (!CONFIG.KEEP_FAILED_REPOS || result.status === "success") {
      removeDir(repoPath);
    } else {
      console.log(`   ⚠️  Mantendo repo para debug: ${repoPath}`);
    }

    console.log(`   ✓ Cleanup concluído`);
  }

  return result;
}

// ----------------------
// Ler CSV de Repositórios
// ----------------------
async function readRepositories() {
  return new Promise((resolve, reject) => {
    const repos = [];
    fs.createReadStream("repositorios_sem_homepage.csv")
      .pipe(csv())
      .on("data", (row) => {
        repos.push({
          repositorio: row["Repositorio"] || row["Repositório"],
          estrelas: row["Estrelas"],
          comandoExecucao: row["Comando_Execucao"],
          porta: row["Porta"],
        });
      })
      .on("end", () => {
        console.log(`📋 Carregados ${repos.length} repositórios`);
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
    path: "local_accessibility_results.csv",
    header: [
      { id: "repositorio", title: "Repositorio" },
      { id: "status", title: "Status" },
      { id: "url", title: "URL" },
      { id: "axe_violations", title: "AXE_Violations" },
      { id: "axe_passes", title: "AXE_Passes" },
      { id: "pa11y_errors", title: "Pa11y_Errors" },
      { id: "pa11y_total", title: "Pa11y_Total" },
      { id: "lighthouse_score", title: "Lighthouse_Score" },
      { id: "testedAt", title: "Tested_At" },
      { id: "error", title: "Error" },
    ],
  });

  await csvWriter.writeRecords(results);
  console.log("\n✅ Resultados salvos em local_accessibility_results.csv");
}

// ----------------------
// Execução Principal
// ----------------------
(async () => {
  console.log("🚀 LOCAL REPOSITORY RUNNER");
  console.log(`${"=".repeat(80)}\n`);

  // Criar diretório temporário
  ensureDir(CONFIG.TEMP_DIR);

  try {
    // Ler repositórios
    const repos = await readRepositories();

    // Processar cada repositório
    const results = [];
    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];
      console.log(`\n[${i + 1}/${repos.length}] Processando ${repo.repositorio}`);

      const result = await processRepository(repo.repositorio);
      results.push(result);

      // Pausa entre repositórios
      if (i < repos.length - 1) {
        console.log("\n⏸️  Pausa de 5 segundos antes do próximo...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    // Salvar resultados
    await saveResults(results);

    // Resumo final
    const successful = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "error").length;

    console.log(`\n${"=".repeat(80)}`);
    console.log("📊 RESUMO FINAL");
    console.log(`${"=".repeat(80)}`);
    console.log(`✅ Sucesso: ${successful}`);
    console.log(`❌ Erro: ${failed}`);
    console.log(`📋 Total: ${repos.length}`);
  } catch (err) {
    console.error(`\n❌ Erro fatal: ${err.message}`);
  } finally {
    // Cleanup final
    cleanupProcesses();
    console.log("\n👋 Execução finalizada!");
    process.exit(0);
  }
})();

