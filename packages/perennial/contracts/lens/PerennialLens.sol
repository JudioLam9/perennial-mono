// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.13;

import "../interfaces/IProduct.sol";
import "../interfaces/ICollateral.sol";
import "../interfaces/IController.sol";
import "../interfaces/IOracleProvider.sol";

contract PerennialLens {
    struct UnclaimedIncentiveReward {
        Token18 token;
        UFixed18 amount;
    }

    IController public immutable controller;

    constructor(IController _controller) {
        controller = _controller;
    }

    function name(IProduct product) external view returns (string memory) {
        return product.productProvider().name();
    }

    function symbol(IProduct product) external view returns (string memory) {
        return product.productProvider().symbol();
    }

    function collateral() public view returns (ICollateral) {
        return controller.collateral();
    }

    function collateral(address account, IProduct product)
    external settleAccount(account, product) returns (UFixed18) {
        return collateral().collateral(account, product);
    }

    function collateral(IProduct product) external settle(product) returns (UFixed18) {
        return collateral().collateral(product);
    }

    function shortfall(IProduct product) external settle(product) returns (UFixed18) {
        return collateral().shortfall(product);
    }

    function maintenance(address account, IProduct product)
    external settleAccount(account, product) returns (UFixed18) {
        return UFixed18Lib.max(product.maintenance(account), product.maintenanceNext(account));
    }

    function liquidatable(address account, IProduct product)
    external settleAccount(account, product) returns (bool) {
        return collateral().liquidatable(account, product);
    }

    function pre(address account, IProduct product)
    external settleAccount(account, product) returns (PrePosition memory) {
        return product.pre(account);
    }

    function pre(IProduct product)
    external settle(product) returns (PrePosition memory) {
        return product.pre();
    }

    function position(address account, IProduct product)
    external settleAccount(account, product) returns (Position memory) {
        return product.position(account);
    }

    function position(IProduct product) external settle(product) returns (Position memory) {
        return latestPosition(product);
    }

    function userPosition(address account, IProduct product)
    external settleAccount(account, product) returns (PrePosition memory, Position memory) {
        return (product.pre(account), product.position(account));
    }

    function globalPosition(IProduct product)
    external settle(product) returns (PrePosition memory, Position memory) {
        return (product.pre(), latestPosition(product));
    }

    function price(IProduct product) external settle(product) returns (Fixed18) {
        return latestVersion(product).price;
    }

    function fees(IProduct product)
    external settle(product) returns (UFixed18 protocolFees, UFixed18 productFees) {
        address protocolTreasury = controller.treasury();
        address productTreasury = controller.treasury(product);

        protocolFees = collateral().fees(protocolTreasury);
        productFees = collateral().fees(productTreasury);
    }

    function fees(address account, IProduct[] memory products) external returns (UFixed18) {
        for (uint256 i = 0; i < products.length; i++) {
            products[i].settle();
        }

        return collateral().fees(account);
    }

    function openInterest(address account, IProduct product)
    external settleAccount(account, product) returns (Position memory) {
        return product.position(account).mul(latestVersion(product).price.abs());
    }

    function openInterest(IProduct product) external settle(product) returns (Position memory) {
        return latestPosition(product).mul(latestVersion(product).price.abs());
    }

    function rate(IProduct product) external settle(product) returns (Fixed18) {
        Position memory position_ = latestPosition(product);
        return product.productProvider().rate(position_);
    }

    function dailyRate(IProduct product) external settle(product) returns (Fixed18) {
        Position memory position_ = latestPosition(product);
        return product.productProvider().rate(position_).mul(Fixed18Lib.from(60 * 60 * 24));
    }

    function maintenanceRequired(address account, IProduct product, UFixed18 positionSize)
    external settleAccount(account, product) returns (UFixed18) {
        UFixed18 notional = positionSize.mul(latestVersion(product).price.abs());
        return notional.mul(product.productProvider().maintenance());
    }

    function latestPosition(IProduct product) internal view returns (Position memory) {
        return product.positionAtVersion(product.latestVersion());
    }

    function latestVersion(IProduct product) internal view returns (IOracleProvider.OracleVersion memory) {
        return product.productProvider().currentVersion();
    }

    function unclaimedIncentiveRewards(address account, IProduct product, uint programId)
    external settleAccount(account, product) returns (UFixed18) {
        return controller.incentivizer().unclaimed(account, programId);
    }

    function unclaimedIncentiveRewards(address account, IProduct product)
    external settleAccount(account, product) returns (UnclaimedIncentiveReward[] memory unclaimedRewards) {
        IIncentivizer incentivizer = controller.incentivizer();
        uint256 programCount = incentivizer.programsForLength(product);
        for (uint256 i = 0; i < programCount; i++) {
            uint programId = incentivizer.programsForAt(product, i);
            ProgramInfo memory programInfo = incentivizer.programInfos(programId);
            unclaimedRewards[i] = UnclaimedIncentiveReward(
                programInfo.token,
                incentivizer.unclaimed(account, programId)
            );
        }
    }

    // TODO: Comments, all data for Product, all data for User, batching

    modifier settle(IProduct product) {
        product.settle();
        _;
    }

    modifier settleAccount(address account, IProduct product) {
        product.settle();
        product.settleAccount(account);
        _;
    }
}
