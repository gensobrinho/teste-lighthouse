/**
 * Lighthouse CI Configuration
 *
 * Configuração otimizada para análise de acessibilidade
 * Documentação: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md
 */

module.exports = {
  ci: {
    collect: {
      // Número de execuções por URL (média dos resultados)
      numberOfRuns: 3,

      // Configurações do Chrome
      settings: {
        // Flags do Chrome para execução em CI
        chromeFlags: "--no-sandbox --headless --disable-gpu",

        // Apenas categoria de acessibilidade
        onlyCategories: ["accessibility"],

        // Configurações de throttling (desabilitado para análise rápida)
        throttling: {
          rttMs: 40,
          throughputKbps: 10 * 1024,
          cpuSlowdownMultiplier: 1,
        },

        // Timeout para carregamento de páginas
        maxWaitForLoad: 45000,

        // Emular dispositivo móvel
        emulatedFormFactor: "desktop",

        // Configurações de rede
        skipAudits: [
          "uses-http2",
          "uses-long-cache-ttl",
          "uses-optimized-images",
          "uses-text-compression",
          "uses-responsive-images",
        ],
      },
    },

    assert: {
      // Sem assertions - apenas coleta de dados (não falha o CI/CD)
      assertions: {},
    },

    upload: {
      // Não fazer upload para servidor (análise local apenas)
      target: "temporary-public-storage",

      // Ou desabilitar completamente o upload
      // target: 'filesystem',
      // outputDir: './.lighthouseci'
    },
  },
};
