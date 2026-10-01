# Full Type Explorer Visual Design Specification

Status: Proposed for the next implementation session  
Scope: Presentation and interaction polish only  
Reference screenshots:

- `image-1.png` (`394 × 192`): disclosure controls touch the following type name and have too little visual breathing room.
- `image-2.png` (`574 × 375`): continuation lines from a nested compiler-rendered type lose their outer indentation and align with the containing property.

## Summary

The Full Type view should feel like a read-only continuation of the active
TypeScript editor. It should use the editor font, follow the active VS Code
color theme, preserve familiar TypeScript syntax coloring, and keep large type
trees readable without hiding information.

The next implementation should make three primary changes:

1. Add theme-aware TypeScript syntax coloring instead of rendering almost all
   type text with one foreground color.
2. Give disclosure controls a larger, clearly separated hit area with native
   VS Code hover and focus states.
3. Replace ad hoc string-prefix indentation with a line-based renderer so every
   continuation line retains the indentation of its containing expression.

These are rendering changes. Type resolution, completeness, expansion depth,
cycle handling, commands, and copied TypeScript output must keep their current
semantics.

## Design goals

- Make the type shape scannable at a glance through syntax color and consistent
  indentation.
- Look native in light, dark, high-contrast, and custom VS Code themes.
- Keep the complete type visible and selectable; do not trade completeness for
  visual simplicity.
- Make expand and collapse controls easy to distinguish, click, and operate
  from the keyboard.
- Preserve the compactness expected from an Explorer sidebar.
- Keep the webview local, CSP-safe, and free of remote assets.

## Non-goals

- Changing which semantic nodes can expand or how one-level expansion works.
- Adding a graph, outline, minimap, search box, breadcrumbs, or settings panel.
- Wrapping long type lines. Long lines continue to use horizontal scrolling.
- Reformatting the compiler's type expression according to the user's source
  formatting settings.
- Making disclosure glyphs part of copied TypeScript text.

## Experience model

### Success state

The view remains a single scrollable code surface:

```text
// TypeScript 7.0.2
// src/server/datasets/virtual/types.ts
// Project: …/tsconfig.json

type VirtualDatasetRow =
  {
    index: number;
    record: Record<string, {
      display_name: string;
      is_dimension?: boolean | undefined;
    }> | {
      display_name: string;
    };
  };
```

The metadata is visually subordinate to the type. The alias declaration and
type expression use editor syntax colors. The view does not wrap; both axes
remain scrollable.

Use the following spacing:

| Element | Specification |
| --- | --- |
| View inset | `8px` block, `10px` inline |
| Metadata to declaration | `8px` |
| Code line height | `var(--vscode-editor-line-height)` |
| Indentation unit | two spaces, rendered with the editor font |
| Disclosure-to-label gap | `4px` minimum |
| Bottom breathing room | `8px` after the final line |

The code area uses `var(--vscode-editor-font-family)`,
`var(--vscode-editor-font-size)`, `var(--vscode-editor-font-weight)`, and
`var(--vscode-editor-line-height)`. It retains the sidebar background so the
view belongs visually to Explorer, while its text palette follows the editor
theme.

### Idle, loading, and error states

- Idle and loading messages use the workbench UI font and
  `--vscode-descriptionForeground` with `12px` padding.
- Error text uses `--vscode-errorForeground`; it must remain concise and
  actionable.
- A notice above a successful type uses the same error treatment but does not
  replace or dim the last valid type.
- Do not add animated spinners. Resolution is normally short and the existing
  loading text is sufficient.

## Theme-aware syntax color

### Requirement

Colors must react automatically when the active VS Code color theme changes.
Do not hard-code colors for a particular dark theme. Every token class must
fall back to `--vscode-editor-foreground` so an incomplete custom theme never
makes text invisible.

VS Code does not expose every resolved TextMate or semantic token color as a
webview CSS variable. To follow the editor rather than merely approximate its
light/dark mode, the extension host should resolve a small token palette from
the active color theme. Supported webview theme variables remain the fallback
when a color is absent or the active theme contribution cannot be resolved.
Do not ship a separate Full Type light/dark palette.

### Palette resolution

Introduce a host-side `ThemeTokenPalette` with colors for keyword, type,
property, string, number, constant, enum member, operator, and comment.

Resolve it in this order:

1. Read the active `workbench.colorTheme` setting.
2. Find the matching entry in the `contributes.themes` metadata of installed
   extensions.
3. Load the contributed theme through `workspace.fs`, following its `include`
   chain and merging inherited rules before local rules.
4. Prefer the theme's semantic token color for a class when present. Use the
   corresponding TextMate scope otherwise:

   | Full Type class | Semantic token | TextMate fallback scope |
   | --- | --- | --- |
   | Keyword/primitive | `keyword` | `keyword`, `storage.type`, `support.type.primitive` |
   | Named type | `type`, `class`, `interface` | `entity.name.type`, `support.type` |
   | Property | `property` | `variable.other.property` |
   | String | `string` | `string` |
   | Number | `number` | `constant.numeric` |
   | Constant | `variable.readonly` | `constant.language` |
   | Enum member | `enumMember` | `variable.other.enummember` |
   | Operator | `operator` | `keyword.operator` |
   | Comment | `comment` | `comment` |

5. Use the webview CSS variable in the table below for every unresolved class.
6. Use `--vscode-editor-foreground` as the final fallback.

Only accept normalized theme foreground values supported by VS Code theme
files, and HTML/CSS-escape values before placing them in the nonce-protected
stylesheet. Listen for changes to `workbench.colorTheme` and rerender the
current view without reconnecting to TypeScript or discarding expansion state.

### Token palette

Emit the resolved palette as custom properties in the nonce-protected
stylesheet and use it throughout the renderer. The unresolved form is:

```css
.type-code {
  --ft-code: var(--vscode-editor-foreground);
  --ft-keyword: var(--vscode-symbolIcon-keywordForeground, var(--ft-code));
  --ft-type: var(--vscode-symbolIcon-classForeground, var(--ft-code));
  --ft-property: var(--vscode-symbolIcon-propertyForeground, var(--ft-code));
  --ft-string: var(--vscode-symbolIcon-stringForeground, var(--ft-code));
  --ft-number: var(--vscode-symbolIcon-numberForeground, var(--ft-code));
  --ft-constant: var(--vscode-symbolIcon-constantForeground, var(--ft-code));
  --ft-enum-member: var(--vscode-symbolIcon-enumeratorMemberForeground, var(--ft-code));
  --ft-operator: var(--vscode-symbolIcon-operatorForeground, var(--ft-code));
  --ft-comment: var(--vscode-descriptionForeground, var(--ft-code));
}
```

Apply the palette as follows:

| Syntax | Class | Examples |
| --- | --- | --- |
| Declaration and type keywords | `tok-keyword` | `type`, `keyof`, `typeof`, `readonly`, `infer`, `extends`, `in` |
| Primitive types and language literals | `tok-keyword` | `string`, `number`, `boolean`, `unknown`, `never`, `undefined`, `true` |
| Alias and named type references | `tok-type` | `VirtualDatasetCell`, `Record`, `Array` |
| Property names | `tok-property` | `display_name`, `data_type`, quoted keys |
| String literals | `tok-string` | `"automatic"`, `"override"` |
| Numeric literals | `tok-number` | `0`, `42` |
| Constants | `tok-constant` | other literal constants |
| Qualified enum members | `tok-enum-member` | `STRING` in `VirtualDatasetCellDataType.STRING` |
| Type operators and punctuation | `tok-operator` or base foreground | `|`, `&`, `=`, `?`, `:`, braces, brackets |
| Metadata, provenance, notes | `tok-comment` | `// Project`, `/* expanded: … */` |

Punctuation may remain at the editor foreground where the theme's operator
color would add too much noise. The important hierarchy is keyword, named
type, property, literal, and comment.

### Tokenization approach

Never syntax-highlight by applying regular expressions to escaped HTML.
Generate escaped spans from plain text tokens:

1. Build the complete display document as structured lines and semantic
   segments.
2. Labels and alias names already known to the renderer receive semantic
   classes directly.
3. Tokenize opaque compiler-produced text with the bundled TypeScript scanner.
   Classify TypeScript keywords, strings, numbers, comments, and punctuation
   from scanner token kinds.
4. Classify an identifier before `?`/`:` in an object member as a property, an
   identifier after `.` as an enum or qualified member, and remaining
   identifiers as named types.
5. HTML-escape each token before wrapping it in a classed `span`.

Highlighting is presentation-only. It must not parse text to infer expansion
relationships or alter the semantic type graph.

## Disclosure controls

The current glyph is visually attached to its label. Treat it as a compact
button, not as another source character.

### Geometry

- Interactive box: `18px × 18px` minimum.
- Glyph: centered, approximately `12px`, using the editor font.
- Inline margin: `2px` before and `4px` after the box.
- Border radius: `3px`.
- Vertical alignment: centered within the code line without increasing the
  configured editor line height.
- The scroll surface must include enough inline padding that a focused or
  hovered control is never clipped at the left edge.

The label begins after the button's trailing margin:

```text
property:  [▸]  VirtualDatasetArrayElementType
```

The spaces above describe visual separation; only the TypeScript content is
copied.

### States

| State | Treatment |
| --- | --- |
| Rest | Transparent background; `--vscode-icon-foreground` glyph |
| Hover | `--vscode-toolbar-hoverBackground` background |
| Active | `--vscode-toolbar-activeBackground` background when available |
| Keyboard focus | `1px solid --vscode-focusBorder`, with `1px` outline offset |
| Expanded | Down chevron and `aria-expanded="true"` |
| Collapsed | Right chevron and `aria-expanded="false"` |
| Recursive | Non-button return arrow in the comment color, with a tooltip/accessible label |

Keep the existing descriptive accessible names, such as “Expand
VirtualDatasetArrayElementType.” Buttons remain native `button` elements and
must activate with Enter and Space. Restoring focus to the same node after a
rerender remains required.

## Indentation and line layout

### Problem

The current HTML renderer prefixes the root expression only on its first line.
Compiler-produced continuation lines already contain relative whitespace, but
they do not receive the containing expression's outer indentation. In the
second reference screenshot, members inside `Record<string, { … }>` therefore
align with `record` instead of nesting beneath it.

### Required model

Replace concatenated HTML strings with a small intermediate representation:

```ts
interface CodeLine {
  readonly indentColumns: number;
  readonly segments: readonly CodeSegment[];
}

type CodeSegment =
  | { readonly kind: "token"; readonly text: string; readonly tokenClass: TokenClass }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "disclosure"; readonly nodeId: string; readonly state: "collapsed" | "expanded" }
  | { readonly kind: "recursive"; readonly label: string };
```

A line writer owns the current structural indentation. Rendering a multiline
compiler string must:

1. Split on `\r?\n` before HTML escaping.
2. Preserve the compiler's relative indentation within that string.
3. Add the containing expression's base indentation to every line, not only
   the first.
4. Keep controls as segments so their pixel width never participates in
   indentation calculations.
5. Join rendered lines with literal newlines inside the preformatted code
   surface so text selection remains predictable.

The root expression is indented one level after `type Name =`. Nested object
members add one level. A multiline leaf begins at its containing expression's
base indentation, and its internal leading whitespace is added to that base.

### Expected correction

The problematic shape must render as:

```ts
type VirtualDatasetRow =
  {
    index: number;
    record: Record<string, {
      display_name: string;
      is_dimension?: boolean | undefined;
      type_provenance?: "automatic" | "override" | undefined;
    }> | {
      display_name: string;
    };
  };
```

It must not render nested `display_name` at the same column as `record`.

### Shared layout source

HTML display and plain-text copy should consume the same line layout wherever
possible. The HTML serializer adds token spans and controls; the text serializer
omits controls. This avoids fixing indentation in the view while leaving the
copied representation formatted differently.

## Scrolling and selection

- Preserve `white-space: pre` and `tab-size: 2`.
- Never soft-wrap type lines.
- Keep one scroll container for metadata and type output so horizontal
  alignment is stable.
- Use `overflow: auto`; do not force a scrollbar when content fits.
- Preserve browser text selection across syntax spans.
- The Copy command remains the authoritative way to copy the complete expanded
  representation and must omit disclosure and recursive glyphs.

## Accessibility and contrast

- Do not rely on color to communicate collapsed, expanded, recursive, error,
  or loading state.
- All text colors come from VS Code theme variables with a visible foreground
  fallback.
- Support VS Code high-contrast themes. In high contrast, button focus and
  hover boundaries must remain visible even if hover background variables are
  absent.
- Maintain logical DOM order: code text and each adjacent disclosure button
  appear in reading order.
- Metadata and notes remain real text, not CSS-generated content.
- The code surface remains selectable with mouse and keyboard.

## Security constraints

The visual redesign must preserve the current webview security properties:

- HTML-escape all compiler, source, project, annotation, note, and label text.
- Keep `default-src 'none'`.
- Keep the nonce-protected bundled script and nonce-protected stylesheet.
- Do not add inline event handlers, remote fonts, remote styles, or remote
  images.
- Validate opaque node IDs exactly as the existing message boundary does.

## Implementation boundaries

Expected implementation work is concentrated in:

- `src/sidebar/renderHtml.ts`: line/segment serialization, token spans, and CSS.
- `src/sidebar/renderText.ts`: consume the shared layout for consistent plain
  text, or adopt the same continuation-line rules.
- A new small renderer module if needed for `CodeLine`, tokenization, and shared
  indentation.
- A small host-side theme palette resolver and configuration-change listener;
  resolving a theme must not trigger type resolution or reset expansion state.
- `test/render.test.ts`: focused layout, escaping, color-class, and control
  markup tests.

No protocol change should be necessary. Do not change native TypeScript
resolution, `TypeRenderNode` expansion behavior, focus handling, or command
semantics as part of this visual pass.

## Acceptance criteria

### Syntax color

- `type`, the alias name, property names, named types, string literals, and
  comments are visually distinguishable in the success view.
- When the active theme publishes a color for a corresponding semantic token or
  TextMate scope, the Full Type category uses that editor color.
- Every unresolved syntax category uses a VS Code theme variable and has
  `--vscode-editor-foreground` as its final fallback.
- Switching between a light theme and a dark theme updates the view without
  reloading the extension host.
- Dark Modern, Light Modern, Dark High Contrast, and Light High Contrast all
  keep every token readable.
- No unescaped compiler text can become HTML through the tokenizer.

### Disclosure controls

- There is at least `4px` of visual separation between a disclosure button and
  its type label.
- The interactive box is at least `18px × 18px` and is not clipped at either
  scroll edge.
- Hover, focus, collapsed, and expanded states are visually distinct.
- Enter and Space toggle the node, `aria-expanded` is accurate, and focus
  returns to the toggled node after rerender.
- Disclosure glyphs remain absent from Copy command output.

### Indentation

- Every continuation line receives its outer expression indentation.
- The `Record<string, { … }> | { … }` case from `image-2.png` renders nested
  members one level deeper than `record`.
- Expanded named objects, nested unions, intersections, arrays, tuples, notes,
  and provenance comments retain consistent two-space structural indentation.
- HTML display and copied text have equivalent structural indentation.
- Indentation is unaffected by the presence or absence of a disclosure button.

### Regression checks

- The complete type still contains every member required by the original
  functional specification.
- Horizontal and vertical scrolling still work for large types.
- Selection works across colored spans.
- Idle, loading, error, and notice states remain accessible.
- CSP, nonce, HTML escaping, and local-only resource requirements remain intact.

## Verification plan for the implementation session

1. Add unit tests for token classification, HTML escaping after tokenization,
   disclosure markup, and multiline indentation.
2. Add a regression fixture matching the nested `Record<string, { … }> | { … }`
   shape in the reference screenshot and assert the complete expected output.
3. Run `npm run check` and the existing extension-host integration suite.
4. Install the generated VSIX in VS Code Insiders.
5. Compare the view manually in Dark Modern, Light Modern, and both
   high-contrast themes.
6. Verify mouse, Enter, Space, focus restoration, selection, Copy, horizontal
   scrolling, Expand one level, and Collapse all against a large real type.
