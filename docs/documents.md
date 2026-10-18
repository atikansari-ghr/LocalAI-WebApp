# Document processing development

Document processing is under development on the phase4 feature branch. It is not exposed by the deployed gateway and the OCR/format phase gate has not passed. The live service remains the qualified phase3 preview.

## Current internal contracts

`inspectDocument({name,mime,bytes},limits)` performs preliminary name/extension/MIME/magic/UTF8/size inspection and returns frozen metadata with the exact SHA256. It does not validate PDF/image structures or archive/container entries. Those results explicitly say requires-parser-validation or requires-container-validation; no caller may interpret them as authorization to extract or process the container. Unknown types and malformed names are rejected. Filename metadata is never a destination filesystem path. Supplied MIME parameters are normalized and checked against the extension's explicit list.

Implementation defaults are10MiB per input and1MiB for UTF8 text. Server-side limits may be reduced; internal overrides are bounded to50MiB and are not public request settings. Shared-memory input views, invalid UTF8, NUL-containing text, path/stream filenames and recognized binary content disguised as text fail. Original upload bytes are unchanged. These defaults are implementation choices, not newly recovered user decisions.

`parseTextDocument` currently supports TXT,Markdown,JSON,CSV andICS only. It returns literal text, frozen source units and a parser identity. Source start/end offsets are zero-based UTF16 indices in the decoded source text, end-exclusive; line/row/column numbers are one-based. UTF8 BOM handling follows TextDecoder, so offsets are not byte offsets in the original file. This contract must remain explicit in later field citations.

- TXT/Markdown preserve literal source, including markup; they do not render HTML or follow links.
- JSON validates syntax and bounds nesting to32 and values to10000; original members remain literal, including duplicate-key evidence. It does not silently turn duplicate keys into selected extracted fields.
- CSV supports quoted delimiters/newlines and escaped quotes, preserving per-cell row/column and original source spans. Formula-looking values remain literal text. Column count is bounded to256.
- ICS unfolds continuation lines and checks balanced bounded components and the VERSION:2.0 calendar envelope. It returns literal calendar content and physical source ranges. It does not resolve URLs, apply timezone/recurrence semantics, validate proposed event fields or create events in any calendar.

Units are capped at10000 and each decoded line/cell at65536UTF16 units; extraction output remains bounded by the text-byte limit. Invalid/unsupported parser requests return safe typed DocumentError codes without echoing document content. parseTextDocument rejects HTML/XML; their separate internal markup parser is described below. EML,PDF,rich Office/OpenDocument/legacy formats,images and ZIP remain unavailable to extraction until corresponding isolated structural parsers are implemented and qualified.

`parseMarkupDocument` now adds internal HTML/XML extraction using a separate locked pure-JavaScript parser cohort. htmlparser2 12.0.0 (MIT) decodes entities, keeps inline text continuity and omits script/style/template and active embedded content. It reports source-text spans and warns that source order is not rendered page layout. It never fetches links, images, frames, stylesheets or scripts. saxes6.0.0 (ISC) validates XML namespaces/well-formedness before text scanning; DTDs are forbidden and external entities/XInclude are never resolved. XML citations preserve exact decoded-source spans and indexed element paths, including CDATA. Markup depth32, nodes10000 and attributes256 are enforced. This is internal parser development, not live document API availability or full phase4 acceptance; email/containers/PDF/images remain pending. Prefix installation is documented in the installation guide and CI.

## Verified dependency observations

On2026-10-18 the official [light-ocr v0.5.8 release](https://github.com/arcships/light-ocr/releases/tag/v0.5.8) resolved to3a4d88e0740a0eda2944eac4f816af538771543b. npm reported newer facade0.5.9, while the selected v0.5.8 candidate declares runtime0.1.8 and PP-OCRv6-small0.3.4; runtime0.1.8 pins platform packages0.5.8. Facade engines require Node>=22, license Apache-2.0. Registry integrity for the selected facade: sha512-wuKwIXyQnvIT2VGqU/Hp68NWixR5CgadEqQd4gV4EETw19E7ch1z7lTXweAQmoNf0wIBrq4nPJInEhI+4geLLQ==. Bundled model/native/font/transitive licenses and real CPU/language compatibility still require inspection/testing; no OCR package has been activated.

Official upstream release observations: [Tesseract5.5.3](https://github.com/tesseract-ocr/tesseract/releases/tag/5.5.3), [PaddleOCR3.7.0](https://github.com/PaddlePaddle/PaddleOCR/releases/tag/v3.7.0). The actual Debian13 repository offers Tesseract5.5.0-1+b1 with English/Arabic packs1:4.1.0-2; a different upstream release is not an interchangeable Debian pin. No Paddle Python/model cohort has been qualified.

Future OCR retains the configured default order light-ocr → Tesseract → PaddleOCR, runs per page after native extraction, reports declared/detected/actually-tested languages and independent quality/review signals, and respects administrator order. Until native malformed-file/mixed-page/fallback/provenance and joint6GB resource gates pass, this document makes no OCR support or phase4 acceptance claim.

The selected Small bundle manifest identifies ppocrv6-small-native-20260719.1 and Apache-2.0 model notices, with exact detector/recognizer hashes and PaddleOCR revision b03f46425e8ff4442b268ce449e3eef758146cd4. Inspection of its decoded recognition dictionary found zero Arabic or Devanagari characters. The facade's declared50language count and empty excludedLanguages list are insufficient evidence of Arabic support. The native synthetic probe must record this limitation and require fallback rather than silently claiming multilingual recognition.

The candidate dependency cohort is locked separately in services/documents/package-lock.json; npm audit reported zero known vulnerabilities on2026-10-18. This is not proof of native/model safety or language compatibility. No candidate dependency is added to the deployed gateway's dependency tree. Synthetic English/Arabic PNGs are generated by scripts/create-ocr-fixtures.ps1 using Windows GDI+/Arial; they contain no personal data and are benchmark images, not product screenshots. Their exact hashes are checked by the native probe.

## Bounded ZIP inspection checkpoint

`readZipDocument` validates generic ZIP containers in memory, without writing extracted files. Defaults:100 entries across nested archives,10MiB per member,50MiB total expanded bytes,100:1 compression ratio,two nested archive levels and a10second shared deadline. Trusted callers may only reduce these limits. Stored/deflated ZIP2.0 records require matching local/central headers, exact expanded sizes and CRC32; encrypted, spanned, ZIP64 and unsupported codecs are rejected. Paths are normalized and checked for traversal, aliases, file/directory collisions, links and special/executable files. Cancellation is shared across nested reads.

Returned member bytes still require their own format parser and authorization. This checkpoint does not accept Office containers, expose an upload route or qualify the full document phase. Archive entry/source hashes describe exact bytes; no extracted member name is used as a filesystem path.
