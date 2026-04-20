import { handleRpcProxy } from './_rpc-proxy'

export async function handler(event) {
  const rpcUrl = String(process.env.POLYGON_RPC_URL_PRIMARY || '').trim()
  return handleRpcProxy(event, rpcUrl, 'primary')
}

  if (!rpcUrl) {
    return {
      statusCode: 500,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        pragma: 'no-cache',
        expires: '0',
        'netlify-cdn-cache-control': 'no-store',
      },
      body: JSON.stringify({
        error: 'POLYGON_RPC_URL não configurada no servidor.',
      }),
    }
  }

  let payload

  try {
    payload = JSON.parse(event.body || '{}')
  } catch (error) {
    return {
      statusCode: 400,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        pragma: 'no-cache',
        expires: '0',
        'netlify-cdn-cache-control': 'no-store',
      },
      body: JSON.stringify({
        error: 'Body JSON-RPC inválido.',
      }),
    }
  }

  const method = String(payload?.method || '')

  if (
    ['eth_call', 'eth_getBalance', 'eth_getTransactionCount'].includes(method) &&
    Array.isArray(payload?.params)
  ) {
    if (method === 'eth_call' && payload.params.length >= 2) {
      payload.params[1] = 'latest'
    }

    if (
      ['eth_getBalance', 'eth_getTransactionCount'].includes(method) &&
      payload.params.length >= 2
    ) {
      payload.params[1] = 'latest'
    }
  }

  try {
    const upstream = await fetch(rpcUrl, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        pragma: 'no-cache',
        'x-rpc-cache-bust': `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify(payload),
    })

    const text = await upstream.text()

    console.log('[RPC PROXY]', {
      method,
      status: upstream.status,
      rpcUrlMasked: rpcUrl.replace(/([?&](?:api[-_]?key|key)=)[^&]+/i, '$1***'),
      responsePreview: text.slice(0, 300),
    })

    return {
      statusCode: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        pragma: 'no-cache',
        expires: '0',
        'netlify-cdn-cache-control': 'no-store',
      },
      body: text,
    }
  } catch (error) {
    console.error('Erro no proxy RPC:', error)

    return {
      statusCode: 502,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        pragma: 'no-cache',
        expires: '0',
        'netlify-cdn-cache-control': 'no-store',
      },
      body: JSON.stringify({
        error: 'Falha ao acessar o RPC da Polygon.',
      }),
    }
  }
