# Website datasets

## Knowledge Network

The [arXiv metadata API](https://info.arxiv.org/help/api/user-manual.html) provides paper records for submissions tagged `gr-qc`, including cross-lists, first submitted from January 1993 through April 2003. The source snapshot contains 15,908 unique papers, including 10,409 with GR-QC as the primary category. It was acquired November 22, 2026. The SHA-256 of the normalized `papers.json` is `f51fe481ccfc4c09b0942ae6ce918ea80c76a664e1d81c653e633cd9b8b468eb`.

The graph uses exact normalized author-name spellings as keys, so abbreviated variants and homonyms remain unresolved. Each distinct coauthor pair is one undirected link. The rendering asset retains the largest connected component with 5,570 author names, 16,067 links, and 53 Louvain communities. The component represents 11,238 papers. Community topics come from distinctive terms in titles and abstracts, with papers weighted by their share of authors in each community.

The colors use each author's most frequent additional arXiv tag, counting each paper once per tag. Ties favor the tag used as the primary category on the most papers, then alphabetical order. Authors with no additional tags use `gr-qc`.

The bundled version 2 asset, `public/datasets/arxiv-grqc.json.gz`, contains author names, dense endpoint indices, community indices, topic labels, and an arXiv category index per author. It is 97,747 bytes with SHA-256 `13269ad086abaa95790ca3a0b27fb7f7a8dfdc60c177c56b9f38dd2e6c7099d3`. The [manifest](src/scenes/data/arxiv-grqc-manifest.json) tracks the counts, asset name, and ordered category names.

## California–Nevada Road Network

The public-domain `USA-road-d.CAL` dataset comes from the [9th DIMACS Implementation Challenge: Shortest Paths](https://web.archive.org/web/*/http://www.dis.uniroma1.it/challenge9/download.shtml). The adaptation projects all 1,890,815 original coordinates into XY without sampling or simplification. The 4,657,742 weighted, directed arc records include 27,298 repeated directed endpoint pairs. The visualization combines opposite directions and repeated endpoints into 2,315,222 undirected links and omits the weights.

The source files and their SHA-256 checksums are:

- [`USA-road-d.CAL.co.gz`](https://web.archive.org/web/20161221084316id_/http://www.dis.uniroma1.it/challenge9/data/USA-road-d/USA-road-d.CAL.co.gz): `75b13daffc71efc1baf41c7276218c323f29f3d2237da8688e261a1bf9606fe4`
- [`USA-road-d.CAL.gr.gz`](https://web.archive.org/web/20240122162928id_/http://www.diag.uniroma1.it/challenge9/data/USA-road-d/USA-road-d.CAL.gr.gz): `bb79eba9185ae399f2d885c4d71ca7e42d39787d9eee66b9bf579e5d747f0d76`

The compressed [`dimacs-cal.cgd.gz` asset](https://d.cosmograph.app/cosmos.gl/dimacs-cal.cgd.gz) is 16,560,973 bytes with SHA-256 `c6039f43346347f44b50b18440372facec8a56603ddb403808ac9e07cecb585c`. Once decompressed, the little-endian binary begins with the four ASCII bytes `CGD1` and three `uint32` values for point count, link count, and flags (zero for this asset). The header is followed by interleaved `float32` coordinates and interleaved `uint32` endpoint indices.

## Hosting

The Roads Network loads from Cosmograph's public R2 endpoint by default, including in local development. Set `VITE_ROADS_DATASET_URL` to override that URL. Knowledge Network loads the bundled asset by default. Set `VITE_DATASETS_BASE_URL` to a directory containing `arxiv-grqc.json.gz` to load it from another host.

For external hosting, serve the assets as `Content-Type: application/gzip` and allow cross-origin `GET` requests from the site's origin and any preview origins. See the [R2 CORS documentation](https://developers.cloudflare.com/r2/buckets/cors/).
