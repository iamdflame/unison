// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Chainlink Data Streams' on-chain verifier (VerifierProxy 2.0.0). On Monad mainnet it lives at
///         0xEd813D895457907399E41D36Ec0bE103E32148c8, with no fee manager and no access controller: anyone may verify,
///         for nothing but gas.
interface IVerifierProxy {
    /// @param payload          the full signed report: abi.encode(bytes32[3] context, bytes report, bytes32[] rs,
    ///                         bytes32[] ss, bytes32 rawVs)
    /// @param parameterPayload abi.encode(fee token), read only when a fee manager is set
    /// @return verifierResponse the report itself, once a quorum of the DON's signatures checks out
    function verify(bytes calldata payload, bytes calldata parameterPayload)
        external
        payable
        returns (bytes memory verifierResponse);

    function s_feeManager() external view returns (address);
}
