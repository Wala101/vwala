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
    address public constant VWALA_TOKEN_ADDRESS = 0x7bd1f6f4f5cef026b643758605737cb48b4b7d83;

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

    Treasury public treasury;

    mapping(uint64 => Market) public markets;
    mapping(bytes32 => Position) public positions;

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
    ) external onlyOperator {
        if (markets[fixtureId].exists) revert MarketAlreadyExists();
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh();

        uint256 totalProb = uint256(homeProbBps) + uint256(drawProbBps) + uint256(awayProbBps);

        if (
            homeProbBps == 0 ||
            drawProbBps == 0 ||
            awayProbBps == 0 ||
            totalProb != BPS
        ) {
            revert InvalidProbabilityConfig();
        }

        markets[fixtureId] = Market({
            exists: true,
            authority: operator,
            fixtureId: fixtureId,
            league: league,
            teamA: teamA,
            teamB: teamB,
            status: MarketStatus.Open,
            hasWinner: false,
            winningOutcome: Outcome.Home,
            poolHome: 0,
            poolDraw: 0,
            poolAway: 0,
            totalPool: 0,
            marketDistributed: 0,
            probHomeBps: homeProbBps,
            probDrawBps: drawProbBps,
            probAwayBps: awayProbBps,
            feeBps: 0,
            feeAmount: 0,
            createdAt: block.timestamp,
            resolvedAt: 0
        });

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
        if (positions[positionKey].exists) revert PositionAlreadyExists();

        vwala.safeTransferFrom(msg.sender, address(this), amount);

        if (outcome == Outcome.Home) {
            market.poolHome += amount;
        } else if (outcome == Outcome.Draw) {
            market.poolDraw += amount;
        } else {
            market.poolAway += amount;
        }

        market.totalPool += amount;

        positions[positionKey] = Position({
            exists: true,
            fixtureId: fixtureId,
            user: msg.sender,
            couponId: couponId,
            outcome: outcome,
            amount: amount,
            claimed: false,
            claimedAmount: 0
        });

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

        uint256 outcomeProbBps = _probForOutcome(market, market.winningOutcome);
        if (outcomeProbBps == 0 || outcomeProbBps >= BPS) {
            revert InvalidProbabilityConfig();
        }

        uint256 grossProfit = (position.amount * (BPS - outcomeProbBps)) / BPS;
        uint256 feeOnProfit = (grossProfit * market.feeBps) / BPS;
        uint256 netProfit = grossProfit - feeOnProfit;
        uint256 payout = position.amount + netProfit;

        if (payout == 0) revert InvalidPayout();

        uint256 marketAvailable = market.totalPool - market.marketDistributed;
        uint256 fromMarket = marketAvailable >= payout ? payout : marketAvailable;
        uint256 fromTreasury = payout - fromMarket;

        if (fromTreasury > treasury.trackedBalance) revert TreasuryInsufficient();

        market.marketDistributed += fromMarket;

        if (fromTreasury > 0) {
            treasury.trackedBalance -= fromTreasury;
            treasury.totalDistributed += fromTreasury;
        }

        position.claimed = true;
        position.claimedAmount = payout;

        vwala.safeTransfer(msg.sender, payout);

        emit PositionClaimed(
            fixtureId,
            couponId,
            msg.sender,
            payout,
            fromMarket,
            fromTreasury
        );
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

    function getPosition(
        uint64 fixtureId,
        address user,
        uint64 couponId
    ) external view returns (Position memory) {
        return positions[getPositionKey(fixtureId, user, couponId)];
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