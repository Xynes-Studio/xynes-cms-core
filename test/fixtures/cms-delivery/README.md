# CMS publication fixtures

`contract.v1.json` and its SHA-256 file pin the reviewed A1 artifact from platform-contracts develop `141e32a`. The unit parity test validates summary bounds and the snapshot budget against it.

`lexical-0.38.2.json` is actual JSON exported by the installed Lumia editor's Lexical 0.38.2 engine, not a simplified hand-written document. It contains a default public link, an ordinary uncolored table, a styled table and a highlighted code block. Exported null link attributes and null cell background colors are intentional compatibility cases. Optional striping/frozen table dimensions, middle cell alignment and code theme are serialized public presentation metadata.

Generated locally with `createEditor` (no DOM/network) from `lumia-ds/packages/editor`: register `LinkNode`, `AutoLinkNode`, `TableNode`, `TableRowNode`, `TableCellNode`, `CodeNode`, `CodeHighlightNode`; append a paragraph/link, two `$createTableNodeWithDimensions(1,1)` tables and a code node inside a discrete editor update; serialize `editor.getEditorState().toJSON()`. One table sets row striping, frozen rows/columns and cell color/alignment; code sets a harmless fixture theme. No production data or signed URL appears in the fixture.

The CMS tests do not import editor dependencies at runtime. When updating the supported editor version, regenerate and review the fixture deliberately. Tests must retain rejection cases for unsupported/private fields, malformed presentation values, resource-bearing CSS and signed URLs.
