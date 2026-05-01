import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("VWalaFixedSellModule", (m) => {
  const tokenSinkAddress = "0xFc9fAE4e63810E50f3Ddc6Fc938568f3a2D63c35";

  const fixedSell = m.contract("VWalaFixedSell", [tokenSinkAddress]);

  return { fixedSell };
});