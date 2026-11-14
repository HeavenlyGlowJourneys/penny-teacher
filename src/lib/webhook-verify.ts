// Verifies webhooks signed per the Standard Webhooks spec (https://www.standardwebhooks.com/).
// Both Supabase's native Auth Hooks and Resend's webhook delivery use this scheme
// (both are built on Svix), so this one helper covers both.

const TOLERANCE_SECONDS = 5 * 60

export class WebhookVerificationError extends Error {}

function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

function bytesToBase64(buffer: ArrayBuffer): string {
  let bin = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

/**
 * Verifies a Standard Webhooks-signed request and returns the parsed JSON body.
 * `secret` is the raw secret as issued by the provider (e.g. "whsec_XXXX",
 * optionally prefixed with a version like "v1,whsec_XXXX").
 */
export async function verifyStandardWebhook(request: Request, secret: string): Promise<any> {
  const id = request.headers.get('webhook-id')
  const timestamp = request.headers.get('webhook-timestamp')
  const signatureHeader = request.headers.get('webhook-signature')

  if (!id || !timestamp || !signatureHeader) {
    throw new WebhookVerificationError('Missing webhook headers')
  }

  const timestampNum = Number(timestamp)
  if (!Number.isFinite(timestampNum)) {
    throw new WebhookVerificationError('Invalid webhook timestamp')
  }
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - timestampNum) > TOLERANCE_SECONDS) {
    throw new WebhookVerificationError('Webhook timestamp outside tolerance')
  }

  const body = await request.text()
  const signedContent = `${id}.${timestamp}.${body}`

  const rawSecret = secret.includes(',') ? secret.split(',').pop()! : secret
  const secretBytes = base64ToBytes(rawSecret.replace(/^whsec_/, ''))

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent))
  const expectedSignature = bytesToBase64(signatureBuffer)

  // webhook-signature can contain multiple space-separated "v1,<sig>" values
  // (e.g. during secret rotation) -- match against any of them.
  const providedSignatures = signatureHeader
    .split(' ')
    .map((s) => s.split(',')[1])
    .filter((s): s is string => Boolean(s))

  const matches = providedSignatures.some((sig) => timingSafeEqual(sig, expectedSignature))
  if (!matches) {
    throw new WebhookVerificationError('Signature mismatch')
  }

  try {
    return JSON.parse(body)
  } catch {
    throw new WebhookVerificationError('Invalid JSON payload')
  }
}
