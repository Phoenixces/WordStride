# WordStride English word dataset

29,490 entries from the zxcvbn English Wikipedia word-frequency list, distributed in Chromium's ZxcvbnData component, version 3.

- Original project: https://github.com/dropbox/zxcvbn
- Chromium port: https://github.com/rianhunter/zxcvbn-cpp
- Licence: [MIT notice](./LICENSE-zxcvbn.txt)
- Dataset metadata and per-letter hashes: [manifest](./en-manifest.json)

Copyright (c) 2016 Rian Hunter. Copyright (c) 2012–2016 Dan Wheeler and Dropbox, Inc.

Each of the 26 files in `en/` contains unique lowercase ASCII entries beginning with that letter, sorted lexicographically. Source entries are trimmed and lowercased; nonalphabetic entries and entries shorter than two letters are excluded. No words are invented or manually added.

This is a frequency corpus, not an exhaustive dictionary. Names, abbreviations, specialist terms and uncommon entries may remain. It does not include definitions or example sentences.

WordStride loads the selected letter’s file and randomly samples 25 distinct words. Practice uses all letters, regardless of earned key checkmarks. Batches can repeat previously practised words, so a letter never becomes exhausted. Stored files remain alphabetically sorted; their order does not determine the lesson order.

Meanings and examples come from a small original fallback collection or Free Dictionary API. Remote entries link to their dictionary source. Missing definitions or examples are labelled explicitly.
