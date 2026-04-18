// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract WalaBetting is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    uint16 public constant MAX_FEE_BPS = 0;

    // vWALA fixo da plataforma
    address public constant VWALA_TOKEN_ADDRESS = 0x7bD1f6f4F5CEf026b643758605737CB48b4B7D83;

    IERC20 public immutable vwala;
    address public immutable operator;

    enum Outcome {
        Home,
        Draw,
        Away
    }

    enum MarketStatus {
        Open,
        Closed,
        Resolved
    }

    struct Treasury {
        uint256 totalDeposited;
        uint256 totalDistributed;
        uint256 trackedBalance;
        bool active;
    }

    struct Market {
        bool exists;
        address authority;
        uint64 fixtureId;
        string league;
        string teamA;
        string teamB;
        MarketStatus status;
        bool hasWinner;
        Outcome winningOutcome;
        uint256 poolHome;
        uint256 poolDraw;
        uint256 poolAway;
        uint256 totalPool;
        uint256 marketDistributed;
        uint16 probHomeBps;
        uint16 probDrawBps;
        uint16 probAwayBps;
        uint16 feeBps;
        uint256 feeAmount;
        uint256 createdAt;
        uint256 resolvedAt;
    }

    struct Position {
        bool exists;
        uint64 fixtureId;
        address user;
        uint64 couponId;
        Outcome outcome;
        uint256 amount;
        bool claimed;
        uint256 claimedAmount;
    }

    struct ClaimAmounts {
        uint256 payout;
        uint256 fromMarket;
        uint256 fromTreasury;
    }

    Treasury public treasury;

    mapping(uint64 => Market) private markets;
    mapping(bytes32 => Position) private positions;

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

    event TreasuryInitialized(address indexed operator);
    event TreasuryDeposited(address indexed operator, uint256 amount);

    event MarketCreated(
        uint64 indexed fixtureId,
        string league,
        string teamA,
        string teamB,
        uint16 homeProbBps,
        uint16 drawProbBps,
        uint16 awayProbBps
    );

    event PositionBought(
        uint64 indexed fixtureId,
        uint64 indexed couponId,
        address indexed user,
        Outcome outcome,
        uint256 amount
    );

    event MarketClosedEvent(uint64 indexed fixtureId);

    event MarketResolved(
        uint64 indexed fixtureId,
        Outcome winningOutcome
    );

    event PositionClaimed(
        uint64 indexed fixtureId,
        uint64 indexed couponId,
        address indexed user,
        uint256 payout,
        uint256 fromMarket,
        uint256 fromTreasury
    );

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }

    constructor(address operator_) {
        require(operator_ != address(0), "operator zero");

        operator = operator_;
        vwala = IERC20(VWALA_TOKEN_ADDRESS);
    }

    function initTreasury() external onlyOperator {
        if (!treasury.active) {
            treasury.active = true;
            emit TreasuryInitialized(msg.sender);
        }
    }

    function depositTreasury(uint256 amount) external onlyOperator nonReentrant {
        if (!treasury.active) revert TreasuryInactive();
        if (amount == 0) revert InvalidAmount();

        treasury.totalDeposited += amount;
        treasury.trackedBalance += amount;

        vwala.safeTransferFrom(msg.sender, address(this), amount);

        emit TreasuryDeposited(msg.sender, amount);
    }

    function createMarket(
        uint64 fixtureId,
        string calldata league,
        string calldata teamA,
        string calldata teamB,
        uint16 feeBps,
        uint16 homeProbBps,
        uint16 drawProbBps,
        uint16 awayProbBps
    ) external {
        if (markets[fixtureId].exists) revert MarketAlreadyExists();
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh();

        _validateProbabilities(homeProbBps, drawProbBps, awayProbBps);

        Market storage market = markets[fixtureId];

        market.exists = true;
        market.authority = msg.sender;
        market.fixtureId = fixtureId;
        market.league = league;
        market.teamA = teamA;
        market.teamB = teamB;
        market.status = MarketStatus.Open;
        market.hasWinner = false;
        market.winningOutcome = Outcome.Home;
        market.poolHome = 0;
        market.poolDraw = 0;
        market.poolAway = 0;
        market.totalPool = 0;
        market.marketDistributed = 0;
        market.probHomeBps = homeProbBps;
        market.probDrawBps = drawProbBps;
        market.probAwayBps = awayProbBps;
        market.feeBps = 0;
        market.feeAmount = 0;
        market.createdAt = block.timestamp;
        market.resolvedAt = 0;

        emit MarketCreated(
            fixtureId,
            league,
            teamA,
            teamB,
            homeProbBps,
            drawProbBps,
            awayProbBps
        );
    }

    function _validateProbabilities(
        uint16 homeProbBps,
        uint16 drawProbBps,
        uint16 awayProbBps
    ) internal pure {
        uint256 totalProb =
            uint256(homeProbBps) +
            uint256(drawProbBps) +
            uint256(awayProbBps);

        if (
            homeProbBps == 0 ||
            drawProbBps == 0 ||
            awayProbBps == 0 ||
            totalProb != BPS
        ) {
            revert InvalidProbabilityConfig();
        }
    }

    function buyPosition(
        uint64 fixtureId,
        uint64 couponId,
        Outcome outcome,
        uint256 amount
    ) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        Market storage market = markets[fixtureId];
        if (!market.exists) revert MarketNotFound();
        if (market.status != MarketStatus.Open) revert MarketClosed();

        bytes32 positionKey = getPositionKey(fixtureId, msg.sender, couponId);
        Position storage position = positions[positionKey];

        if (position.exists) revert PositionAlreadyExists();

        vwala.safeTransferFrom(msg.sender, address(this), amount);

        if (outcome == Outcome.Home) {
            market.poolHome += amount;
        } else if (outcome == Outcome.Draw) {
            market.poolDraw += amount;
        } else {
            market.poolAway += amount;
        }

        market.totalPool += amount;

        position.exists = true;
        position.fixtureId = fixtureId;
        position.user = msg.sender;
        position.couponId = couponId;
        position.outcome = outcome;
        position.amount = amount;
        position.claimed = false;
        position.claimedAmount = 0;

        emit PositionBought(fixtureId, couponId, msg.sender, outcome, amount);
    }

    function closeMarket(uint64 fixtureId) external onlyOperator {
        Market storage market = markets[fixtureId];
        if (!market.exists) revert MarketNotFound();
        if (market.status != MarketStatus.Open) revert MarketNotOpen();

        market.status = MarketStatus.Closed;

        emit MarketClosedEvent(fixtureId);
    }

    function resolveMarket(
        uint64 fixtureId,
        Outcome winningOutcome
    ) external onlyOperator {
        Market storage market = markets[fixtureId];
        if (!market.exists) revert MarketNotFound();

        if (
            market.status != MarketStatus.Open &&
            market.status != MarketStatus.Closed
        ) {
            revert MarketAlreadyResolved();
        }

        uint256 winningPool = _poolForOutcome(market, winningOutcome);
        if (winningPool == 0) revert NoWinningLiquidity();

        market.status = MarketStatus.Resolved;
        market.hasWinner = true;
        market.winningOutcome = winningOutcome;
        market.feeAmount = 0;
        market.resolvedAt = block.timestamp;

        emit MarketResolved(fixtureId, winningOutcome);
    }

    function claimPosition(
        uint64 fixtureId,
        uint64 couponId
    ) external nonReentrant {
        Market storage market = markets[fixtureId];
        if (!market.exists) revert MarketNotFound();
        if (market.status != MarketStatus.Resolved || !market.hasWinner) {
            revert MarketNotResolved();
        }
        if (!treasury.active) revert TreasuryInactive();

        bytes32 positionKey = getPositionKey(fixtureId, msg.sender, couponId);
        Position storage position = positions[positionKey];

        if (!position.exists) revert PositionNotFound();
        if (position.user != msg.sender) revert InvalidPositionOwner();
        if (position.claimed) revert PositionAlreadyClaimed();
        if (position.outcome != market.winningOutcome) revert NotWinner();

        ClaimAmounts memory amounts = _buildClaimAmounts(market, position);

        if (amounts.fromTreasury > treasury.trackedBalance) {
            revert TreasuryInsufficient();
        }

        market.marketDistributed += amounts.fromMarket;

        if (amounts.fromTreasury > 0) {
            treasury.trackedBalance -= amounts.fromTreasury;
            treasury.totalDistributed += amounts.fromTreasury;
        }

        position.claimed = true;
        position.claimedAmount = amounts.payout;

        vwala.safeTransfer(msg.sender, amounts.payout);

        emit PositionClaimed(
            fixtureId,
            couponId,
            msg.sender,
            amounts.payout,
            amounts.fromMarket,
            amounts.fromTreasury
        );
    }

    function _buildClaimAmounts(
        Market storage market,
        Position storage position
    ) internal view returns (ClaimAmounts memory amounts) {
        uint256 outcomeProbBps = _probForOutcome(market, market.winningOutcome);
        if (outcomeProbBps == 0 || outcomeProbBps >= BPS) {
            revert InvalidProbabilityConfig();
        }

        uint256 grossProfit = (position.amount * (BPS - outcomeProbBps)) / BPS;
        uint256 feeOnProfit = (grossProfit * market.feeBps) / BPS;


        amounts.payout = position.amount + (grossProfit - feeOnProfit);
        if (amounts.payout == 0) revert InvalidPayout();

        uint256 marketAvailable = market.totalPool - market.marketDistributed;
        amounts.fromMarket = marketAvailable >= amounts.payout ? amounts.payout : marketAvailable;
        amounts.fromTreasury = amounts.payout - amounts.fromMarket;
    }

    function previewPayout(
        uint64 fixtureId,
        Outcome outcome,
        uint256 amount
    ) external view returns (uint256 payout, uint256 netProfit) {
        Market storage market = markets[fixtureId];
        if (!market.exists) revert MarketNotFound();
        if (amount == 0) revert InvalidAmount();

        uint256 outcomeProbBps = _probForOutcome(market, outcome);
        if (outcomeProbBps == 0 || outcomeProbBps >= BPS) {
            revert InvalidProbabilityConfig();
        }

        uint256 grossProfit = (amount * (BPS - outcomeProbBps)) / BPS;
        uint256 feeOnProfit = (grossProfit * market.feeBps) / BPS;
        netProfit = grossProfit - feeOnProfit;
        payout = amount + netProfit;
    }

    function getMarketState(
        uint64 fixtureId
    )
        external
        view
        returns (
            bool exists,
            address authority,
            uint64 storedFixtureId,
            MarketStatus status,
            bool hasWinner,
            Outcome winningOutcome,
            uint256 createdAt,
            uint256 resolvedAt
        )
    {
        Market storage market = markets[fixtureId];

        return (
            market.exists,
            market.authority,
            market.fixtureId,
            market.status,
            market.hasWinner,
            market.winningOutcome,
            market.createdAt,
            market.resolvedAt
        );
    }

    function getMarketNames(
        uint64 fixtureId
    )
        external
        view
        returns (
            string memory league,
            string memory teamA,
            string memory teamB
        )
    {
        Market storage market = markets[fixtureId];
        return (market.league, market.teamA, market.teamB);
    }

    function getMarketPools(
        uint64 fixtureId
    )
        external
        view
        returns (
            uint256 poolHome,
            uint256 poolDraw,
            uint256 poolAway,
            uint256 totalPool,
            uint256 marketDistributed
        )
    {
        Market storage market = markets[fixtureId];

        return (
            market.poolHome,
            market.poolDraw,
            market.poolAway,
            market.totalPool,
            market.marketDistributed
        );
    }

    function getMarketProbabilities(
        uint64 fixtureId
    )
        external
        view
        returns (
            uint16 probHomeBps,
            uint16 probDrawBps,
            uint16 probAwayBps,
            uint16 feeBps,
            uint256 feeAmount
        )
    {
        Market storage market = markets[fixtureId];

        return (
            market.probHomeBps,
            market.probDrawBps,
            market.probAwayBps,
            market.feeBps,
            market.feeAmount
        );
    }

    function getPosition(
        uint64 fixtureId,
        address user,
        uint64 couponId
    )
        external
        view
        returns (
            bool exists,
            uint64 storedFixtureId,
            address positionUser,
            uint64 storedCouponId,
            Outcome outcome,
            uint256 amount,
            bool claimed,
            uint256 claimedAmount
        )
    {
        Position storage position = positions[getPositionKey(fixtureId, user, couponId)];

        return (
            position.exists,
            position.fixtureId,
            position.user,
            position.couponId,
            position.outcome,
            position.amount,
            position.claimed,
            position.claimedAmount
        );
    }

    function getPositionKey(
        uint64 fixtureId,
        address user,
        uint64 couponId
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(fixtureId, user, couponId));
    }

    function _poolForOutcome(
        Market storage market,
        Outcome outcome
    ) internal view returns (uint256) {
        if (outcome == Outcome.Home) return market.poolHome;
        if (outcome == Outcome.Draw) return market.poolDraw;
        return market.poolAway;
    }

    function _probForOutcome(
        Market storage market,
        Outcome outcome
    ) internal view returns (uint16) {
        if (outcome == Outcome.Home) return market.probHomeBps;
        if (outcome == Outcome.Draw) return market.probDrawBps;
        return market.probAwayBps;
    }
}