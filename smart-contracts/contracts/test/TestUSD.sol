// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test stand-in for USDG (6 decimals). Used only in local tests, never deployed.
contract TestUSD is ERC20 {
    constructor() ERC20("Test USD", "TUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
