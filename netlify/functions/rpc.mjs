export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'content-type': 'application/json',
        allow: 'POST',
      },
      body: JSON.stringify({
        error: 'Method Not Allowed',
      }),
    }
  }

  const rpcUrl = process.env.POLYGON_RPC_URL

  if (!rpcUrl) {
    return {
      statusCode: 500,
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        error: 'POLYGON_RPC_URL não configurada no servidor.',
      }),
    }
  }

  try {
    const upstream = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: event.body,
    })

    const text = await upstream.text()

    return {
      statusCode: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'cache-control': 'no-store',
      },
      body: text,
    }
  } catch (error) {
    console.error('Erro no proxy RPC:', error)

    return {
      statusCode: 502,
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Falha ao acessar o RPC da Polygon.',
      }),
    }
  }
}