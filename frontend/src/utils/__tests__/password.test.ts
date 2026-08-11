import { describe, expect, it } from 'vitest'
import { getApiErrorMessage, validatePassword } from '../password'

describe('validatePassword', () => {
  it('accepts passwords with at least six Unicode characters', async () => {
    await expect(validatePassword('密码测试甲乙')).resolves.toBeUndefined()
  })

  it('rejects emoji passwords with fewer than six Unicode characters', async () => {
    await expect(validatePassword('😀😀😀')).rejects.toThrow('密码至少需要 6 个字符')
  })

  it('rejects passwords whose UTF-8 encoding exceeds 72 bytes', async () => {
    await expect(validatePassword('密'.repeat(25))).rejects.toThrow('不能超过 72 字节')
  })
})

describe('getApiErrorMessage', () => {
  it('extracts the first Pydantic validation message', () => {
    const error = {
      response: {
        data: {
          detail: [{ msg: 'Value error, 密码至少需要6个字符' }],
        },
      },
    }

    expect(getApiErrorMessage(error, '请求失败')).toBe('密码至少需要6个字符')
  })
})
