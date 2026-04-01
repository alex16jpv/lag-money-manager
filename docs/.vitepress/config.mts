import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid({
  title: "lag-money-manager",
  description: "REST API for personal money management",

  srcDir: "..",
  outDir: "../.vitepress/dist",

  themeConfig: {
    search: {
      provider: "local",
    },

    nav: [
      { text: "Home", link: "/docs/" },
      { text: "Architecture", link: "/docs/architecture/overview" },
      { text: "Guides", link: "/docs/guides/getting-started" },
      { text: "Modules", link: "/docs/modules/auth" },
      { text: "Reference", link: "/docs/reference/error-handling" },
      { text: "Agent Context", link: "/docs/agent-context" },
    ],

    sidebar: {
      "/docs/": [
        {
          text: "Overview",
          items: [{ text: "Agent Context", link: "/docs/agent-context" }],
        },
        {
          text: "Architecture",
          collapsed: false,
          items: [
            { text: "Overview", link: "/docs/architecture/overview" },
            {
              text: "Folder Structure",
              link: "/docs/architecture/folder-structure",
            },
            {
              text: "Design Patterns",
              link: "/docs/architecture/design-patterns",
            },
            {
              text: "Request Lifecycle",
              link: "/docs/architecture/request-lifecycle",
            },
            {
              text: "Dependency Rules",
              link: "/docs/architecture/dependency-rules",
            },
            {
              text: "Decisions",
              collapsed: true,
              items: [
                {
                  text: "Template",
                  link: "/docs/architecture/decisions/_template",
                },
              ],
            },
          ],
        },
        {
          text: "Guides",
          collapsed: false,
          items: [
            {
              text: "Getting Started",
              link: "/docs/guides/getting-started",
            },
            { text: "Contributing", link: "/docs/guides/contributing" },
            {
              text: "Adding New Features",
              link: "/docs/guides/adding-new-features",
            },
            {
              text: "Environment Vars",
              link: "/docs/guides/environment-vars",
            },
            { text: "Testing", link: "/docs/guides/testing" },
          ],
        },
        {
          text: "Modules",
          collapsed: false,
          items: [
            { text: "Auth", link: "/docs/modules/auth" },
            { text: "Users", link: "/docs/modules/users" },
            { text: "Accounts", link: "/docs/modules/accounts" },
            { text: "Categories", link: "/docs/modules/categories" },
            { text: "Transactions", link: "/docs/modules/transactions" },
          ],
        },
        {
          text: "Examples",
          collapsed: false,
          items: [
            {
              text: "Full Module Walkthrough",
              link: "/docs/examples/full-module-walkthrough",
            },
          ],
        },
        {
          text: "Reference",
          collapsed: false,
          items: [
            {
              text: "Error Handling",
              link: "/docs/reference/error-handling",
            },
            {
              text: "Anti Patterns",
              link: "/docs/reference/anti-patterns",
            },
            { text: "Glossary", link: "/docs/reference/glossary" },
          ],
        },
        {
          text: "Prompts",
          collapsed: true,
          items: [
            { text: "Readme", link: "/docs/prompts/README" },
            {
              text: "Scan Improvements",
              link: "/docs/prompts/scan-improvements",
            },
            { text: "Add Feature", link: "/docs/prompts/add-feature" },
            {
              text: "Qa And Docs Update",
              link: "/docs/prompts/qa-and-docs-update",
            },
          ],
        },
      ],
    },
  },
});
