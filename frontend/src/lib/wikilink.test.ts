import { describe, it, expect } from 'vitest'
import { matchWikilink, renderWikilink } from './wikilink'

describe('matchWikilink', () => {
  it('matches a simple [[Title]] at pos', () => {
    expect(matchWikilink('[[Note Name]]', 0)).toEqual({
      title: 'Note Name',
      end: 13,
    })
  })

  it('matches at a non-zero position and reports end past ]]', () => {
    const src = 'see [[Foo]] here'
    const m = matchWikilink(src, 4)
    expect(m).toEqual({ title: 'Foo', end: 11 })
    expect(src.slice(m!.end)).toBe(' here')
  })

  it('returns null when not a [[ at pos', () => {
    expect(matchWikilink('x[[Foo]]', 0)).toBeNull()
    expect(matchWikilink('[Foo]', 0)).toBeNull()
  })

  it('returns null with no closing ]]', () => {
    expect(matchWikilink('[[unclosed', 0)).toBeNull()
  })

  it('rejects an empty title', () => {
    expect(matchWikilink('[[]]', 0)).toBeNull()
  })

  it('rejects a title containing [ or newline (avoids swallowing text)', () => {
    expect(matchWikilink('[[a[b]]', 0)).toBeNull()
    expect(matchWikilink('[[a\nb]]', 0)).toBeNull()
  })

  it('stops at the first ]] (shortest match)', () => {
    expect(matchWikilink('[[A]] and [[B]]', 0)).toEqual({ title: 'A', end: 5 })
  })
})

describe('renderWikilink', () => {
  it('wraps the title in a data-wikilink anchor', () => {
    expect(renderWikilink('Foo')).toBe(
      '<a data-wikilink="Foo" href="#">Foo</a>',
    )
  })

  it('escapes HTML-significant characters in the title', () => {
    expect(renderWikilink('A & B <c> "d"')).toBe(
      '<a data-wikilink="A &amp; B &lt;c&gt; &quot;d&quot;" href="#">A &amp; B &lt;c&gt; &quot;d&quot;</a>',
    )
  })
})
