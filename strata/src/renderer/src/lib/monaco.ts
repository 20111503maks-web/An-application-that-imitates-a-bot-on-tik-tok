// Monaco is bundled locally (no CDN) and loaded lazily the first time an editor opens.
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

loader.config({ monaco })

// Luau syntax is a superset of Lua; add the extra keywords so Roblox scripts highlight well.
monaco.languages.register({ id: 'luau', extensions: ['.luau'], aliases: ['Luau'] })
monaco.languages.setMonarchTokensProvider('luau', {
  defaultToken: '',
  tokenPostfix: '.lua',
  keywords: [
    'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or',
    'repeat', 'return', 'then', 'true', 'until', 'while', 'continue', 'type', 'export', 'typeof'
  ],
  builtins: ['game', 'workspace', 'script', 'Instance', 'Vector3', 'Vector2', 'CFrame', 'Color3', 'UDim2', 'UDim', 'Enum', 'task', 'require', 'print', 'warn', 'error', 'pcall', 'xpcall', 'tick', 'wait', 'spawn', 'delay', 'typeof', 'math', 'string', 'table', 'coroutine', 'TweenInfo', 'BrickColor', 'Ray', 'RaycastParams', 'NumberSequence', 'ColorSequence', 'NumberRange', 'self'],
  brackets: [
    { token: 'delimiter.bracket', open: '{', close: '}' },
    { token: 'delimiter.array', open: '[', close: ']' },
    { token: 'delimiter.parenthesis', open: '(', close: ')' }
  ],
  operators: ['+', '-', '*', '/', '%', '^', '#', '==', '~=', '<=', '>=', '<', '>', '=', ';', ':', ',', '.', '..', '...', '+=', '-=', '*=', '/=', '..=', '->', '::'],
  symbols: /[=><!~?:&|+\-*/^%.#]+/,
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  tokenizer: {
    root: [
      [/[a-zA-Z_]\w*/, { cases: { '@keywords': { token: 'keyword.$0' }, '@builtins': 'type.identifier', '@default': 'identifier' } }],
      { include: '@whitespace' },
      [/(,)(\s*)([a-zA-Z_]\w*)(\s*)(:)(?!:)/, ['delimiter', '', 'key', '', 'delimiter']],
      [/({)(\s*)([a-zA-Z_]\w*)(\s*)(:)(?!:)/, ['@brackets', '', 'key', '', 'delimiter']],
      [/[{}()[\]]/, '@brackets'],
      [/@symbols/, { cases: { '@operators': 'delimiter', '@default': '' } }],
      [/\d*\.\d+([eE][-+]?\d+)?/, 'number.float'],
      [/0[xX][0-9a-fA-F_]*[0-9a-fA-F]/, 'number.hex'],
      [/0[bB][01_]+/, 'number'],
      [/\d[\d_]*/, 'number'],
      [/[;,.]/, 'delimiter'],
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/'([^'\\]|\\.)*$/, 'string.invalid'],
      [/"/, 'string', '@string."'],
      [/'/, 'string', "@string.'"],
      [/`/, 'string', '@string.`']
    ],
    whitespace: [
      [/[ \t\r\n]+/, ''],
      [/--\[([=]*)\[/, 'comment', '@comment.$1'],
      [/--.*$/, 'comment']
    ],
    comment: [
      [/[^\]]+/, 'comment'],
      [/\]([=]*)\]/, { cases: { '$1==$S2': { token: 'comment', next: '@pop' }, '@default': 'comment' } }],
      [/./, 'comment']
    ],
    string: [
      [/[^\\"'`]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/["'`]/, { cases: { '$#==$S2': { token: 'string', next: '@pop' }, '@default': 'string' } }]
    ]
  }
} as monaco.languages.IMonarchLanguage)
monaco.languages.setLanguageConfiguration('luau', {
  comments: { lineComment: '--', blockComment: ['--[[', ']]'] },
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" }
  ],
  indentationRules: {
    increaseIndentPattern: /^\s*((\b(else|function|then|do|repeat)\b((?!\b(end|until)\b).)*)|(\{\s*))$/,
    decreaseIndentPattern: /^\s*((\b(elseif|else|end|until)\b)|(\})|(\)))/
  }
})

// Editor validation for plain JS/TS files outside a configured project is mostly noise.
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
monaco.languages.typescript.typescriptDefaults.setCompilerOptions({ jsx: monaco.languages.typescript.JsxEmit.Preserve, allowJs: true, target: monaco.languages.typescript.ScriptTarget.ESNext, allowNonTsExtensions: true })

const dark: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b6e78', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c79bff' },
    { token: 'string', foreground: '9fd88a' },
    { token: 'number', foreground: 'f2a971' },
    { token: 'type.identifier', foreground: '6ec7ff' },
    { token: 'key', foreground: '82b1ff' },
    { token: 'delimiter', foreground: '9a9ca6' }
  ],
  colors: {
    'editor.background': '#0f1013',
    'editor.foreground': '#dcdde3',
    'editorLineNumber.foreground': '#3b3d45',
    'editorLineNumber.activeForeground': '#9a9ca6',
    'editor.lineHighlightBackground': '#16171c',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#2a4a7a88',
    'editor.inactiveSelectionBackground': '#2a4a7a44',
    'editorIndentGuide.background1': '#1d1e24',
    'editorIndentGuide.activeBackground1': '#34363f',
    'editorCursor.foreground': '#d97757',
    'editorWidget.background': '#16171b',
    'editorWidget.border': '#2a2b32',
    'editorSuggestWidget.background': '#16171b',
    'editorSuggestWidget.border': '#2a2b32',
    'editorSuggestWidget.selectedBackground': '#24252c',
    'editorHoverWidget.background': '#16171b',
    'editorHoverWidget.border': '#2a2b32',
    'scrollbarSlider.background': '#ffffff12',
    'scrollbarSlider.hoverBackground': '#ffffff20',
    'scrollbarSlider.activeBackground': '#ffffff2a',
    'scrollbar.shadow': '#00000000',
    'diffEditor.insertedTextBackground': '#3ecf8e22',
    'diffEditor.removedTextBackground': '#f0616d22',
    'diffEditor.insertedLineBackground': '#3ecf8e14',
    'diffEditor.removedLineBackground': '#f0616d14',
    'diffEditorGutter.insertedLineBackground': '#3ecf8e26',
    'diffEditorGutter.removedLineBackground': '#f0616d26',
    'diffEditor.diagonalFill': '#ffffff08',
    'editorGutter.background': '#0f1013',
    'minimap.background': '#0f1013',
    'editorOverviewRuler.border': '#00000000',
    focusBorder: '#00000000'
  }
}

monaco.editor.defineTheme('strata-dark', dark)
monaco.editor.defineTheme('strata-midnight', {
  ...dark,
  colors: { ...dark.colors, 'editor.background': '#08090c', 'editorGutter.background': '#08090c', 'minimap.background': '#08090c', 'editor.lineHighlightBackground': '#0f1014' }
})
monaco.editor.defineTheme('strata-light', {
  base: 'vs',
  inherit: true,
  rules: [{ token: 'comment', foreground: '8a8d96', fontStyle: 'italic' }],
  colors: {
    'editor.background': '#ffffff',
    'editor.lineHighlightBackground': '#f5f5f8',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#c4c5cc',
    'editorCursor.foreground': '#d97757',
    'diffEditor.insertedLineBackground': '#1a9f6214',
    'diffEditor.removedLineBackground': '#d63a4914',
    focusBorder: '#00000000'
  }
})

export { monaco }
