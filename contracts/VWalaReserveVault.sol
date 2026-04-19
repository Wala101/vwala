// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20BalanceOnly {
    function balanceOf(address account) external view returns (uint256);
}

contract VWalaReserveVault {
    event NativeDeposited(address indexed from, uint256 amount);

    receive() external payable {
        emit NativeDeposited(msg.sender, msg.value);
    }

    fallback() external payable {
        emit NativeDeposited(msg.sender, msg.value);
    }

    function nativeBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function tokenBalance(address token) external view returns (uint256) {
        return IERC20BalanceOnly(token).balanceOf(address(this));
    }
}