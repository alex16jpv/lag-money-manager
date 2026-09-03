---
layout: home

hero:
  name: lag-money-manager
  text: REST API for personal money management
  tagline: Accounts, categories, transactions, budgets and stats, with atomic balance adjustments
  actions:
    - theme: brand
      text: Getting Started
      link: /docs/guides/getting-started
    - theme: alt
      text: Architecture Overview
      link: /docs/architecture/overview
    - theme: alt
      text: Agent Context
      link: /docs/agent-context

features:
  - title: MongoDB, Exactly
    details: Mongoose on a replica set. Money is stored as integer cents and balances move inside real multi-document transactions.
  - title: Full Documentation
    details: Architecture guides, module docs, and AI agent prompts for every aspect of the project.
  - title: Production Ready
    details: JWT access and refresh tokens, layered rate limiting, Helmet headers, structured logging, and Zod validation on every endpoint.
---
