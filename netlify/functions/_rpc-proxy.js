function buildHeaders(contentType = 'application/json') {
  return {
    'content-type': contentType,
    'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    pragma: 'no-cache',
    expires: '0',
    'netlify-cdn-cache-control': 'no-store',
  }
}

function normalizePayload(payload) {
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

  return {
    payload,
    method,
  }
}

export async function handleRpcProxy(event, rpcUrl, proxyName) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        ...buildHeaders(),
        allow: 'POST',
      },
      body: JSON.stringify({
        error: 'Method Not Allowed',
      }),
    }
  }

  if (!rpcUrl) {
    return {
      statusCode: 500,
      headers: buildHeaders(),
      body: JSON.stringify({
        error: `${proxyName} não configurado no servidor.`,
      }),
    }
  }

  let payload

  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return {
      statusCode: 400,
      headers: buildHeaders(),
      body: JSON.stringify({
        error: 'Body JSON-RPC inválido.',
      }),
    }
  }

  const normalized = normalizePayload(payload)
  const safeRpcUrl = rpcUrl.replace(/([?&](?:api[-_]?key|key)=)[^&]+/i, '$1***')

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
        'x-rpc-proxy-name': proxyName,
      },
      body: JSON.stringify(normalized.payload),
    })

    const text = await upstream.text()

    console.log(`[RPC PROXY ${proxyName}]`, {
      method: normalized.method,
      status: upstream.status,
      rpcUrlMasked: safeRpcUrl,
      responsePreview: text.slice(0, 300),
    })

    return {
      statusCode: upstream.status,
      headers: {
        ...buildHeaders(upstream.headers.get('content-type') || 'application/json'),
        'x-rpc-proxy-name': proxyName,
      },
      body: text,
    }
  } catch (error) {
    console.error(`Erro no proxy RPC ${proxyName}:`, error)

    return {
      statusCode: 502,
      headers: {
        ...buildHeaders(),
        'x-rpc-proxy-name': proxyName,
      },
      body: JSON.stringify({
        error: `Falha ao acessar o RPC da Polygon (${proxyName}).`,
      }),
    }
  }
}