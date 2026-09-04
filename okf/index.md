---
type: Knowledge Catalog
title: Hackathon Catalog
description: The bounties, rules and eligibility of the event this agent is competing in — the memory that expires when the event does.
tags: [hackathon, bounties, engram]
timestamp: 2026-09-04T10:30:00Z
---

# What this catalog is

An [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) catalog of
one hackathon, written to be **compiled into a model's memory** rather than retrieved at question time.

It is the demo corpus for `hackathon.engram.eth`. The questions it has to answer are the ones a team asks at
3am — "which bounties can I still enter with what we have built", "does this track need a live demo", "what
is second place worth" — and every one of them needs the WHOLE catalog at once, which is why it is compiled
and not searched.

# Sections

- [bounties](/bounties/index.md) — one file per sponsor track, with prizes and qualification requirements
- [rules](/rules/index.md) — submission requirements that apply across tracks

# Why this memory expires

An event catalog is true for about a week. After the event, every fact in here is a confidently wrong answer
about a hackathon that already happened, and a compiled memory cannot be un-learned by deleting a file. So the
name that carries it is minted with an expiry, and when the event ends the name lapses and the knowledge
leaves the catalog. Nothing here is forever knowledge and the naming reflects that.
