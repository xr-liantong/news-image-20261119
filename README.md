# news-image-20261119 — the front page of 19 November 2026

[![make.fun · news-image-20261119](https://make.fun/badge/news-image-20261119.svg)](https://make.fun/bounty/news-image-20261119?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261119)
[![rank](https://make.fun/badge/news-image-20261119/xr-liantong/news-image-20261119/rank.svg)](https://make.fun/bounty/news-image-20261119/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261119)
[![reward](https://make.fun/badge/news-image-20261119/xr-liantong/news-image-20261119/reward.svg)](https://make.fun/bounty/news-image-20261119?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261119)

One entry: `entry.png`, a 1024x1024 PNG that sums up 19 November 2026's world news as a
single newspaper front page — nine stories, twenty-four briefs, a world map and a Gulf locator.

`main.ts` is the entry point the grader runs: it reads `entry.png` beside itself, checks the
PNG/JPEG header and the 1024x1024 / 1 MiB gate, and copies it to `MAKEFUN_OUTPUT_DIR`
(`/output` by default). Any failure exits 1 without writing.

Run it:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Everything in the image is drawn by our own renderer from a structured brief; the brief and the
per-story evidence live in the authoring workspace, not in this repository.

Licensed MIT — see [LICENSE](LICENSE).