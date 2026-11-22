# English word dataset provenance

This directory contains a pinned snapshot of the existing **zxcvbn English Wikipedia frequency list**, distributed in Chromium's `ZxcvbnData` component, version **3**.

- Original project: <https://github.com/dropbox/zxcvbn>
- C++ port used by Chromium: <https://github.com/rianhunter/zxcvbn-cpp>
- Original filename: `english_wikipedia.txt`
- Original snapshot: 30,000 nonempty lines, 277,015 bytes
- SHA-256: `b29af10c62218f948eb299e0c68b176ab1c5ecdfe9813bd957bf2c434e90813e`
- Snapshot collected: 2026-11-22
- Source location: the installed Chromium browser component `ZxcvbnData/3/english_wikipedia.txt`; its accompanying manifest identifies the component as `zxcvbnData`, version `3`.

Network access was unavailable when the snapshot was collected. This identifies the exact local distribution and content hash; it does **not** claim a verified upstream Git commit or the latest available release.

## License evidence

The accompanying `LICENSE` is the exact MIT notice for **“C++ port of zxcvbn, an advanced password strength estimation library”**, extracted from the installed Chromium third-party notices (`Visual Studio Code.app/Contents/Resources/LICENSES.chromium.html`). It names:

```text
Copyright (c) 2016 Rian Hunter
Copyright (c) 2012-2016 Dan Wheeler and Dropbox, Inc.
```

The same notice is also present in the locally installed Electron distribution's Chromium notices. The original notice is retained here and copied to `public/words/LICENSE-zxcvbn.txt` for deployed builds.

Only the English Wikipedia corpus is used. The component's password, personal-name, surname, and television/film lists are **not** included. This corpus is distributed data, not a user's browsing history or personal dictionary.

## Generated data

Run from the project directory:

```sh
node scripts/build-english-dataset.mjs
node scripts/build-english-dataset.mjs --check
```

The script reads this committed snapshot, checks its pinned SHA-256, trims whitespace, lowercases entries, retains only ASCII `a`–`z` words with at least two letters, removes duplicates, sorts lexicographically, and writes **exactly 26 word files** to `public/words/en/a.json` through `z.json`. Each file is a JSON array of strings. No words are manually added.

Metadata, per-letter counts, byte sizes, output hashes, and the stable dataset version are written separately to `public/words/en-manifest.json`. WordStride randomly samples up to 25 distinct entries from the selected letter’s file on each batch. Entries can repeat across batches. All 26 current letter files have at least 25 entries. The source stays sorted for reproducible generation.

## Suitability and limits

The generated dataset has **29,490 entries**. It is a frequency-derived English corpus, **not a complete dictionary of all English words**. Names, abbreviations, inflected forms, specialist terms, and uncommon entries occur in the original source and may remain. A title beginning with a letter does not guarantee that it has an English dictionary definition.

The word files intentionally contain only words. Definitions, parts of speech, and example sentences belong to the app's dictionary enrichment layer. Short-letter lists should return their actual remaining size rather than padding a batch with repeats.
