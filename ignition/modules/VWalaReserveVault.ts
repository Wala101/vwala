import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("VWalaReserveVaultModule", (m) => {
  const reserveVault = m.contract("VWalaReserveVault");

  return { reserveVault };
});