import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("VWalaFixedSwapModule", (m) => {
  const treasuryAddress = "0xb8ef27e1AD32335e5e442f00fd01f7f002D2bCAa";

  const fixedSwap = m.contract("VWalaFixedSwap", [treasuryAddress]);

  return { fixedSwap };
});