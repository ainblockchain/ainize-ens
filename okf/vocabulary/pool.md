---
type: Schema Term
title: Liquidity Pool
description: A DEX liquidity pool holding two or more tokens. Note inputTokens is PLURAL, which is the field that most often breaks a query written against the vault schema.
tags: [messari, schema, vocabulary]
timestamp: 2026-09-09T05:06:26Z
---

# What it is

A DEX liquidity pool holding two or more tokens. Note inputTokens is PLURAL, which is the field that most often breaks a query written against the vault schema.

# Fields

| Field | Kind | Meaning |
|---|---|---|
| `id` | address | the pool contract address, lowercase |
| `name` | string | human-readable name |
| `symbol` | symbol | the LP token ticker |
| `inputTokens` | list | the tokens in the pool — plural |
| `fees` | list | pool fees |
