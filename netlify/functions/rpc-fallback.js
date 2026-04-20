import { handleRpcProxy } from './_rpc-proxy.mjs'

export async function handler(event) {
  const rpcUrl = String(process.env.POLYGON_RPC_URL_FALLBACK || '').trim()
  return handleRpcProxy(event, rpcUrl, 'fallback')
}