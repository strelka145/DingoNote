import { describe, it, expect } from 'vitest'
import { highlight } from './highlight'

describe('highlight', () => {
  it('empty query -> single unmarked run', () => {
    expect(highlight('hello', '')).toEqual([{ s: 'hello', m: false }])
  })

  it('empty text -> single unmarked run', () => {
    expect(highlight('', 'x')).toEqual([{ s: '', m: false }])
  })

  it('marks a single match, splitting the surrounding text', () => {
    expect(highlight('the brown fox', 'brown')).toEqual([
      { s: 'the ', m: false },
      { s: 'brown', m: true },
      { s: ' fox', m: false },
    ])
  })

  it('marks every occurrence', () => {
    expect(highlight('a-a-a', 'a')).toEqual([
      { s: 'a', m: true },
      { s: '-', m: false },
      { s: 'a', m: true },
      { s: '-', m: false },
      { s: 'a', m: true },
    ])
  })

  it('is case-insensitive but preserves original casing in output', () => {
    expect(highlight('Brown BROWN', 'brown')).toEqual([
      { s: 'Brown', m: true },
      { s: ' ', m: false },
      { s: 'BROWN', m: true },
    ])
  })

  it('no match -> single unmarked run', () => {
    expect(highlight('hello', 'zzz')).toEqual([{ s: 'hello', m: false }])
  })

  it('match at the very start and end', () => {
    expect(highlight('abc', 'abc')).toEqual([{ s: 'abc', m: true }])
  })
})
