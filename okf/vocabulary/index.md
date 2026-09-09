---
type: Knowledge Catalog
title: DeFi Vocabulary
description: What a vault, a lending market and a liquidity pool are under the Messari standardized schema — the layer every descendant inherits.
tags: [messari, vocabulary]
timestamp: 2026-09-09T05:06:26Z
---

# Why this layer exists

This is `defi.engram.eth`: terms, not values. It is what makes two sibling agents able to talk. `vaults.`
knows vaults and `lending.` knows markets, they hold disjoint facts, and neither could delegate to the other
if they did not share this.

It is also the layer whose confusions are expensive. A vault has **fees**; a market has **rates**; a pool's
input tokens field is **plural**. Each of those was a real defect in a benchmark prompt this week, and each
cost a tool call every time a model guessed.

- [Vault](/vocabulary/vault.md)
- [Lending Market](/vocabulary/market.md)
- [Liquidity Pool](/vocabulary/pool.md)
