// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20SellMinimal {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function decimals() external view returns (uint8);
}

contract VWalaFixedSell {
    error ZeroValue();
    error InvalidTokenSink();
    error ReentrancyBlocked();
    error InsufficientPolLiquidity();
    error TokenTransferFromFailed();
    error NativeTransferFailed();

    address public immutable tokenSink;

    address public constant VWALA_TOKEN =
        0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83;

    IERC20SellMinimal public immutable token;
    uint8 public immutable tokenDecimals;

    bool private locked;

    event SellExecuted(
        address indexed seller,
        uint256 vwalaIn,
        uint256 polOut
    );

    constructor(address tokenSinkAddress) {
        if (tokenSinkAddress == address(0)) revert InvalidTokenSink();

        tokenSink = tokenSinkAddress;
        token = IERC20SellMinimal(VWALA_TOKEN);
        tokenDecimals = token.decimals();
    }

    modifier nonReentrant() {
        if (locked) revert ReentrancyBlocked();
        locked = true;
        _;
        locked = false;
    }

    function quoteSell(uint256 vwalaAmount) public view returns (uint256) {
        if (tokenDecimals == 18) {
            return vwalaAmount;
        }

        if (tokenDecimals > 18) {
            return vwalaAmount / (10 ** (tokenDecimals - 18));
        }

        return vwalaAmount * (10 ** (18 - tokenDecimals));
    }

    function sell(uint256 vwalaAmount) external nonReentrant returns (uint256 polOut) {
        if (vwalaAmount == 0) revert ZeroValue();

        polOut = quoteSell(vwalaAmount);

        if (address(this).balance < polOut) {
            revert InsufficientPolLiquidity();
        }

        bool ok = token.transferFrom(msg.sender, tokenSink, vwalaAmount);
        if (!ok) revert TokenTransferFromFailed();

        (bool sent, ) = payable(msg.sender).call{ value: polOut }("");
        if (!sent) revert NativeTransferFailed();

        emit SellExecuted(msg.sender, vwalaAmount, polOut);
    }

    receive() external payable {}
}