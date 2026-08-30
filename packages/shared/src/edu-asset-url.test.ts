import { describe, expect, it } from 'vitest'
import { isEduUploadAssetUrl, normalizeEduAssetUrl } from './edu-asset-url.js'

describe('normalizeEduAssetUrl', () => {
  it('canonicalizes production upload assets to www.yiqibyte.com/edu-prod', () => {
    expect(
      normalizeEduAssetUrl(
        'https://spark.yiqibyte.com/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png',
      ),
    ).toBe('https://www.yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png')
    expect(
      normalizeEduAssetUrl(
        'https://www.yiqibyte.com/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png',
      ),
    ).toBe('https://www.yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png')
    expect(
      normalizeEduAssetUrl(
        'https://yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png',
      ),
    ).toBe('https://www.yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png')
  })

  it('keeps already-canonical production URLs unchanged', () => {
    expect(
      normalizeEduAssetUrl(
        'https://www.yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png',
      ),
    ).toBe('https://www.yiqibyte.com/edu-prod/uploads/raw/6768ff07-d673-4fe8-8089-a992350a39c0.png')
  })

  it('keeps tmp-bucket URLs unchanged (never rewritten to edu-prod)', () => {
    expect(normalizeEduAssetUrl('https://www.yiqibyte.com/edu-tmp/uploads/raw/a.png')).toBe(
      'https://www.yiqibyte.com/edu-tmp/uploads/raw/a.png',
    )
    expect(normalizeEduAssetUrl('https://spark.yiqibyte.com/edugen-tmp/uploads/raw/a.png')).toBe(
      'https://spark.yiqibyte.com/edugen-tmp/uploads/raw/a.png',
    )
  })

  it('keeps non-upload URLs unchanged', () => {
    expect(normalizeEduAssetUrl('https://spark.yiqibyte.com/upload')).toBe(
      'https://spark.yiqibyte.com/upload',
    )
    expect(normalizeEduAssetUrl('https://example.com/uploads/raw/a.png')).toBe(
      'https://example.com/uploads/raw/a.png',
    )
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

describe('isEduUploadAssetUrl', () => {
  it('matches permanent main-bucket upload URLs', () => {
    expect(isEduUploadAssetUrl('https://www.yiqibyte.com/edu-prod/uploads/raw/a.png')).toBe(true)
    // 缺 /edu-prod 前缀的形态先被 normalize 规范化，同样命中
    expect(isEduUploadAssetUrl('https://spark.yiqibyte.com/uploads/raw/a.png')).toBe(true)
    expect(isEduUploadAssetUrl('/edu-prod/uploads/raw/a.png')).toBe(true)
  })

  it('matches tmp-bucket (?tmp=1) upload URLs', () => {
    expect(isEduUploadAssetUrl('https://www.yiqibyte.com/edu-tmp/uploads/raw/a.png')).toBe(true)
    expect(isEduUploadAssetUrl('https://spark.yiqibyte.com/edugen-tmp/uploads/raw/a.mp4')).toBe(
      true,
    )
  })

  it('rejects non-upload and foreign URLs', () => {
    expect(isEduUploadAssetUrl('https://example.com/edu-tmp/uploads/raw/a.png')).toBe(false)
    expect(isEduUploadAssetUrl('https://www.yiqibyte.com/other/path/a.png')).toBe(false)
    expect(isEduUploadAssetUrl('https://example.com/uploads/raw/a.png')).toBe(false)
    expect(isEduUploadAssetUrl('')).toBe(false)
    expect(isEduUploadAssetUrl(null)).toBe(false)
  })
})
