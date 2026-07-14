import { describe, expect, it } from 'vitest'
import { normalizeEduAssetUrl } from './edu-asset-url.js'

describe('normalizeEduAssetUrl', () => {
  it('canonicalizes production upload assets to www.yiqibyte.com/edu-prod', () => {
    expect(
      normalizeEduAssetUrl('https://spark.yiqibyte.com/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png'),
    ).toBe('https://www.yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png')
    expect(
      normalizeEduAssetUrl('https://www.yiqibyte.com/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png'),
    ).toBe('https://www.yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png')
    expect(
      normalizeEduAssetUrl('https://yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png'),
    ).toBe('https://www.yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png')
  })

  it('keeps already-canonical production URLs unchanged', () => {
    expect(
      normalizeEduAssetUrl('https://www.yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png'),
    ).toBe('https://www.yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png')
  })

  it('keeps non-upload URLs unchanged', () => {
    expect(normalizeEduAssetUrl('https://spark.yiqibyte.com/upload')).toBe('https://spark.yiqibyte.com/upload')
    expect(normalizeEduAssetUrl('https://example.com/uploads/raw/a.png')).toBe('https://example.com/uploads/raw/a.png')
  })

  it('canonicalizes root-relative upload paths', () => {
    expect(normalizeEduAssetUrl('/uploads/raw/a.png')).toBe(
      'https://www.yiqibyte.com/edu-prod/uploads/raw/a.png',
    )
    expect(normalizeEduAssetUrl('/edu-prod/uploads/raw/a.png')).toBe(
      'https://www.yiqibyte.com/edu-prod/uploads/raw/a.png',
    )
  })
})
