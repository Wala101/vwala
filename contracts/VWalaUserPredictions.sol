// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract VWalaUserPredictions {
    error Unauthorized();
    error InvalidAmount();
    error InvalidConfig();
    error MarketAlreadyExists();
    error MarketNotFound();
    error MarketClosed();
    error MarketNotOpen();
    error MarketAlreadyResolved();
    error MarketNotResolved();
    error NotCreator();
    error NotWinner();
    error PositionAlreadyClaimed();
    error TreasuryInactive();
    error TreasuryInsufficient();

    uint16 public constant BPS = 10000;
    uint16 public constant MAX_FEE = 500;

    IERC20Minimal public immutable token;
    address public immutable feeCollector;

    bool public treasuryActive;

    struct Market {
        bool exists;
        address creator;
        uint256 closeAt;
        uint16 feeBps;
        uint16 probA;
        uint16 probB;
        uint256 poolA;
        uint256 poolB;
        uint256 totalPool;
        bool resolved;
        uint8 winningOption;
        uint256 resolvedAt;
    }

    struct Position {
        bool exists;
        uint8 option;
        uint256 amount;
        bool claimed;
    }

    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => Position)) public positions;

    uint256 public marketCount;

    event MarketCreated(uint256 indexed marketId, address indexed creator);
    event MarketResolved(uint256 indexed marketId, uint8 winningOption);
    event PositionBought(uint256 indexed marketId, address indexed user, uint8 option, uint256 amount);
    event PositionClaimed(uint256 indexed marketId, address indexed user, uint256 payout);

    constructor(address _token, address _feeCollector) {
        token = IERC20Minimal(_token);
        feeCollector = _feeCollector;
    }

    function bootstrapTreasury(uint256 amount) external {
        require(!treasuryActive, "Already bootstrapped");
        require(amount > 0);

        require(token.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        treasuryActive = true;
    }

    function createMarket(
        string calldata title,      // mantido mas não armazenado no struct para economizar stack
        string calldata optionA,
        string calldata optionB,
        uint256 closeAt,
        uint16 feeBps,
        uint16 probA,
        uint16 probB
    ) external returns (uint256 marketId) {
        require(treasuryActive, "Treasury not active");
        require(closeAt > block.timestamp, "Invalid time");
        require(feeBps <= MAX_FEE, "Fee too high");
        require(probA > 0 && probB > 0 && probA + probB == BPS, "Invalid probs");

        marketId = ++marketCount;

        markets[marketId] = Market({
            exists: true,
            creator: msg.sender,
            closeAt: closeAt,
            feeBps: feeBps,
            probA: probA,
            probB: probB,
            poolA: 0,
            poolB: 0,
            totalPool: 0,
            resolved: false,
            winningOption: 0,
            resolvedAt: 0
        });

        emit MarketCreated(marketId, msg.sender);
        return marketId;
    }

    function resolveMarket(uint256 marketId, uint8 winningOption) external {
        Market storage m = markets[marketId];
        require(m.exists, "Market not found");
        require(!m.resolved, "Already resolved");
        require(msg.sender == m.creator, "Not creator");
        require(block.timestamp >= m.closeAt, "Not closed");
        require(winningOption == 0 || winningOption == 1, "Invalid option");

        m.resolved = true;
        m.winningOption = winningOption;
        m.resolvedAt = block.timestamp;

        emit MarketResolved(marketId, winningOption);
    }

    function buyPosition(uint256 marketId, uint8 option, uint256 amount) external {
        Market storage m = markets[marketId];
        require(m.exists, "Market not found");
        require(!m.resolved, "Market resolved");
        require(block.timestamp < m.closeAt, "Market closed");
        require(option == 0 || option == 1);
        require(amount > 0);

        require(token.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        if (option == 0) m.poolA += amount;
        else m.poolB += amount;

        m.totalPool += amount;

        positions[marketId][msg.sender] = Position({
            exists: true,
            option: option,
            amount: amount,
            claimed: false
        });

        emit PositionBought(marketId, msg.sender, option, amount);
    }

    function claim(uint256 marketId) external {
        Market storage m = markets[marketId];
        Position storage p = positions[marketId][msg.sender];

        require(m.resolved, "Not resolved");
        require(p.exists, "No position");
        require(!p.claimed, "Already claimed");
        require(p.option == m.winningOption, "Not winner");

        uint256 winningPool = p.option == 0 ? m.poolA : m.poolB;
        uint256 payout = (p.amount * m.totalPool) / winningPool;

        p.claimed = true;

        require(token.transfer(msg.sender, payout), "Claim failed");

        emit PositionClaimed(marketId, msg.sender, payout);
    }

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function getPosition(uint256 marketId, address user) external view returns (Position memory) {
        return positions[marketId][user];
    }
}