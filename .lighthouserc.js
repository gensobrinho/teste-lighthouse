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
      numberOfRuns: 1,

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
      // Assertions para garantir qualidade mínima
      assertions: {
        "categories:accessibility": ["error", { minScore: 0.5 }],

        // Auditorias críticas de acessibilidade
        "aria-allowed-attr": "off",
        "aria-command-name": "off",
        "aria-hidden-body": "error",
        "aria-hidden-focus": "error",
        "aria-input-field-name": "off",
        "aria-meter-name": "off",
        "aria-progressbar-name": "off",
        "aria-required-attr": "off",
        "aria-required-children": "off",
        "aria-required-parent": "off",
        "aria-roles": "off",
        "aria-toggle-field-name": "off",
        "aria-tooltip-name": "off",
        "aria-treeitem-name": "off",
        "aria-valid-attr-value": "off",
        "aria-valid-attr": "off",
        "button-name": "off",
        bypass: "off",
        "color-contrast": "off",
        "definition-list": "off",
        dlitem: "off",
        "document-title": "off",
        "duplicate-id-aria": "error",
        "duplicate-id-active": "error",
        "form-field-multiple-labels": "off",
        "frame-title": "off",
        "heading-order": "off",
        "html-has-lang": "off",
        "html-lang-valid": "off",
        "image-alt": "off",
        "input-image-alt": "off",
        label: "off",
        "link-name": "off",
        list: "off",
        listitem: "off",
        "meta-refresh": "off",
        "meta-viewport": "off",
        "object-alt": "off",
        tabindex: "off",
        "td-headers-attr": "off",
        "th-has-data-cells": "off",
        "valid-lang": "off",
        "video-caption": "off",
      },
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
