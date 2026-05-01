// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { WalaFixedToken } from "./WalaFixedToken.sol";

contract WalaTokenFactory {
    error EmptyName();
    error EmptySymbol();
    error InvalidOwner();
    error InvalidSupply();

    event TokenCreated(
        address indexed creator,
        address indexed owner,
        address indexed token,
        string name,
        string symbol,
        uint256 wholeSupply,
        string metadataURI
    );

    mapping(address => address[]) private _tokensByCreator;

    function createToken(
        string calldata name_,
        string calldata symbol_,
        uint256 wholeSupply_,
        address owner_,
        string calldata metadataURI_
    ) external returns (address token) {
        if (bytes(name_).length == 0) revert EmptyName();
        if (bytes(symbol_).length == 0) revert EmptySymbol();
        if (owner_ == address(0)) revert InvalidOwner();
        if (wholeSupply_ == 0) revert InvalidSupply();

        WalaFixedToken deployed = new WalaFixedToken(
            name_,
            symbol_,
            owner_,
            wholeSupply_,
            metadataURI_
        );

        token = address(deployed);
        _tokensByCreator[msg.sender].push(token);

        emit TokenCreated(
            msg.sender,
            owner_,
            token,
            name_,
            symbol_,
            wholeSupply_,
            metadataURI_
        );
    }

    function getTokensByCreator(address creator_)
        external
        view
        returns (address[] memory)
    {
        return _tokensByCreator[creator_];
    }
}