# news-image-20261119 — front page of 19 November 2026

One entry: ntry.png, a 1024x1024 PNG summing up 19 November's world news as a single
newspaper front page (9 stories, 24 briefs, a world map, a Gulf locator).

main.ts is the entry point the grader runs: it reads ntry.png beside itself, checks the
PNG/JPEG header and the 1024x1024 / 1 MiB gate, and copies it to MAKEFUN_OUTPUT_DIR
(/output by default). Any failure exits 1 without writing.

Source material: work/news/content-2026-11-19.json in the authoring workspace, with the
per-story evidence files under work/news/evidence-2026-11-19/.
