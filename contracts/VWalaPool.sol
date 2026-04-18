// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract VWalaPool is ERC20, ReentrancyGuard {
    error ZeroAmount();
    error InvalidReceiver();
    error InsufficientReserve();
    error NativeTransferFailed();

    event Bought(address indexed buyer, uint256 polIn, uint256 vwalaOut);
    event Sold(address indexed seller, uint256 vwalaIn, uint256 polOut);
    event ReserveFunded(address indexed from, uint256 amount);

    constructor() payable ERC20("vWALA", "vWALA") {
        if (msg.value > 0) {
            emit ReserveFunded(msg.sender, msg.value);
        }
    }

    receive() external payable {
        emit ReserveFunded(msg.sender, msg.value);
    }

    function buy() external payable nonReentrant {
        uint256 amount = msg.value;
        if (amount == 0) revert ZeroAmount();

        _mint(msg.sender, amount);

        emit Bought(msg.sender, amount, amount);
    }

    function buyFor(address receiver) external payable nonReentrant {
        uint256 amount = msg.value;
        if (amount == 0) revert ZeroAmount();
        if (receiver == address(0)) revert InvalidReceiver();

        _mint(receiver, amount);

        emit Bought(receiver, amount, amount);
    }

    function sell(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (address(this).balance < amount) revert InsufficientReserve();

        _burn(msg.sender, amount);

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();

        emit Sold(msg.sender, amount, amount);
    }

    function sellTo(address receiver, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (receiver == address(0)) revert InvalidReceiver();
        if (address(this).balance < amount) revert InsufficientReserve();

        _burn(msg.sender, amount);

        (bool ok, ) = payable(receiver).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();

        emit Sold(msg.sender, amount, amount);
    }

    function reservePOL() external view returns (uint256) {
        return address(this).balance;
    }

    function circulatingVWala() external view returns (uint256) {
        return totalSupply();
    }

    function backingSurplus() external view returns (uint256) {
        uint256 reserve = address(this).balance;
        uint256 supply = totalSupply();

        if (reserve > supply) {
            return reserve - supply;
        }

        return 0;
    }

    function backingDeficit() external view returns (uint256) {
        uint256 reserve = address(this).balance;
        uint256 supply = totalSupply();

        if (supply > reserve) {
            return supply - reserve;
        }

        return 0;
    }

    function maxRedeemable(address account) external view returns (uint256) {
        uint256 balance = balanceOf(account);
        uint256 reserve = address(this).balance;

        return balance < reserve ? balance : reserve;
    }
}