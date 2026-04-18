// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function decimals() external view returns (uint8);
}

contract VWalaFixedSwap {
    error ZeroValue();
    error InvalidTreasury();
    error ReentrancyBlocked();
    error InsufficientTokenLiquidity();
    error TokenTransferFailed();
    error TreasuryTransferFailed();

    address public immutable treasury;

    address public constant VWALA_TOKEN =
        0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83;

    IERC20Minimal public immutable token;
    uint8 public immutable tokenDecimals;

    bool private locked;

    event SwapExecuted(
        address indexed buyer,
        uint256 polInWei,
        uint256 vwalaOut
    );

    constructor(address treasuryAddress) {
        if (treasuryAddress == address(0)) revert InvalidTreasury();

        treasury = treasuryAddress;
        token = IERC20Minimal(VWALA_TOKEN);
        tokenDecimals = token.decimals();
    }

    modifier nonReentrant() {
        if (locked) revert ReentrancyBlocked();
        locked = true;
        _;
        locked = false;
    }

    function quote(uint256 polAmountWei) public view returns (uint256) {
        if (tokenDecimals == 18) {
            return polAmountWei;
        }

        if (tokenDecimals > 18) {
            return polAmountWei * (10 ** (tokenDecimals - 18));
        }

        return polAmountWei / (10 ** (18 - tokenDecimals));
    }

    function buy() public payable nonReentrant returns (uint256 vwalaOut) {
        if (msg.value == 0) revert ZeroValue();

        vwalaOut = quote(msg.value);

        if (token.balanceOf(address(this)) < vwalaOut) {
            revert InsufficientTokenLiquidity();
        }

        bool ok = token.transfer(msg.sender, vwalaOut);
        if (!ok) revert TokenTransferFailed();

        (bool sent, ) = payable(treasury).call{value: msg.value}("");
        if (!sent) revert TreasuryTransferFailed();

        emit SwapExecuted(msg.sender, msg.value, vwalaOut);
    }

    receive() external payable {
        buy();
    }
}