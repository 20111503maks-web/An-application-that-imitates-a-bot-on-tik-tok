import DOMPurify from 'dompurify'
import { Marked } from 'marked'

const marked = new Marked({ gfm: true, breaks: false })

marked.use({
  renderer: {
    code({ text, lang }) {
      const language = (lang ?? '').split(/\s/)[0]
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<div class="md-code"><div class="md-code-head"><span>${language || 'text'}</span><button class="md-copy" data-copy>Copy</button></div><pre><code class="lang-${language}">${escaped}</code></pre></div>`
    },
    link(token) {
      const text = this.parser.parseInline(token.tokens)
      return `<a href="${token.href}" target="_blank" rel="noreferrer">${text}</a>`
    }
  }
})

const cache = new Map<string, string>()

/** Markdown → sanitized HTML. Claude output is never trusted as raw HTML. */
export function renderMarkdown(src: string): string {
  const hit = cache.get(src)
  if (hit) return hit
  const html = DOMPurify.sanitize(marked.parse(src, { async: false }) as string, {
    ADD_ATTR: ['target', 'data-copy'],
    FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'img']
  })
  if (cache.size > 400) cache.clear()
  cache.set(src, html)
  return html
}
