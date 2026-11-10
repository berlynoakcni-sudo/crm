import { beforeEach, describe, expect, it, vi } from 'vitest'

let callerRole = 'admin'
let signedIn = true

const configUpdates: Record<string, unknown>[] = []
let storedConfig: {
  id: string
  phone_number_id: string
  waba_id: string | null
  access_token: string
  registered_at: string | null
  last_registration_error: string | null
  status: string
} | null = {
  id: 'cfg-1',
  phone_number_id: '1234567890',
  waba_id: '987654321',
  access_token: 'enc-token',
  registered_at: null,
  last_registration_error: null,
  status: 'disconnected',
}

function makeSupabaseMock() {
  function builder(table: string) {
    const result = () => {
      switch (table) {
        case 'profiles':
          return {
            data: { account_id: 'acct-1', account_role: callerRole },
            error: null,
          }
        case 'accounts':
          return { data: { id: 'acct-1', name: 'Acme' }, error: null }
        case 'whatsapp_config':
          return { data: storedConfig, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'neq']) b[m] = vi.fn(chain)
    b.update = vi.fn((patch: Record<string, unknown>) => {
      if (table === 'whatsapp_config') configUpdates.push(patch)
      return b
    })
    b.single = vi.fn(async () => result())
    b.maybeSingle = vi.fn(async () => result())
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null })
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () =>
        signedIn
          ? { data: { user: { id: 'user-1' } }, error: null }
          : { data: { user: null }, error: { message: 'no session' } },
      ),
    },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((t: string) => (t === 'enc-token' ? 'decrypted-token' : 'corrupted')),
  encrypt: vi.fn(() => 'enc-token'),
}))

const registerMock = vi.fn()
vi.mock('@/lib/whatsapp/meta-api', () => ({
  registerPhoneNumber: (args: unknown) => registerMock(args),
}))

import { POST } from './route'

describe('POST /api/whatsapp/config/register', () => {
  beforeEach(() => {
    callerRole = 'admin'
    signedIn = true
    configUpdates.length = 0
    registerMock.mockReset()
    storedConfig = {
      id: 'cfg-1',
      phone_number_id: '1234567890',
      waba_id: '987654321',
      access_token: 'enc-token',
      registered_at: null,
      last_registration_error: null,
      status: 'disconnected',
    }
  })

  it('rejects unauthenticated requests', async () => {
    signedIn = false
    const req = new Request('http://localhost/api/whatsapp/config/register', {
      method: 'POST',
      body: JSON.stringify({ pin: '123456' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('rejects non-admin roles', async () => {
    callerRole = 'agent'
    const req = new Request('http://localhost/api/whatsapp/config/register', {
      method: 'POST',
      body: JSON.stringify({ pin: '123456' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('rejects invalid PIN formats (non-6 digits)', async () => {
    const invalidPins = ['12345', '1234567', 'abcdef', '', null]
    for (const pin of invalidPins) {
      const req = new Request('http://localhost/api/whatsapp/config/register', {
        method: 'POST',
        body: JSON.stringify({ pin }),
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
    }
  })

  it('successfully registers phone number with 6-digit PIN and updates database', async () => {
    registerMock.mockResolvedValueOnce({ success: true, alreadyRegistered: false })

    const req = new Request('http://localhost/api/whatsapp/config/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '654321' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.registered).toBe(true)
    expect(typeof data.registered_at).toBe('string')

    // Verifies meta-api was called with correct decrypted credentials and pin
    expect(registerMock).toHaveBeenCalledWith({
      phoneNumberId: '1234567890',
      accessToken: 'decrypted-token',
      pin: '654321',
    })

    // Verifies database was updated with registered_at and connected status
    expect(configUpdates.length).toBe(1)
    expect(configUpdates[0].registered_at).toBeTruthy()
    expect(configUpdates[0].last_registration_error).toBeNull()
    expect(configUpdates[0].status).toBe('connected')
  })

  it('handles already registered numbers cleanly', async () => {
    registerMock.mockResolvedValueOnce({ success: true, alreadyRegistered: true })

    const req = new Request('http://localhost/api/whatsapp/config/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '654321' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.already_registered).toBe(true)
  })

  it('handles Meta API errors (e.g. wrong PIN) and persists error message to DB', async () => {
    const metaError = new Error('The two-step verification PIN is wrong.')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(metaError as any).code = 133005
    registerMock.mockRejectedValueOnce(metaError)

    const req = new Request('http://localhost/api/whatsapp/config/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '000000' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)

    const data = await res.json()
    expect(data.error).toMatch(/two-step verification PIN is wrong/i)

    // Verifies error was recorded in the database
    expect(configUpdates.length).toBe(1)
    expect(configUpdates[0].last_registration_error).toMatch(/two-step verification PIN is wrong/i)
  })
})
