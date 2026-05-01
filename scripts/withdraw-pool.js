// netlify/functions/pool-swap.js
import { ethers } from "ethers";

export default async function handler(req) {
  if (req.method !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { mode, amount, userId } = JSON.parse(req.body || "{}");

    if (!mode || !amount) {
      return { statusCode: 400, body: JSON.stringify({ error: "Faltam dados" }) };
    }

    // Verifica se a chave existe
    if (!process.env.DEPLOYER_PRIVATE_KEY) {
      console.error("DEPLOYER_PRIVATE_KEY não encontrada!");
      return { statusCode: 500, body: JSON.stringify({ error: "Chave não configurada" }) };
    }

    const provider = new ethers.JsonRpcProvider(
      "https://polygon-mainnet.g.alchemy.com/v2/uKHMU0uypmmz1MhWiNsHz"
    );

    const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

    const pool = new ethers.Contract("0x5c950A2FA20A48DDcb4952910e550Ac59fd21AF7", [
      "function buy() payable",
      "function sell(uint256 amount)"
    ], wallet);

    const amountUnits = ethers.parseUnits(String(amount), 18);

    let tx;

    if (mode === "buy") {
      tx = await pool.buy({ value: amountUnits, gasLimit: 600000 });
    } else if (mode === "sell") {
      tx = await pool.sell(amountUnits, { gasLimit: 600000 });
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: "Modo inválido" }) };
    }

    const receipt = await tx.wait();

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: `${mode === "buy" ? "Compra" : "Venda"} realizada com sucesso!`,
        txHash: receipt.hash
      })
    };

  } catch (error) {
    console.error("Erro na function pool-swap:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Erro interno no servidor" })
    };
  }
}