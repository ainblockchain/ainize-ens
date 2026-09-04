---
type: Policy
title: Fund Policy
description: One fund's rules about which vaults it will touch. Subjective by construction — authored, never generated.
tags: [policy, private]
timestamp: 2026-09-04T18:53:07Z
---

# This file is a placeholder and must be written by a person

`risk.vaults.defi.engram.eth` is the layer that makes the tree a tree. There is no correct answer to "which
vaults are acceptable", which is why a canonical registry cannot work and why a fork carrying somebody's
judgement is the right shape. A generator writing this layer would be inventing the one thing the design says
a person must author.

Write rules as a table so they extract deterministically, e.g.

| Rule | Value | Why |
|---|---|---|
| minimum TVL | 1000000 | below this a withdrawal moves the price |
| excluded protocol | example-protocol | unaudited |
