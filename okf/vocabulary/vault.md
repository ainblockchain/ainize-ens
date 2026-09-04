---
type: Schema Term
title: Vault
description: A tokenized vault: depositors put in an input token and receive an output (share) token. Balances, fees and price-per-share are properties of the vault.
tags: [messari, schema, vocabulary]
timestamp: 2026-09-04T18:53:07Z
---

# What it is

A tokenized vault: depositors put in an input token and receive an output (share) token. Balances, fees and price-per-share are properties of the vault.

# Fields

| Field | Kind | Meaning |
|---|---|---|
| `id` | address | the vault contract address, stored lowercase |
| `name` | string | human-readable name |
| `symbol` | symbol | the share token ticker |
| `inputToken` | entity | what depositors put in |
| `outputToken` | entity | the share token they receive |
| `fees` | list | feeType and feePercentage — vaults have fees, NOT rates |
