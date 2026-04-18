// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract VWalaExternalPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant VWALA_TOKEN =
        0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83;

    IERC20 public immutable vwala;
    uint8 public immutable tokenDecimals;

    error ZeroAmount();
    error AmountTooSmall();
    error InsufficientTokenLiquidity();
    error InsufficientPOLLiquidity();
    error NativeTransferFailed();

    event Bought(address indexed buyer, uint256 polIn, uint256 vwalaOut);
    event Sold(address indexed seller, uint256 vwalaIn, uint256 polOut);
    event ReserveFunded(address indexed from, uint256 amount);
    event TokenInventoryFunded(address indexed from, uint256 amount);

    constructor() payable {
        vwala = IERC20(VWALA_TOKEN);
        tokenDecimals = IERC20Metadata(VWALA_TOKEN).decimals();

        if (msg.value > 0) {
            emit ReserveFunded(msg.sender, msg.value);
        }
    }

    receive() external payable {
        if (msg.value == 0) revert ZeroAmount();
        emit ReserveFunded(msg.sender, msg.value);
    }

    function quoteBuy(uint256 polAmountWei) public view returns (uint256) {
        if (polAmountWei == 0) return 0;
        return _polWeiToTokenAmount(polAmountWei);
    }

    function quoteSell(uint256 vwalaAmount) public view returns (uint256) {
        if (vwalaAmount == 0) return 0;
        return _tokenAmountToPolWei(vwalaAmount);
    }

    function buy() external payable nonReentrant returns (uint256 vwalaOut) {
        if (msg.value == 0) revert ZeroAmount();

        vwalaOut = quoteBuy(msg.value);
        if (vwalaOut == 0) revert AmountTooSmall();

        if (vwala.balanceOf(address(this)) < vwalaOut) {
            revert InsufficientTokenLiquidity();
        }

        vwala.safeTransfer(msg.sender, vwalaOut);

        emit Bought(msg.sender, msg.value, vwalaOut);
    }

    function sell(uint256 vwalaAmount) external nonReentrant returns (uint256 polOut) {
        if (vwalaAmount == 0) revert ZeroAmount();

        polOut = quoteSell(vwalaAmount);
        if (polOut == 0) revert AmountTooSmall();

        if (address(this).balance < polOut) {
            revert InsufficientPOLLiquidity();
        }

        vwala.safeTransferFrom(msg.sender, address(this), vwalaAmount);

        (bool ok, ) = payable(msg.sender).call{value: polOut}("");
        if (!ok) revert NativeTransferFailed();

        emit Sold(msg.sender, vwalaAmount, polOut);
    }

    function fundTokenInventory(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        vwala.safeTransferFrom(msg.sender, address(this), amount);

        emit TokenInventoryFunded(msg.sender, amount);
    }

    function reservePOL() external view returns (uint256) {
        return address(this).balance;
    }

    function tokenInventory() external view returns (uint256) {
        return vwala.balanceOf(address(this));
    }

    function maxBuyableInVWala() external view returns (uint256) {
        return vwala.balanceOf(address(this));
    }

    function maxBuyableInPOL() external view returns (uint256) {
        return _tokenAmountToPolWei(vwala.balanceOf(address(this)));
    }

    function maxSellableInVWala() external view returns (uint256) {
        return _polWeiToTokenAmount(address(this).balance);
    }

    function maxRedeemable(address account) external view returns (uint256) {
        uint256 userBalance = vwala.balanceOf(account);
        uint256 sellableNow = _polWeiToTokenAmount(address(this).balance);
        return userBalance < sellableNow ? userBalance : sellableNow;
    }

    function _polWeiToTokenAmount(uint256 polAmountWei) internal view returns (uint256) {
        if (tokenDecimals == 18) {
            return polAmountWei;
        }

        if (tokenDecimals < 18) {
            uint256 factor = 10 ** (18 - tokenDecimals);
            return polAmountWei / factor;
        }

        uint256 factor = 10 ** (tokenDecimals - 18);
        return polAmountWei * factor;
    }

    function _tokenAmountToPolWei(uint256 tokenAmount) internal view returns (uint256) {
        if (tokenDecimals == 18) {
            return tokenAmount;
        }

        if (tokenDecimals < 18) {
            uint256 factor = 10 ** (18 - tokenDecimals);
            return tokenAmount * factor;
        }

        uint256 factor = 10 ** (tokenDecimals - 18);
        return tokenAmount / factor;
    }
}