const fs = require("fs");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

/**
 * Script para extrair níveis de conformidade WCAG das regras do rule-descriptions.md
 *
 * Saída: rule-wcag-levels.csv com as colunas:
 * - rule_id
 * - conformity_level (A, AA, AAA, Best Practice, Experimental, Deprecated, None)
 */

// Lê o arquivo markdown
const markdown = fs.readFileSync("rule-descriptions.md", "utf8");

// Divide o markdown em linhas
const lines = markdown.split("\n");

// Array para armazenar os resultados
const results = [];

// Regex para extrair o rule ID da primeira coluna da tabela
// Formato: | [rule-id](url) | ...
const ruleIdRegex = /^\|\s*\[([^\]]+)\]/;

// Processa cada linha
for (const line of lines) {
  // Verifica se é uma linha de tabela (começa com |)
  if (!line.trim().startsWith("|")) continue;

  // Ignora linhas de cabeçalho e separadores
  if (line.includes("Rule ID") || line.includes(":---")) continue;

  // Tenta extrair o rule ID
  const match = line.match(ruleIdRegex);
  if (!match) continue;

  const ruleId = match[1];

  // Divide a linha em colunas
  const columns = line.split("|").map((col) => col.trim());

  // A coluna de Tags é geralmente a 5ª coluna (índice 4)
  if (columns.length < 5) continue;

  const tagsColumn = columns[4];

  // Determina o nível de conformidade baseado nas tags
  let conformityLevel = "None";

  // Verifica se contém tags de deprecated ou experimental primeiro
  if (tagsColumn.includes("deprecated")) {
    conformityLevel = "Deprecated";
  } else if (tagsColumn.includes("experimental")) {
    conformityLevel = "Experimental";
  } else if (tagsColumn.includes("best-practice")) {
    conformityLevel = "Best Practice";
  } else {
    // Verifica níveis WCAG (prioridade: AAA > AA > A)
    // Considera WCAG 2.0, 2.1 e 2.2
    if (
      tagsColumn.includes("wcag2aaa") ||
      tagsColumn.includes("wcag21aaa") ||
      tagsColumn.includes("wcag22aaa")
    ) {
      conformityLevel = "AAA";
    } else if (
      tagsColumn.includes("wcag2aa") ||
      tagsColumn.includes("wcag21aa") ||
      tagsColumn.includes("wcag22aa")
    ) {
      conformityLevel = "AA";
    } else if (
      tagsColumn.includes("wcag2a") ||
      tagsColumn.includes("wcag21a") ||
      tagsColumn.includes("wcag22a")
    ) {
      conformityLevel = "A";
    }
  }

  // Adiciona ao resultado
  results.push({
    rule_id: ruleId,
    conformity_level: conformityLevel,
  });

  console.log(`✓ ${ruleId.padEnd(30)} → ${conformityLevel}`);
}

// Salva no CSV
const csvWriter = createCsvWriter({
  path: "rule-wcag-levels.csv",
  header: [
    { id: "rule_id", title: "rule_id" },
    { id: "conformity_level", title: "conformity_level" },
  ],
});

csvWriter
  .writeRecords(results)
  .then(() => {
    console.log("");
    console.log("=".repeat(60));
    console.log(`✅ CSV gerado com sucesso: rule-wcag-levels.csv`);
    console.log(`📊 Total de regras processadas: ${results.length}`);
    console.log("=".repeat(60));

    // Estatísticas
    const stats = {};
    results.forEach((r) => {
      stats[r.conformity_level] = (stats[r.conformity_level] || 0) + 1;
    });

    console.log("");
    console.log("📈 Estatísticas por nível:");
    Object.keys(stats)
      .sort()
      .forEach((level) => {
        console.log(`   ${level.padEnd(15)}: ${stats[level]}`);
      });
  })
  .catch((err) => {
    console.error("❌ Erro ao salvar CSV:", err);
  });
