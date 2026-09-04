---
type: Knowledge Catalog
title: engram.eth
description: The memory of an agent family — a vocabulary layer, the deployments its descendants learned, and the policy layer a person writes.
tags: [engram, agent, lineage]
timestamp: 2026-09-04T18:53:07Z
---

# The family

```
engram.eth                            the ancestor: base model, nothing loaded
└─ defi.engram.eth                    vocabulary/   — what a vault, market, pool IS
   ├─ vaults.defi.engram.eth          deployments/vaults/
   ├─ lending.defi.engram.eth         deployments/lending/
   └─ risk.vaults.defi.engram.eth     policy/       — authored, never generated
```

Each generation is trained on top of its parent's checkpoint, and the name is minted only when the teach job
proves it: `pre_state_sha256` matching the parent, `patch_sha256` matching the artefact the name resolves
to, a benchmark passed on two distinct runtimes, and a real gradient backend. A stub-backed job mints nothing.

# Provenance

All generated facts come from subgraph queries pinned to block **25902936**, with raw responses committed.
Re-running the pull at that block reproduces them byte for byte.

- [Vocabulary](/vocabulary/index.md)
- [Policy](/policy/index.md)
