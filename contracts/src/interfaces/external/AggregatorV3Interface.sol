// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Chainlink price feed (push) interface.
/// @dev On OCR2 aggregators (every feed Unison uses on Monad), `startedAt` is the observations timestamp inside the
///      report the oracle quorum signed, and `updatedAt` is the block time the report landed on chain.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
