import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { registerPhoneNumber } from '@/lib/whatsapp/meta-api'
import {
  explainMetaError,
  metaErrorPayload,
  type MetaErrorContext,
} from '@/lib/whatsapp/meta-error-explain'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * POST /api/whatsapp/config/register
 *
 * Official WhatsApp Cloud API phone number registration endpoint:
 *   POST https://graph.facebook.com/{API_VERSION}/{PHONE_NUMBER_ID}/register
 * Body:
 *   { "messaging_product": "whatsapp", "pin": "USER_PROVIDED_6_DIGIT_PIN" }
 *
 * Uses the stored encrypted access token and phone number ID, applies
 * the user-provided 6-digit PIN, updates registration status on success,
 * and records any Meta error for remediation.
 */
export async function POST(request: Request) {
  let supabase, accountId, userId
  try {
    const auth = await requireRole('admin')
    supabase = auth.supabase
    accountId = auth.accountId
    userId = auth.userId
  } catch (err) {
    return toErrorResponse(err)
  }

  try {
    const limit = checkRateLimit(`whatsapp-admin:${userId}`, RATE_LIMITS.whatsappAdmin)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => ({}))
    const { pin } = body

    if (!pin || typeof pin !== 'string' || !/^\d{6}$/.test(pin.trim())) {
      return NextResponse.json(
        { error: t('whatsappConfig.pinDigits') || 'Please enter a valid 6-digit numeric PIN.' },
        { status: 400 }
      )
    }

    const cleanPin = pin.trim()

    // Retrieve existing configuration for the account
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('id, phone_number_id, waba_id, access_token, registered_at')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      console.error('Error fetching whatsapp_config for registration:', configError)
      return NextResponse.json(
        { error: t('whatsappConfig.fetchFailed') || 'Failed to fetch WhatsApp configuration.' },
        { status: 500 }
      )
    }

    if (!config || !config.phone_number_id || !config.access_token) {
      return NextResponse.json(
        { error: t('whatsappConfig.credentialsRequired') || 'WhatsApp Phone Number ID and Access Token must be saved first.' },
        { status: 400 }
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('Failed to decrypt access token for registration:', err)
      return NextResponse.json(
        { error: t('whatsappConfig.tokenUndecryptable') || 'Access token could not be decrypted. Please re-enter your access token.' },
        { status: 400 }
      )
    }

    const metaCtx: MetaErrorContext = {
      phoneNumberId: config.phone_number_id,
      wabaId: config.waba_id ?? null,
    }

    try {
      const result = await registerPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
        pin: cleanPin,
      })

      const now = new Date().toISOString()
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update({
          registered_at: now,
          last_registration_error: null,
          status: 'connected',
          updated_at: now,
        })
        .eq('account_id', accountId)

      if (updateError) {
        console.error('Error updating registered_at in database:', updateError)
        return NextResponse.json(
          { error: t('whatsappConfig.updateFailed') || 'Failed to save registration status.' },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        registered: true,
        registered_at: now,
        already_registered: result.alreadyRegistered,
      })
    } catch (err) {
      const explained = explainMetaError(err, 'register', metaCtx)
      console.error('[whatsapp/config/register] Registration failed:', explained.metaMessage, {
        code: explained.code,
        subcode: explained.subcode,
        fbtrace_id: explained.fbtraceId,
      })

      // Persist the registration error so the UI diagnostic displays the exact reason
      await supabase
        .from('whatsapp_config')
        .update({
          last_registration_error: explained.summary,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', accountId)

      return NextResponse.json(
        {
          error: explained.summary,
          meta: metaErrorPayload(explained),
        },
        { status: explained.httpStatus }
      )
    }
  } catch (error) {
    console.error('Unhandled error in WhatsApp config register:', error)
    return NextResponse.json(
      { error: t('common.internalServerError') || 'An internal error occurred.' },
      { status: 500 }
    )
  }
}
