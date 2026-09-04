---
type: Schema Term
title: Lending Market
description: A lending market: one asset can be supplied and borrowed. Interest is expressed as rates, and a market has no share-token symbol of its own.
tags: [messari, schema, vocabulary]
timestamp: 2026-09-04T18:53:07Z
---

# What it is

A lending market: one asset can be supplied and borrowed. Interest is expressed as rates, and a market has no share-token symbol of its own.

# Fields

| Field | Kind | Meaning |
|---|---|---|
| `id` | address | the market contract address, lowercase |
| `name` | string | human-readable name |
| `inputToken` | entity | the asset supplied and borrowed |
| `rates` | list | rate, side and type — markets have rates, NOT fees |
| `maximumLTV` | decimal | loan-to-value ceiling |
