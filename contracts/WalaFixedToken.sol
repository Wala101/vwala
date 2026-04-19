// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract WalaFixedToken is ERC20 {
    address public immutable creator;
    address public immutable initialOwner;
    uint256 public immutable initialSupplyWhole;
    string public metadataURI;

    error InvalidOwner();
    error InvalidSupply();

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_,
        uint256 wholeSupply_,
        string memory metadataURI_
    ) ERC20(name_, symbol_) {
        if (owner_ == address(0)) revert InvalidOwner();
        if (wholeSupply_ == 0) revert InvalidSupply();

        creator = msg.sender;
        initialOwner = owner_;
        initialSupplyWhole = wholeSupply_;
        metadataURI = metadataURI_;

        _mint(owner_, wholeSupply_ * (10 ** decimals()));
    }
}