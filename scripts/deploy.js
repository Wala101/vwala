import { network } from "hardhat";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

async function main() {
  console.log("🔄 Iniciando deploy...");

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY não encontrada no .env");
  }

  const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("🚀 Deployando com a conta:", wallet.address);

  const { ethers: hardhatEthers } = await network.connect();

  const vWalaTokenAddress = "0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83";

  const VWalaPredictions = await hardhatEthers.getContractFactory(
    "VWalaUserPredictions",
    wallet
  );

  console.log("📦 Deployando contrato...");

  const contract = await VWalaPredictions.deploy(
    vWalaTokenAddress,
    wallet.address
  );

  await contract.waitForDeployment();

  console.log("✅ Deploy concluído com sucesso!");
  console.log("Endereço do contrato:", await contract.getAddress());
}

main().catch((error) => {
  console.error("❌ Erro durante o deploy:", error);
  process.exit(1);
});