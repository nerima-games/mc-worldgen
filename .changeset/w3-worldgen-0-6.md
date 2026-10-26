---
'@nerima-games/mc-worldgen': minor
---

From 0.6 onward, non-integer world seeds and integers outside the safe-integer range return a typed failure. Region planners, village and stronghold site selectors, chunk enumeration, and chunk generators return `Result` values; invalid region or derived footprint coordinates fail with `InvalidNaturalStructureCoordinate`, separately from a valid region with no candidate.
