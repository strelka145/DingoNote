import { describe, it, expect } from 'vitest'
import {
  decimalsMask,
  maskToDecimals,
  columnHasText,
  defaultColumnName,
  isDefaultColumnName,
  parseGridJson,
  escapeAttr,
  buildSheetJson,
  DEFAULT_GRID,
} from './spreadsheet-model'

describe('decimalsMask', () => {
  it('0 places -> "0"', () => expect(decimalsMask(0)).toBe('0'))
  it('n places -> "0.00…"', () => {
    expect(decimalsMask(1)).toBe('0.0')
    expect(decimalsMask(3)).toBe('0.000')
  })
  it('clamps negatives to "0"', () => expect(decimalsMask(-2)).toBe('0'))
})

describe('maskToDecimals', () => {
  it('reads our decimal masks back', () => {
    expect(maskToDecimals('0')).toBe(0)
    expect(maskToDecimals('0.0')).toBe(1)
    expect(maskToDecimals('0.0000')).toBe(4)
  })
  it('returns null for anything else', () => {
    expect(maskToDecimals(undefined)).toBeNull()
    expect(maskToDecimals('')).toBeNull()
    expect(maskToDecimals('#,##0.0')).toBeNull()
    expect(maskToDecimals('0.')).toBeNull()
  })
  it('round-trips with decimalsMask', () => {
    for (const n of [0, 1, 2, 5]) {
      expect(maskToDecimals(decimalsMask(n))).toBe(n)
    }
  })
})

describe('columnHasText', () => {
  const grid = [
    ['1.5', 'memo', '=A1'],
    ['2', '', ''],
    ['', 'note', '10'],
  ]
  it('numeric column -> false', () => expect(columnHasText(grid, 0)).toBe(false))
  it('text column -> true', () => expect(columnHasText(grid, 1)).toBe(true))
  it('formula + number column -> false', () =>
    expect(columnHasText(grid, 2)).toBe(false))
  it('empty column -> false (nothing to garble)', () =>
    expect(columnHasText([['', ''], ['', '']], 1)).toBe(false))
})

describe('defaultColumnName', () => {
  it('maps indices to spreadsheet column letters', () => {
    expect(defaultColumnName(0)).toBe('A')
    expect(defaultColumnName(25)).toBe('Z')
    expect(defaultColumnName(26)).toBe('AA')
    expect(defaultColumnName(27)).toBe('AB')
  })
})

describe('isDefaultColumnName', () => {
  it('empty or matching-default header is "default"', () => {
    expect(isDefaultColumnName('', 0)).toBe(true)
    expect(isDefaultColumnName('A', 0)).toBe(true)
    expect(isDefaultColumnName('B', 1)).toBe(true)
  })
  it('a real header is not default', () => {
    expect(isDefaultColumnName('ID', 0)).toBe(false)
  })
})

describe('parseGridJson', () => {
  it('parses {data, headers, decimals}', () => {
    const s = parseGridJson('{"data":[["a"]],"headers":["H"],"decimals":[1]}')
    expect(s.data).toEqual([['a']])
    expect(s.headers).toEqual(['H'])
    expect(s.decimals).toEqual([1])
  })
  it('accepts a bare data array', () => {
    const s = parseGridJson('[["x","y"]]')
    expect(s.data).toEqual([['x', 'y']])
    expect(s.headers).toEqual([])
    expect(s.decimals).toEqual([])
  })
  it('falls back to the default grid on invalid JSON', () => {
    const s = parseGridJson('not json')
    expect(s.data).toBe(DEFAULT_GRID)
    expect(s.headers).toEqual([])
    expect(s.decimals).toEqual([])
  })
  it('ignores non-array headers/decimals', () => {
    const s = parseGridJson('{"data":[["a"]],"headers":"x","decimals":5}')
    expect(s.headers).toEqual([])
    expect(s.decimals).toEqual([])
  })
})

describe('escapeAttr', () => {
  it('escapes HTML attribute-significant characters', () => {
    expect(escapeAttr('a & b < c > d "e"')).toBe(
      'a &amp; b &lt; c &gt; d &quot;e&quot;',
    )
  })
})

describe('buildSheetJson', () => {
  it('emits only data when headers/decimals are empty', () => {
    const out = buildSheetJson({ attrs: { data: [['a']], headers: [], decimals: [] } })
    expect(out).toEqual({ data: [['a']] })
  })
  it('includes headers when at least one is non-empty', () => {
    const out = buildSheetJson({
      attrs: { data: [['a']], headers: ['', 'H'], decimals: [] },
    })
    expect(out).toEqual({ data: [['a']], headers: ['', 'H'] })
  })
  it('includes decimals when at least one is set', () => {
    const out = buildSheetJson({
      attrs: { data: [['a']], headers: [], decimals: [null, 2] },
    })
    expect(out).toEqual({ data: [['a']], decimals: [null, 2] })
  })
  it('defaults data to DEFAULT_GRID when missing', () => {
    const out = buildSheetJson({ attrs: {} })
    expect(out.data).toBe(DEFAULT_GRID)
  })
})
