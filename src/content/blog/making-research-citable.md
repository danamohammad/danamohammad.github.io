---
title: Making research citable — a reproducible archiving workflow
date: 2026-07-29
status: working note
description: A checklist for turning a finished piece of research into something with a permanent identifier, a frozen artefact and a reproducible environment.
tags: [methodology, open-science, doi]
---

A finished analysis that lives only on a website is not research anyone can build on. It
has no permanent identifier, no frozen version, and no guarantee of existing next year.
This note records the workflow I use to fix that.

## The problem with linking to a webpage

URLs rot. Studies of reference rot in academic literature consistently find that a large
share of cited web links break within a few years. A citation that points at a personal
domain is a citation with an expiry date.

A DOI solves this because it is a layer of indirection: the identifier is permanent and
the resolver points at wherever the artefact currently lives.

## The workflow

1. **Freeze the artefact.** Tag the exact commit of the code and data used to produce
   the result. Not "main" — a tag.
2. **Deposit to Zenodo.** Zenodo accepts a GitHub release automatically once the
   repository is linked, or you can upload directly via its API.
3. **Record the environment.** A `requirements.txt` with pinned versions, or a lockfile.
   Unpinned dependencies make a result unreproducible within months.
4. **Write the README as an entry point.** State what the result is, how to regenerate
   it, and roughly how long that takes.
5. **Link back.** The readable write-up cites the DOI; the deposit links to the write-up.

## What goes in a deposit

- The manuscript or write-up, as PDF
- Source data, or a fetch script if the data is too large or licence-restricted
- Analysis code at the tagged commit
- A `CITATION.cff` file so GitHub and reference managers can generate citations

## Why Zenodo specifically

It is operated by CERN, funded independently of any commercial publisher, has no upload
fee, and issues both a version-specific DOI and a concept DOI that always resolves to the
latest version. That last detail matters more than it sounds: you can cite "the current
version" or "version 2.1" and both remain valid forever.

## Deposit checklist

```text
[ ] Repository tagged at the exact analysis commit
[ ] Dependencies pinned
[ ] README explains how to reproduce, with runtime estimate
[ ] CITATION.cff present
[ ] Licence chosen (CC-BY for text, permissive for code)
[ ] Zenodo deposit created, DOI recorded
[ ] Write-up links to the DOI, deposit links to the write-up
```

## Open question

The step that stays awkward is data that cannot be redistributed — licence-restricted
corpora, or anything with personal data in it. The usual answer is to publish a fetch
script plus a checksum manifest, so a reader with their own access to the source can
verify they have the same bytes. It works, but it shifts the reproducibility burden onto
the reader, and I have not found a better option.
