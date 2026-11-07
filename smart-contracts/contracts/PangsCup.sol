// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title PangsCup
 * @notice Pangs Cup prizes: a soulbound badge (ERC-1155, cannot be transferred) for every
 *         finalist, and a USDG prize for the podium. One contract serves every Cup.
 *
 *         How a Cup is paid out:
 *         1. The owner sends the USDG prize pool to this contract.
 *         2. After the Grand Final the owner writes the results on chain (setResults):
 *            each finalist's wallet, tier and USDG amount. Results are final once set.
 *         3. Each finalist calls claim(cupId) from their own wallet: the badge is minted
 *            and their USDG is sent. Nobody else can claim, and a wallet claims once.
 *         4. USDG nobody claimed by the deadline can go back to the owner (sweepUnclaimed);
 *            the badge itself stays claimable for good.
 *
 *         No server key can move funds: only the wallets written by the owner can claim.
 *         Token id = cupId * 10 + tier. Tiers: 1 Champion, 2 Second, 3 Third, 4 Finalist,
 *         5 Participant.
 *
 *         Participant badge: everyone who raced in a Cup (finalists too) may claim one, free
 *         apart from gas. The owner writes one Merkle root of the racers per Cup
 *         (setParticipants), so the cost does not grow with the field; each racer claims
 *         with the proof for their own wallet (claimParticipant). No USDG is attached.
 *         Leaf = keccak256(bytes.concat(keccak256(abi.encode(wallet, cupId)))), pairs sorted
 *         (OpenZeppelin MerkleProof).
 */
contract PangsCup is ERC1155, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant CHAMPION = 1;
    uint8 public constant SECOND = 2;
    uint8 public constant THIRD = 3;
    uint8 public constant FINALIST = 4;
    uint8 public constant PARTICIPANT = 5;
    uint256 public constant CLAIM_WINDOW = 30 days;
    uint256 public constant MAX_FINALISTS = 10;

    string public constant name = "Pangs Cup Badges";
    string public constant symbol = "PCUP";

    /// @notice The prize token (USDG on Robinhood Chain). Fixed at deployment.
    IERC20 public immutable prizeToken;

    struct Award {
        uint8 tier;
        bool claimed;
        uint256 amount;
    }

    mapping(uint256 => mapping(address => Award)) private _awards;
    mapping(uint256 => address[]) private _finalists;
    /// @notice Last moment a Cup's USDG can be claimed (0 = results not set yet).
    mapping(uint256 => uint256) public claimDeadline;
    /// @notice USDG promised to finalists and not paid out or swept yet, over all Cups.
    uint256 public totalOwed;
    mapping(uint256 => string) private _tokenUris;
    /// @notice Merkle root of everyone who raced in a Cup (0 = not set yet).
    mapping(uint256 => bytes32) public participantRoot;
    mapping(uint256 => mapping(address => bool)) public participantClaimed;

    event ResultsSet(uint256 indexed cupId, uint256 finalists, uint256 prizeTotal, uint256 deadline);
    event Claimed(uint256 indexed cupId, address indexed wallet, uint8 tier, uint256 amount);
    event Swept(uint256 indexed cupId, uint256 amount);
    event BadgeURISet(uint256 indexed tokenId, string uri);
    event ParticipantsSet(uint256 indexed cupId, bytes32 root, uint256 racers);
    event ParticipantClaimed(uint256 indexed cupId, address indexed wallet);

    error Soulbound();
    error ResultsAlreadySet();
    error BadResults();
    error NotFunded();
    error NotAFinalist();
    error AlreadyClaimed();
    error ClaimWindowOpen();
    error ParticipantsAlreadySet();
    error NotAParticipant();

    constructor(address initialOwner, IERC20 prizeToken_) ERC1155("") Ownable(initialOwner) {
        prizeToken = prizeToken_;
    }

    // ------------------------------------------------------------------ owner

    /**
     * @notice Writes a Cup's final results. Only once per Cup. The contract must already hold
     *         enough unpromised USDG to pay every amount.
     */
    function setResults(uint256 cupId, address[] calldata wallets, uint8[] calldata tiers, uint256[] calldata amounts)
        external
        onlyOwner
    {
        if (claimDeadline[cupId] != 0) revert ResultsAlreadySet();
        uint256 n = wallets.length;
        if (n == 0 || n > MAX_FINALISTS || tiers.length != n || amounts.length != n) revert BadResults();

        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            address w = wallets[i];
            uint8 t = tiers[i];
            if (w == address(0) || t < CHAMPION || t > FINALIST || _awards[cupId][w].tier != 0) revert BadResults();
            _awards[cupId][w] = Award({tier: t, claimed: false, amount: amounts[i]});
            _finalists[cupId].push(w);
            total += amounts[i];
        }
        if (prizeToken.balanceOf(address(this)) < totalOwed + total) revert NotFunded();
        totalOwed += total;
        uint256 deadline = block.timestamp + CLAIM_WINDOW;
        claimDeadline[cupId] = deadline;
        emit ResultsSet(cupId, n, total, deadline);
    }

    /// @notice After the claim window, sends a Cup's unclaimed USDG back to the owner.
    function sweepUnclaimed(uint256 cupId) external onlyOwner nonReentrant {
        uint256 deadline = claimDeadline[cupId];
        if (deadline == 0 || block.timestamp <= deadline) revert ClaimWindowOpen();
        address[] storage list = _finalists[cupId];
        uint256 swept;
        for (uint256 i = 0; i < list.length; i++) {
            Award storage a = _awards[cupId][list[i]];
            // Paid amounts are zeroed, so whatever is left was never paid (including a late claim).
            if (a.amount > 0) {
                swept += a.amount;
                a.amount = 0;
            }
        }
        totalOwed -= swept;
        if (swept > 0) prizeToken.safeTransfer(owner(), swept);
        emit Swept(cupId, swept);
    }

    /// @notice USDG sent here by mistake, beyond what is promised to finalists, can go back to the owner.
    function withdrawSpare(uint256 amount) external onlyOwner nonReentrant {
        if (prizeToken.balanceOf(address(this)) < totalOwed + amount) revert NotFunded();
        prizeToken.safeTransfer(owner(), amount);
    }

    /// @notice Writes the Merkle root of a Cup's racers. Once per Cup. `racers` is for the event only.
    function setParticipants(uint256 cupId, bytes32 root, uint256 racers) external onlyOwner {
        if (participantRoot[cupId] != bytes32(0)) revert ParticipantsAlreadySet();
        if (root == bytes32(0)) revert BadResults();
        participantRoot[cupId] = root;
        emit ParticipantsSet(cupId, root, racers);
    }

    function setBadgeURI(uint256 tokenId, string calldata uri_) external onlyOwner {
        _tokenUris[tokenId] = uri_;
        emit BadgeURISet(tokenId, uri_);
        emit URI(uri_, tokenId);
    }

    // ------------------------------------------------------------------ finalists

    /// @notice A finalist takes their badge and their USDG (if any). Once per Cup.
    function claim(uint256 cupId) external nonReentrant {
        Award storage a = _awards[cupId][msg.sender];
        if (a.tier == 0) revert NotAFinalist();
        if (a.claimed) revert AlreadyClaimed();
        a.claimed = true;

        // After the deadline the USDG may have gone back to the owner; the badge is still there.
        uint256 amount = block.timestamp <= claimDeadline[cupId] ? a.amount : 0;
        if (amount > 0) {
            a.amount = 0;
            totalOwed -= amount;
        }
        _mint(msg.sender, badgeId(cupId, a.tier), 1, "");
        if (amount > 0) prizeToken.safeTransfer(msg.sender, amount);
        emit Claimed(cupId, msg.sender, a.tier, amount);
    }

    /// @notice A racer takes their Participant badge, with the proof for their own wallet. Once per Cup.
    function claimParticipant(uint256 cupId, bytes32[] calldata proof) external {
        bytes32 root = participantRoot[cupId];
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, cupId))));
        if (root == bytes32(0) || !MerkleProof.verifyCalldata(proof, root, leaf)) revert NotAParticipant();
        if (participantClaimed[cupId][msg.sender]) revert AlreadyClaimed();
        participantClaimed[cupId][msg.sender] = true;
        _mint(msg.sender, badgeId(cupId, PARTICIPANT), 1, "");
        emit ParticipantClaimed(cupId, msg.sender);
    }

    // ------------------------------------------------------------------ views

    function badgeId(uint256 cupId, uint8 tier) public pure returns (uint256) {
        return cupId * 10 + tier;
    }

    /// @notice tier 0 = not a finalist of this Cup.
    function awardOf(uint256 cupId, address wallet) external view returns (uint8 tier, uint256 amount, bool claimed) {
        Award storage a = _awards[cupId][wallet];
        return (a.tier, a.amount, a.claimed);
    }

    function finalistsOf(uint256 cupId) external view returns (address[] memory) {
        return _finalists[cupId];
    }

    function uri(uint256 tokenId) public view override returns (string memory) {
        return _tokenUris[tokenId];
    }

    /// @notice ERC-5192: every badge is locked to the wallet that claimed it.
    function locked(uint256) external pure returns (bool) {
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0xb45a3c0e || super.supportsInterface(interfaceId); // ERC-5192
    }

    // ------------------------------------------------------------------ soulbound

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (from != address(0)) revert Soulbound();
        super._update(from, to, ids, values);
    }
}
