import { EditorState, type ChangeSpec } from '@codemirror/state';
import { extractHeadings } from './markdownSyntax';
import { parseFrontmatter } from './frontmatter';

// `## 1.2 Title` -> hashes, gap, numbering prefix, gap. A trailing dot is tolerated so numbering
// written by other tools (`## 1.2. Title`) is still recognised, and the prefix has to be followed by
// whitespace or the line end so `## 2024年度总结` keeps its title intact.
const headingMarkerPattern = /^(#{1,6})([ \t]*)(?:(\d+(?:\.\d+)*\.?)(?=[ \t]|$))?([ \t]*)/;

// Numbering rewrites the whole document, so give the parser room to finish instead of settling for
// the viewport-sized tree the interactive helpers are happy with.
const headingParseTimeoutMs = 5000;

interface NumberableHeading {
  level: number;
  from: number;
  gapFrom: number;
  gapTo: number;
  numbered: boolean;
  hasTitleText: boolean;
}

function collectNumberableHeadings(state: EditorState): NumberableHeading[] {
  const frontmatter = parseFrontmatter(state);
  const headings: NumberableHeading[] = [];

  for (const heading of extractHeadings(state, headingParseTimeoutMs)) {
    if (frontmatter && heading.from >= frontmatter.from && heading.from < frontmatter.to) {
      continue;
    }

    const line = state.doc.lineAt(heading.from);
    const match = headingMarkerPattern.exec(line.text.slice(heading.from - line.from));
    if (!match) {
      continue;
    }

    const gapFrom = heading.from + match[1].length;
    const gapTo = heading.from + match[0].length;
    headings.push({
      level: heading.level,
      from: heading.from,
      gapFrom,
      gapTo,
      numbered: Boolean(match[3]),
      hasTitleText: gapTo < line.to
    });
  }

  headings.sort((a, b) => a.from - b.from);
  return headings;
}

function computeHeadingNumbers(levels: number[]): string[] {
  const counters: Array<{ level: number; index: number }> = [];

  return levels.map((level) => {
    while (counters.length > 0 && counters[counters.length - 1].level > level) {
      counters.pop();
    }

    const deepest = counters[counters.length - 1];
    if (deepest && deepest.level === level) {
      deepest.index += 1;
    } else {
      counters.push({ level, index: 1 });
    }

    return counters.map((counter) => counter.index).join('.');
  });
}

export interface HeadingNumberingToggle {
  /** Whether the returned changes number the headings (`true`) or strip existing numbers (`false`). */
  numbered: boolean;
  changes: ChangeSpec[];
}

/**
 * Numbers every heading (`1`, `1.1`, `1.1.1` …) starting from the shallowest level in the document,
 * or strips the numbering when any heading already carries it.
 */
export function collectHeadingNumberingChanges(state: EditorState): HeadingNumberingToggle {
  const headings = collectNumberableHeadings(state);
  const shouldNumber = headings.length > 0 && !headings.some((heading) => heading.numbered);
  const numbers = shouldNumber ? computeHeadingNumbers(headings.map((heading) => heading.level)) : null;
  const changes: ChangeSpec[] = [];

  headings.forEach((heading, index) => {
    const prefix = numbers ? `${numbers[index]}` : '';
    const insert = prefix
      ? (heading.hasTitleText ? ` ${prefix} ` : ` ${prefix}`)
      : (heading.hasTitleText ? ' ' : '');
    if (state.doc.sliceString(heading.gapFrom, heading.gapTo) === insert) {
      return;
    }
    changes.push({ from: heading.gapFrom, to: heading.gapTo, insert });
  });

  return { numbered: shouldNumber, changes };
}
