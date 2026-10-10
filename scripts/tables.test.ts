import { describe, expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { resolvedSyntaxTree } from '../webview/src/helpers/markdownSyntax';
import { getLiveRenderedBlocks } from '../webview/src/helpers/liveRenderedBlocks';
import { addTableDecorations, isTableDelimiterLine, parseTableInfo, sourceTableHeaderLineField } from '../webview/src/helpers/tables';
import { liveModeExtensions } from '../webview/src/liveMode';

function liveTableWidgets(doc: string) {
  const state = EditorState.create({ doc, extensions: liveModeExtensions() });
  const widgets = [];
  for (const decorations of state.facet(EditorView.decorations)) {
    if (typeof decorations === 'function') continue;
    for (const cursor = decorations.iter(); cursor.value; cursor.next()) {
      if (cursor.value.spec.widget?.tableData) widgets.push(cursor.value.spec.widget);
    }
  }
  return widgets;
}

function tableState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [sourceTableHeaderLineField, markdown({
      base: markdownLanguage,
      extensions: [{ remove: ['SetextHeading'] }]
    })]
  });
}

describe('table rendering with indentation', () => {
  for (const { name, prefix, indent } of [
    { name: 'top-level', prefix: '', indent: '' },
    { name: 'indented top-level', prefix: '', indent: '   ' },
    { name: 'bullet list', prefix: '- 参数：\n\n', indent: '  ' },
    { name: 'ordered list', prefix: '1. 参数：\n\n', indent: '   ' },
    { name: 'nested list', prefix: '- 外层\n  - 参数：\n\n', indent: '    ' }
  ]) {
    test(`${name}: creates a widget and retains cell positions and indentation`, () => {
      const doc = prefix + [
        '| 参数 | 含义 | 取值范围 |',
        '| :--- | :---: | ---: |',
        '| `ladder_levels` | 各槽离买一的档数 | 3–15 |'
      ].map(line => indent + line).join('\n');
      const state = tableState(doc);
      const widgets: any[] = [];
      const infos: ReturnType<typeof parseTableInfo>[] = [];
      resolvedSyntaxTree(state).iterate({
        enter(node) {
          if (node.name !== 'Table') return;
          infos.push(parseTableInfo(state, node));
          addTableDecorations(widgets, state, node);
        }
      });

      expect(infos).toHaveLength(1);
      expect(widgets).toHaveLength(1);
      const info = infos[0];
      expect(info.headerRow?.cells.map(cell => cell.content)).toEqual(['参数', '含义', '取值范围']);
      expect(info.delimiterRow?.alignments).toEqual(['left', 'center', 'right']);
      expect(info.rows).toHaveLength(1);
      for (const cell of info.rows[0].cells) {
        expect(state.doc.sliceString(cell.from, cell.to)).toBe(cell.content);
      }
      expect(state.doc.sliceString(widgets[0].from, widgets[0].to)).toBe(doc.slice(prefix.length));
      expect(widgets[0].value.spec.widget.tableData.indent).toBe(indent);
      expect(liveTableWidgets(doc)).toHaveLength(1);
      expect(state.field(sourceTableHeaderLineField).size).toBeGreaterThan(0);
      expect(getLiveRenderedBlocks(state).filter(block => block.kind === 'table')).toEqual([{
        kind: 'table',
        startLine: info.startLine,
        endLine: info.endLine,
        delimiterLine: info.startLine + 1,
        lineNumberHiddenFrom: info.startLine,
        lineNumberHiddenTo: info.endLine
      }]);
    });
  }

  test('recognizes separators with and without outer pipes', () => {
    for (const indent of ['', ' ', '  ', '    ', '\t']) {
      for (const separator of ['| --- | --- |', '--- | ---', '| :--- | ---: |', ':--- | :---:']) {
        expect(isTableDelimiterLine(indent + separator)).toBe(true);
      }
    }
    for (const text of ['  | name | value |', '  | --- | invalid |', '  | | |']) {
      expect(isTableDelimiterLine(text)).toBe(false);
    }
  });

  test('does not render table-like text in fenced or indented code blocks', () => {
    const table = '| 参数 | 值 |\n| --- | --- |\n| x | 1 |';
    for (const doc of [
      '```md\n' + table + '\n```',
      table.split('\n').map(line => '    ' + line).join('\n'),
      '- 代码：\n\n  ```md\n' + table.split('\n').map(line => '  ' + line).join('\n') + '\n  ```'
    ]) {
      const state = tableState(doc);
      expect(getLiveRenderedBlocks(state).filter(block => block.kind === 'table')).toEqual([]);
      expect(liveTableWidgets(doc)).toEqual([]);
      expect(state.field(sourceTableHeaderLineField).size).toBe(0);
    }
  });
});
