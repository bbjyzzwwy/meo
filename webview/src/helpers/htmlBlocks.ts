import { WidgetType, Decoration, EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import DOMPurify from 'dompurify';

// ============================================================================
// DOMPurify configuration
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PURIFY_CONFIG: any = {
  ALLOWED_TAGS: [
    'div', 'span', 'p', 'br', 'hr', 'wbr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'a', 'img', 'figure', 'figcaption',
    'blockquote', 'pre', 'code', 'samp', 'var',
    'b', 'i', 'u', 's', 'em', 'strong', 'small', 'mark', 'ins', 'del', 'sub', 'sup',
    'abbr', 'cite', 'dfn', 'q', 'time', 'data',
    'video', 'audio', 'source', 'track',
    'iframe',
    'details', 'summary',
    'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
    'ruby', 'rt', 'rp',
    'kbd', // handled separately but safe to allow
  ],
  ALLOWED_ATTR: [
    'class', 'id', 'style', 'title', 'lang', 'dir',
    'href', 'target', 'rel', 'name',
    'src', 'alt', 'width', 'height', 'loading',
    'colspan', 'rowspan',
    'start', 'reversed', 'type',
    'controls', 'autoplay', 'loop', 'muted', 'preload',
    'cite', 'datetime',
    'data-*',
  ],
  ALLOW_DATA_ATTR: true,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  ADD_TAGS: [] as string[],
  ADD_ATTR: [] as string[],
  FORBID_TAGS: ['script', 'style', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur',
    'onchange', 'onsubmit', 'onkeydown', 'onkeypress', 'onkeyup', 'ondblclick',
    'oncontextmenu', 'onmousedown', 'onmouseup', 'onmousemove',
  ],
  KEEP_CONTENT: true,
  WHOLE_DOCUMENT: false,
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
  SANITIZE_DOM: true,
};

// ============================================================================
// Sanitization
// ============================================================================

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  const trimmed = html.trim();
  if (!trimmed) return '';
  return DOMPurify.sanitize(trimmed, PURIFY_CONFIG) as unknown as string;
}

// ============================================================================
// HTML Block Widget
// ============================================================================

const htmlBlockWidgetCache = new Map<string, HtmlBlockWidget>();
const HTML_BLOCK_CACHE_LIMIT = 200;

function getHtmlBlockWidget(
  sanitized: string,
  startLine: number,
  endLine: number,
): HtmlBlockWidget {
  const cacheKey = `${startLine}:${endLine}:${sanitized}`;
  let widget = htmlBlockWidgetCache.get(cacheKey);
  if (widget) {
    // LRU-like: move to end by re-inserting
    htmlBlockWidgetCache.delete(cacheKey);
    htmlBlockWidgetCache.set(cacheKey, widget);
    return widget;
  }
  widget = new HtmlBlockWidget(sanitized, startLine, endLine);
  htmlBlockWidgetCache.set(cacheKey, widget);
  if (htmlBlockWidgetCache.size > HTML_BLOCK_CACHE_LIMIT) {
    const oldest = htmlBlockWidgetCache.keys().next().value;
    if (oldest) {
      htmlBlockWidgetCache.delete(oldest);
    }
  }
  return widget;
}

export class HtmlBlockWidget extends WidgetType {
  private sanitized: string;
  private startLine: number;
  private endLine: number;

  constructor(sanitized: string, startLine: number, endLine: number) {
    super();
    this.sanitized = sanitized;
    this.startLine = startLine;
    this.endLine = endLine;
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof HtmlBlockWidget &&
      other.sanitized === this.sanitized &&
      other.startLine === this.startLine &&
      other.endLine === this.endLine
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'meo-md-html-block';
    wrapper.dataset.meoRenderedBlockStartLine = String(this.startLine);
    wrapper.dataset.meoRenderedBlockEndLine = String(this.endLine);
    wrapper.dataset.meoRenderedBlockKind = 'html';

    wrapper.innerHTML = this.sanitized;

    // Click on the rendered HTML block moves the cursor inside the source
    wrapper.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) return;
      // Let clicks on interactive elements (links, media controls) work normally
      const target = event.target as HTMLElement | null;
      if (target?.closest('a, button, input, select, textarea, video, audio, details, summary')) {
        return;
      }
      const view = EditorView.findFromDOM(wrapper);
      if (!view) return;
      const contentLineNo = Math.max(1, Math.min(this.startLine + 1, this.endLine));
      const targetPos = view.state.doc.line(contentLineNo).from;
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: targetPos } });
      view.focus();
    });

    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }

  destroy(): void {
    // No cleanup needed
  }
}

// ============================================================================
// Inline HTML Tags
// ============================================================================

/** Void HTML elements: never have content or a closing tag. */
const VOID_INLINE_TAGS = new Set(['br', 'hr', 'wbr']);

/** Inline HTML tags we can safely render as styled elements. */
const SAFE_INLINE_TAGS = new Set([
  'span', 'sup', 'sub', 'mark', 'ins', 'del',
  'small', 'abbr', 'dfn', 'q', 'time', 'var', 'cite', 'data', 'samp',
  'b', 'i', 'u', 's', 'em', 'strong', 'code',
  ...VOID_INLINE_TAGS,
]);

const INLINE_TAG_ALLOWED_ATTR = [
  'class', 'id', 'style', 'title', 'lang', 'dir', 'href', 'target', 'rel',
  'cite', 'datetime', 'data-*',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inlineTagPurifyConfig(tagName: string): any {
  return {
    ALLOWED_TAGS: [tagName],
    ALLOWED_ATTR: INLINE_TAG_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: true,
    FORBID_TAGS: ['script', 'style', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur',
      'onchange', 'onsubmit', 'onkeydown', 'onkeypress', 'onkeyup', 'ondblclick',
      'oncontextmenu', 'onmousedown', 'onmouseup', 'onmousemove',
    ],
  };
}

/**
 * What an inline `HTMLTag` node is: the opening half of a pair, the closing
 * half, a void element, or a self-closed element.
 */
export type InlineHtmlTagKind = 'open' | 'close' | 'void' | 'selfClosing';

export interface InlineHtmlTagInfo {
  tagName: string;
  attributes: string;
  kind: InlineHtmlTagKind;
}

const inlineTagRe = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)(\s*\/)?\s*>$/;

/**
 * Classify a single inline HTML tag. The markdown parser emits the opening and
 * closing halves of `<sup>x</sup>` as two separate nodes, so each is classified
 * on its own and paired up by the caller.
 * Returns null for anything outside the safe inline tag set.
 */
export function classifyInlineHtmlTag(text: string): InlineHtmlTagInfo | null {
  const match = inlineTagRe.exec(text.trim());
  if (!match) return null;

  const [, closingSlash, rawTagName, rawAttributes, selfClosingSlash] = match;
  const tagName = rawTagName.toLowerCase();
  if (!SAFE_INLINE_TAGS.has(tagName)) return null;

  const attributes = rawAttributes.trim();

  if (VOID_INLINE_TAGS.has(tagName)) {
    // `</br>` is not a thing; treat it as plain text.
    return closingSlash ? null : { tagName, attributes, kind: 'void' };
  }
  if (closingSlash) {
    return { tagName, attributes: '', kind: 'close' };
  }
  return { tagName, attributes, kind: selfClosingSlash ? 'selfClosing' : 'open' };
}

/**
 * Run a tag's raw attribute text through the sanitizer and hand back what
 * survived, so callers can apply it to an element they build themselves.
 */
export function sanitizeInlineTagAttributes(tagName: string, attributes: string): Record<string, string> {
  if (!attributes) return {};

  const fragment = DOMPurify.sanitize(`<${tagName} ${attributes}></${tagName}>`, {
    ...inlineTagPurifyConfig(tagName),
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment;

  const element = fragment.firstElementChild;
  if (!element) return {};

  const sanitized: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    sanitized[attribute.name] = attribute.value;
  }
  return sanitized;
}

// ============================================================================
// Inline HTML Tag Widget
// ============================================================================

const inlineTagWidgetCache = new Map<string, HtmlTagWidget>();
const INLINE_TAG_CACHE_LIMIT = 300;

/** Widget for tags that stand alone: void elements and self-closed elements. */
export function getHtmlTagWidget(tagName: string, attributes: string): HtmlTagWidget {
  const cacheKey = `${tagName}:${attributes}`;
  let widget = inlineTagWidgetCache.get(cacheKey);
  if (widget) {
    inlineTagWidgetCache.delete(cacheKey);
    inlineTagWidgetCache.set(cacheKey, widget);
    return widget;
  }
  widget = new HtmlTagWidget(tagName, attributes);
  inlineTagWidgetCache.set(cacheKey, widget);
  if (inlineTagWidgetCache.size > INLINE_TAG_CACHE_LIMIT) {
    const oldest = inlineTagWidgetCache.keys().next().value;
    if (oldest) {
      inlineTagWidgetCache.delete(oldest);
    }
  }
  return widget;
}

export class HtmlTagWidget extends WidgetType {
  private tagName: string;
  private attributes: string;

  constructor(tagName: string, attributes: string) {
    super();
    this.tagName = tagName;
    this.attributes = attributes;
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof HtmlTagWidget &&
      other.tagName === this.tagName &&
      other.attributes === this.attributes
    );
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = 'meo-md-html-inline';
    const attrStr = this.attributes ? ` ${this.attributes}` : '';
    wrapper.innerHTML = DOMPurify.sanitize(
      `<${this.tagName}${attrStr} />`,
      inlineTagPurifyConfig(this.tagName),
    ) as unknown as string;
    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ============================================================================
// HTML Block Detection and Parsing
// ============================================================================

const detailsOpenTagRe = /<details\b[^>]*>/i;

/** Check if a raw HTML block text contains a <details> tag (already handled elsewhere). */
export function isDetailsBlock(rawHtml: string): boolean {
  return detailsOpenTagRe.test(rawHtml);
}

// ============================================================================
// Decoration helpers
// ============================================================================

/**
 * Check if any line in the given range is an active line (cursor on it).
 */
export function rangeTouchesActiveLine(
  state: EditorState,
  from: number,
  to: number,
  activeLines: Set<number>,
): boolean {
  if (to <= from) return false;
  const startLine = state.doc.lineAt(from).number;
  const endLine = state.doc.lineAt(Math.max(from, to - 1)).number;
  for (let lineNo = startLine; lineNo <= endLine; lineNo += 1) {
    if (activeLines.has(lineNo)) return true;
  }
  return false;
}

/**
 * Check if selection overlaps the given range.
 */
export function overlapsSelection(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  for (const range of state.selection.ranges) {
    const selFrom = Math.min(range.from, range.to);
    const selTo = Math.max(range.from, range.to);
    if (selFrom < to && selTo > from) return true;
  }
  return false;
}

// ============================================================================
// Configuration flag
// ============================================================================

let htmlRenderEnabled = true;

export function isHtmlRenderEnabled(): boolean {
  return htmlRenderEnabled;
}

export function setHtmlRenderEnabled(enabled: boolean): void {
  htmlRenderEnabled = enabled;
}

// ============================================================================
// Main decoration entry point for HTMLBlock nodes
// ============================================================================

export interface HtmlBlockDecorationInput {
  state: EditorState;
  node: { from: number; to: number };
  activeLines: Set<number>;
  builder: any[];
}

/**
 * Add decorations for a block-level HTML node.
 * Returns true if a decoration was added.
 */
export function addHtmlBlockDecoration(input: HtmlBlockDecorationInput): boolean {
  const { state, node, activeLines, builder } = input;

  if (!htmlRenderEnabled) return false;
  if (node.to <= node.from) return false;

  const rawHtml = state.doc.sliceString(node.from, node.to);
  if (!rawHtml.trim()) return false;

  // Skip <details> blocks — handled by headingCollapse.ts
  if (isDetailsBlock(rawHtml)) return false;

  // Don't render if cursor is on any line within the block — show source for editing
  if (rangeTouchesActiveLine(state, node.from, node.to, activeLines)) return false;
  if (overlapsSelection(state, node.from, node.to)) return false;

  const sanitized = sanitizeHtml(rawHtml);
  if (!sanitized) return false;

  const startLine = state.doc.lineAt(node.from).number;
  const endLine = state.doc.lineAt(Math.max(node.to - 1, node.from)).number;

  // For single-line blocks with no block-level tags, skip (let inline handling take over)
  if (startLine === endLine) {
    const hasBlockTags = /<(div|p|h[1-6]|br|hr|table|ul|ol|dl|blockquote|pre|section|article|aside|header|footer|nav|main|figure|video|audio|details)\b/i.test(rawHtml);
    if (!hasBlockTags) return false;
  }

  const widget = getHtmlBlockWidget(sanitized, startLine, endLine);
  builder.push(
    Decoration.replace({
      widget,
      block: true,
    }).range(node.from, node.to),
  );

  return true;
}
