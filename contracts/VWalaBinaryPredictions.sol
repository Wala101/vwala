// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract VWalaBinaryPredictions {
    error Unauthorized();
    error InvalidAmount();
    error InvalidProbabilityConfig();
    error FeeTooHigh();
    error MarketAlreadyExists();
    error MarketNotFound();
    error MarketClosed();
    error MarketNotOpen();
    error MarketAlreadyResolved();
    error MarketNotResolved();
    error NoWinningLiquidity();
    error PositionAlreadyExists();
    error PositionNotFound();
    error InvalidPositionOwner();
    error PositionAlreadyClaimed();
    error NotWinner();
    error InvalidPayout();
    error TreasuryInactive();
    error TreasuryInsufficient();

    uint8 public constant SIDE_YES = 0;
    uint8 public constant SIDE_NO = 1;

    uint8 public constant STATUS_OPEN = 0;
    uint8 public constant STATUS_CLOSED = 1;
    uint8 public constant STATUS_RESOLVED = 2;

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_FEE_BPS = 1_000; // 10%

    IERC20Minimal public immutable collateralToken;
    address public immutable operator;

    bool public treasuryActive;
    uint256 public treasuryBootstrapped;

    struct Market {
        bool exists;
        address authority;
        uint64 marketId;
        string assetSymbol;
        string question;
        uint64 closeAt;
        int256 referencePriceE8;
        uint16 feeBps;
        uint16 probYesBps;
        uint16 probNoBps;
        uint256 createdAt;
        uint256 resolvedAt;
        bool hasWinner;
        uint8 winningSide;
        uint256 poolYes;
        uint256 poolNo;
        uint256 totalPool;
        uint256 marketDistributed;
        uint256 feeAmount;
    }

    struct Position {
        bool exists;
        uint64 marketId;
        address user;
        uint64 couponId;
        uint8 side;
        uint256 amount;
        bool claimed;
        uint256 claimedAmount;
        uint256 payout;
    }

    mapping(uint64 => Market) private markets;
    mapping(uint64 => mapping(address => mapping(uint64 => Position))) private positions;

    event TreasuryBootstrapped(address indexed sender, uint256 amount);
    event MarketCreated(
        uint64 indexed marketId,
        address indexed authority,
        string assetSymbol,
        string question,
        uint64 closeAt,
        int256 referencePriceE8,
        uint16 feeBps,
        uint16 yesProbBps,
        uint16 noProbBps
    );
    event MarketResolved(
        uint64 indexed marketId,
        int256 finalPriceE8,
        uint8 winningSide,
        uint256 resolvedAt
    );
    event PositionBought(
        uint64 indexed marketId,
        address indexed user,
        uint64 indexed couponId,
        uint8 side,
        uint256 amount,
        uint256 payout
    );
    event PositionClaimed(
        uint64 indexed marketId,
        address indexed user,
        uint64 indexed couponId,
        uint256 payout
    );

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }

    constructor(address collateralToken_, address operator_) {
        require(collateralToken_ != address(0), "INVALID_TOKEN");
        require(operator_ != address(0), "INVALID_OPERATOR");

        collateralToken = IERC20Minimal(collateralToken_);
        operator = operator_;
    }

    function bootstrapTreasury(uint256 amount) external onlyOperator {
        if (amount == 0) revert InvalidAmount();

        bool ok = collateralToken.transferFrom(msg.sender, address(this), amount);
        require(ok, "TREASURY_TRANSFER_FAILED");

        treasuryActive = true;
        treasuryBootstrapped += amount;

        emit TreasuryBootstrapped(msg.sender, amount);
    }

    function createMarket(
        uint64 marketId,
        string calldata assetSymbol,
        string calldata question,
        uint64 closeAt,
        int256 referencePriceE8,
        uint16 feeBps,
        uint16 yesProbBps,
        uint16 noProbBps
    ) external {
        if (markets[marketId].exists) revert MarketAlreadyExists();
        if (closeAt <= block.timestamp) revert MarketClosed();
        if (closeAt % 4 hours != 0) revert InvalidProbabilityConfig();
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh();

        if (
            yesProbBps == 0 ||
            noProbBps == 0 ||
            uint256(yesProbBps) + uint256(noProbBps) != BPS_DENOMINATOR
        ) {
            revert InvalidProbabilityConfig();
        }

        Market storage market = markets[marketId];
        market.exists = true;
        market.authority = msg.sender;
        market.marketId = marketId;
        market.assetSymbol = assetSymbol;
        market.question = question;
        market.closeAt = closeAt;
        market.referencePriceE8 = referencePriceE8;
        market.feeBps = feeBps;
        market.probYesBps = yesProbBps;
        market.probNoBps = noProbBps;
        market.createdAt = block.timestamp;

        emit MarketCreated(
            marketId,
            msg.sender,
            assetSymbol,
            question,
            closeAt,
            referencePriceE8,
            feeBps,
            yesProbBps,
            noProbBps
        );
    }

    function resolveMarket(uint64 marketId, int256 finalPriceE8) external onlyOperator {
        Market storage market = markets[marketId];
        if (!market.exists) revert MarketNotFound();
        if (market.resolvedAt != 0) revert MarketAlreadyResolved();
        if (block.timestamp < market.closeAt) revert MarketNotResolved();

        uint8 winningSide = finalPriceE8 > market.referencePriceE8 ? SIDE_YES : SIDE_NO;

        market.hasWinner = true;
        market.winningSide = winningSide;
        market.resolvedAt = block.timestamp;

        emit MarketResolved(marketId, finalPriceE8, winningSide, market.resolvedAt);
    }

    function previewPayout(
        uint64 marketId,
        uint8 side,
        uint256 amount
    ) external view returns (uint256 payout, uint256 netProfit) {
        Market storage market = markets[marketId];
        if (!market.exists) revert MarketNotFound();
        if (amount == 0) revert InvalidAmount();

        return _previewPayout(market, side, amount);
    }

    function buyPosition(
        uint64 marketId,
        uint64 couponId,
        uint8 side,
        uint256 amount
    ) external {
        if (!treasuryActive) revert TreasuryInactive();
        if (amount == 0) revert InvalidAmount();

        Market storage market = markets[marketId];
        if (!market.exists) revert MarketNotFound();
        if (market.resolvedAt != 0) revert MarketAlreadyResolved();
        if (_marketStatus(market) != STATUS_OPEN) revert MarketNotOpen();

        Position storage existing = positions[marketId][msg.sender][couponId];
        if (existing.exists) revert PositionAlreadyExists();

        (uint256 payout,) = _previewPayout(market, side, amount);

        bool ok = collateralToken.transferFrom(msg.sender, address(this), amount);
        require(ok, "POSITION_TRANSFER_FAILED");

        if (side == SIDE_YES) {
            market.poolYes += amount;
        } else if (side == SIDE_NO) {
            market.poolNo += amount;
        } else {
            revert InvalidProbabilityConfig();
        }

        market.totalPool += amount;

        uint16 probBps = side == SIDE_YES ? market.probYesBps : market.probNoBps;
        uint256 grossPayout = amount + ((amount * (BPS_DENOMINATOR - probBps)) / BPS_DENOMINATOR);
        uint256 feeAmount = (grossPayout * market.feeBps) / BPS_DENOMINATOR;
        market.feeAmount += feeAmount;

        positions[marketId][msg.sender][couponId] = Position({
            exists: true,
            marketId: marketId,
            user: msg.sender,
            couponId: couponId,
            side: side,
            amount: amount,
            claimed: false,
            claimedAmount: 0,
            payout: payout
        });

        emit PositionBought(marketId, msg.sender, couponId, side, amount, payout);
    }

    function claimPosition(uint64 marketId, uint64 couponId) external {
        if (!treasuryActive) revert TreasuryInactive();

        Market storage market = markets[marketId];
        if (!market.exists) revert MarketNotFound();
        if (market.resolvedAt == 0) revert MarketNotResolved();

        Position storage position = positions[marketId][msg.sender][couponId];

        if (!position.exists) revert PositionNotFound();
        if (position.user != msg.sender) revert InvalidPositionOwner();
        if (position.claimed) revert PositionAlreadyClaimed();
        if (!market.hasWinner || position.side != market.winningSide) revert NotWinner();
        if (position.payout == 0) revert InvalidPayout();

        uint256 balance = collateralToken.balanceOf(address(this));
        if (balance < position.payout) revert TreasuryInsufficient();

        position.claimed = true;
        position.claimedAmount = position.payout;
        market.marketDistributed += position.payout;

        bool ok = collateralToken.transfer(msg.sender, position.payout);
        require(ok, "CLAIM_TRANSFER_FAILED");

        emit PositionClaimed(marketId, msg.sender, couponId, position.payout);
    }

    function getMarketState(
        uint64 marketId
    )
        external
        view
        returns (
            bool exists,
            address authority,
            uint64 storedMarketId,
            uint8 status,
            bool hasWinner,
            uint8 winningSide,
            uint256 createdAt,
            uint256 resolvedAt,
            uint256 closeAt
        )
    {
        Market storage market = markets[marketId];

        return (
            market.exists,
            market.authority,
            market.marketId,
            _marketStatus(market),
            market.hasWinner,
            market.winningSide,
            market.createdAt,
            market.resolvedAt,
            market.closeAt
        );
    }

    function getMarketMeta(
        uint64 marketId
    ) external view returns (string memory assetSymbol, string memory question, int256 referencePriceE8) {
        Market storage market = markets[marketId];
        if (!market.exists) revert MarketNotFound();

        return (market.assetSymbol, market.question, market.referencePriceE8);
    }

    function getMarketPools(
        uint64 marketId
    )
        external
        view
        returns (
            uint256 poolYes,
            uint256 poolNo,
            uint256 totalPool,
            uint256 marketDistributed
        )
    {
        Market storage market = markets[marketId];
        if (!market.exists) revert MarketNotFound();

        return (
            market.poolYes,
            market.poolNo,
            market.totalPool,
            market.marketDistributed
        );
    }

    function getMarketProbabilities(
        uint64 marketId
    )
        external
        view
        returns (
            uint16 probYesBps,
            uint16 probNoBps,
            uint16 feeBps,
            uint256 feeAmount
        )
    {
        Market storage market = markets[marketId];
        if (!market.exists) revert MarketNotFound();

        return (
            market.probYesBps,
            market.probNoBps,
            market.feeBps,
            market.feeAmount
        );
    }

    function getPosition(
        uint64 marketId,
        address user,
        uint64 couponId
    )
        external
        view
        returns (
            bool exists,
            uint64 storedMarketId,
            address positionUser,
            uint64 storedCouponId,
            uint8 side,
            uint256 amount,
            bool claimed,
            uint256 claimedAmount
        )
    {
        Position storage position = positions[marketId][user][couponId];

        return (
            position.exists,
            position.marketId,
            position.user,
            position.couponId,
            position.side,
            position.amount,
            position.claimed,
            position.claimedAmount
        );
    }

    function _marketStatus(Market storage market) internal view returns (uint8) {
        if (!market.exists) {
            return STATUS_OPEN;
        }

        if (market.resolvedAt != 0) {
            return STATUS_RESOLVED;
        }

        if (block.timestamp >= market.closeAt) {
            return STATUS_CLOSED;
        }

        return STATUS_OPEN;
    }

    function _previewPayout(
        Market storage market,
        uint8 side,
        uint256 amount
    ) internal view returns (uint256 payout, uint256 netProfit) {
        uint16 sideProbBps;

        if (side == SIDE_YES) {
            sideProbBps = market.probYesBps;
        } else if (side == SIDE_NO) {
            sideProbBps = market.probNoBps;
        } else {
            revert InvalidProbabilityConfig();
        }

        if (sideProbBps == 0) revert InvalidProbabilityConfig();

        uint256 grossPayout =
            amount + ((amount * (BPS_DENOMINATOR - sideProbBps)) / BPS_DENOMINATOR);

        uint256 feeAmount = (grossPayout * market.feeBps) / BPS_DENOMINATOR;
        payout = grossPayout - feeAmount;

        if (payout <= amount) revert InvalidPayout();

        netProfit = payout - amount;
    }
}