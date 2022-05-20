import { MockContract } from '@ethereum-waffle/mock-contract'
import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE, { waffle } from 'hardhat'

import { impersonate } from '../../testutil'

import {
  Incentivizer,
  Collateral__factory,
  Controller__factory,
  Product__factory,
  Incentivizer__factory,
  IProductProvider__factory,
  IERC20Metadata__factory,
} from '../../../types/generated'
import { currentBlockTimestamp, increase } from '../../testutil/time'

const { ethers } = HRE

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const YEAR = 365 * DAY

describe('Incentivizer', () => {
  let user: SignerWithAddress
  let owner: SignerWithAddress
  let treasury: SignerWithAddress
  let productOwner: SignerWithAddress
  let productTreasury: SignerWithAddress
  let controllerSigner: SignerWithAddress
  let productSigner: SignerWithAddress
  let controller: MockContract
  let collateral: MockContract
  let productProvider: MockContract
  let token: MockContract
  let product: MockContract

  let incentivizer: Incentivizer

  beforeEach(async () => {
    ;[user, owner, treasury, productOwner, productTreasury] = await ethers.getSigners()
    productProvider = await waffle.deployMockContract(owner, IProductProvider__factory.abi)
    product = await waffle.deployMockContract(owner, Product__factory.abi)
    productSigner = await impersonate.impersonateWithBalance(product.address, utils.parseEther('10'))
    await product.mock.productProvider.withArgs().returns(productProvider.address)

    token = await waffle.deployMockContract(owner, IERC20Metadata__factory.abi)
    await token.mock.decimals.withArgs().returns(18)

    collateral = await waffle.deployMockContract(owner, Collateral__factory.abi)

    controller = await waffle.deployMockContract(owner, Controller__factory.abi)
    controllerSigner = await impersonate.impersonateWithBalance(controller.address, utils.parseEther('10'))

    incentivizer = await new Incentivizer__factory(owner).deploy()
    await incentivizer.connect(controllerSigner).initialize(controller.address)

    await controller.mock.collateral.withArgs().returns(collateral.address)
    await controller.mock.incentivizer.withArgs().returns(incentivizer.address)
    await controller.mock.isProduct.withArgs(product.address).returns(true)
    await controller.mock['owner()'].withArgs().returns(owner.address)
    await controller.mock['treasury()'].withArgs().returns(treasury.address)
    await controller.mock['owner(address)'].withArgs(product.address).returns(productOwner.address)
    await controller.mock['treasury(address)'].withArgs(product.address).returns(productTreasury.address)
    await controller.mock['paused()'].withArgs().returns(false)
    await controller.mock['paused(address)'].withArgs(product.address).returns(false)
    await controller.mock.incentivizationFee.withArgs().returns(0)
    await controller.mock.programsPerProduct.withArgs().returns(2)
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      expect(await incentivizer.controller()).to.equal(controller.address)
    })

    it('reverts if already initialized', async () => {
      await expect(incentivizer.connect(owner).initialize(controller.address)).to.be.revertedWith(
        'UInitializableAlreadyInitializedError(1)',
      )
    })

    it('reverts if controller is zero address', async () => {
      const incentivizerFresh = await new Incentivizer__factory(owner).deploy()
      await expect(incentivizerFresh.initialize(ethers.constants.AddressZero)).to.be.revertedWith(
        'InvalidControllerError()',
      )
    })
  })

  describe('#create', async () => {
    it('product owner can create program', async () => {
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)

      const now = await currentBlockTimestamp()

      const returnValue = await incentivizer.connect(productOwner).callStatic.create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
        grace: 7 * DAY,
      })

      await expect(
        incentivizer.connect(productOwner).create({
          product: product.address,
          token: token.address,
          amount: {
            maker: utils.parseEther('8000'),
            taker: utils.parseEther('2000'),
          },
          start: now + HOUR,
          duration: 30 * DAY,
          grace: 7 * DAY,
        }),
      )
        .to.emit(incentivizer, 'ProgramCreated')
        .withArgs(
          0,
          product.address,
          token.address,
          utils.parseEther('8000'),
          utils.parseEther('2000'),
          now + HOUR,
          30 * DAY,
          7 * DAY,
          0,
        )

      const PROGRAM_ID = 0
      expect(returnValue).to.equal(PROGRAM_ID)

      const program = await incentivizer.programInfos(PROGRAM_ID)
      expect(program.start).to.equal(now + HOUR)
      expect(program.duration).to.equal(30 * DAY)
      expect(program.grace).to.equal(7 * DAY)
      expect(program.product).to.equal(product.address)
      expect(program.token).to.equal(token.address)
      expect(program.amount.maker).to.equal(utils.parseEther('8000'))
      expect(program.amount.taker).to.equal(utils.parseEther('2000'))

      expect(await incentivizer.available(PROGRAM_ID)).to.equal(utils.parseEther('10000'))
      expect(await incentivizer.closed(PROGRAM_ID)).to.equal(false)
      expect(await incentivizer.versionComplete(PROGRAM_ID)).to.equal(0)

      expect(await incentivizer.programsForLength(product.address)).to.equal(1)
      expect(await incentivizer.programsForAt(product.address, 0)).to.equal(0)

      expect(await incentivizer.owner(PROGRAM_ID)).to.equal(productOwner.address)
      expect(await incentivizer.treasury(PROGRAM_ID)).to.equal(productTreasury.address)
    })

    it('protocol owner can create program', async () => {
      await token.mock.transferFrom
        .withArgs(owner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)

      const now = await currentBlockTimestamp()

      const returnValue = await incentivizer.connect(owner).callStatic.create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
        grace: 7 * DAY,
      })

      await expect(
        incentivizer.connect(owner).create({
          product: product.address,
          token: token.address,
          amount: {
            maker: utils.parseEther('8000'),
            taker: utils.parseEther('2000'),
          },
          start: now + HOUR,
          duration: 30 * DAY,
          grace: 7 * DAY,
        }),
      )
        .to.emit(incentivizer, 'ProgramCreated')
        .withArgs(
          0,
          product.address,
          token.address,
          utils.parseEther('8000'),
          utils.parseEther('2000'),
          now + HOUR,
          30 * DAY,
          7 * DAY,
          0,
        )

      const PROGRAM_ID = 0
      expect(returnValue).to.equal(PROGRAM_ID)

      const program = await incentivizer.programInfos(PROGRAM_ID)
      expect(program.start).to.equal(now + HOUR)
      expect(program.duration).to.equal(30 * DAY)
      expect(program.grace).to.equal(7 * DAY)
      expect(program.product).to.equal(product.address)
      expect(program.token).to.equal(token.address)
      expect(program.amount.maker).to.equal(utils.parseEther('8000'))
      expect(program.amount.taker).to.equal(utils.parseEther('2000'))

      expect(await incentivizer.available(PROGRAM_ID)).to.equal(utils.parseEther('10000'))
      expect(await incentivizer.closed(PROGRAM_ID)).to.equal(false)
      expect(await incentivizer.versionComplete(PROGRAM_ID)).to.equal(0)

      expect(await incentivizer.programsForLength(product.address)).to.equal(1)
      expect(await incentivizer.programsForAt(product.address, 0)).to.equal(0)

      expect(await incentivizer.owner(PROGRAM_ID)).to.equal(owner.address)
      expect(await incentivizer.treasury(PROGRAM_ID)).to.equal(treasury.address)
    })

    it('product owner can create program with fee', async () => {
      await controller.mock.incentivizationFee.withArgs().returns(utils.parseEther('0.01'))

      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)

      const now = await currentBlockTimestamp()

      const returnValue = await incentivizer.connect(productOwner).callStatic.create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
        grace: 7 * DAY,
      })

      await expect(
        incentivizer.connect(productOwner).create({
          product: product.address,
          token: token.address,
          amount: {
            maker: utils.parseEther('8000'),
            taker: utils.parseEther('2000'),
          },
          start: now + HOUR,
          duration: 30 * DAY,
          grace: 7 * DAY,
        }),
      )
        .to.emit(incentivizer, 'ProgramCreated')
        .withArgs(
          0,
          product.address,
          token.address,
          utils.parseEther('7920'),
          utils.parseEther('1980'),
          now + HOUR,
          30 * DAY,
          7 * DAY,
          utils.parseEther('100'),
        )

      const PROGRAM_ID = 0
      expect(returnValue).to.equal(PROGRAM_ID)

      const program = await incentivizer.programInfos(PROGRAM_ID)
      expect(program.start).to.equal(now + HOUR)
      expect(program.duration).to.equal(30 * DAY)
      expect(program.grace).to.equal(7 * DAY)
      expect(program.product).to.equal(product.address)
      expect(program.token).to.equal(token.address)
      expect(program.amount.maker).to.equal(utils.parseEther('7920'))
      expect(program.amount.taker).to.equal(utils.parseEther('1980'))

      expect(await incentivizer.available(PROGRAM_ID)).to.equal(utils.parseEther('9900'))
      expect(await incentivizer.closed(PROGRAM_ID)).to.equal(false)
      expect(await incentivizer.versionComplete(PROGRAM_ID)).to.equal(0)

      expect(await incentivizer.programsForLength(product.address)).to.equal(1)
      expect(await incentivizer.programsForAt(product.address, 0)).to.equal(0)

      expect(await incentivizer.owner(PROGRAM_ID)).to.equal(productOwner.address)
      expect(await incentivizer.treasury(PROGRAM_ID)).to.equal(productTreasury.address)

      expect(await incentivizer.fees(token.address)).to.equal(utils.parseEther('100'))
    })

    it('reverts if not product', async () => {
      await controller.mock.isProduct.withArgs(product.address).returns(false)

      const now = await currentBlockTimestamp()

      await expect(
        incentivizer.connect(owner).create({
          product: product.address,
          token: token.address,
          amount: {
            maker: utils.parseEther('8000'),
            taker: utils.parseEther('2000'),
          },
          start: now + HOUR,
          duration: 30 * DAY,
          grace: 7 * DAY,
        }),
      ).to.be.revertedWith(`NotProductError("${product.address}")`)
    })

    it('reverts if too many programs', async () => {
      await token.mock.transferFrom
        .withArgs(owner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)

      const now = await currentBlockTimestamp()

      await incentivizer.connect(owner).create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
        grace: 7 * DAY,
      })
      await incentivizer.connect(owner).create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
        grace: 7 * DAY,
      })

      await expect(
        incentivizer.connect(owner).create({
          product: product.address,
          token: token.address,
          amount: {
            maker: utils.parseEther('8000'),
            taker: utils.parseEther('2000'),
          },
          start: now + HOUR,
          duration: 30 * DAY,
          grace: 7 * DAY,
        }),
      ).to.be.revertedWith(`IncentivizerTooManyProgramsError()`)
    })

    it('reverts if not owner', async () => {
      const now = await currentBlockTimestamp()

      await expect(
        incentivizer.connect(user).create({
          product: product.address,
          token: token.address,
          amount: {
            maker: utils.parseEther('8000'),
            taker: utils.parseEther('2000'),
          },
          start: now + HOUR,
          duration: 30 * DAY,
          grace: 7 * DAY,
        }),
      ).to.be.revertedWith(`NotProductOwnerError("${product.address}")`)
    })

    it('reverts if already started', async () => {
      const now = await currentBlockTimestamp()

      await expect(
        incentivizer.connect(owner).create({
          product: product.address,
          token: token.address,
          amount: {
            maker: utils.parseEther('8000'),
            taker: utils.parseEther('2000'),
          },
          start: now - HOUR,
          duration: 30 * DAY,
          grace: 7 * DAY,
        }),
      ).to.be.revertedWith(`ProgramAlreadyStartedError()`)
    })

    it('reverts if too short duration', async () => {
      const now = await currentBlockTimestamp()

      await expect(
        incentivizer.connect(owner).create({
          product: product.address,
          token: token.address,
          amount: {
            maker: utils.parseEther('8000'),
            taker: utils.parseEther('2000'),
          },
          start: now + HOUR,
          duration: 12 * HOUR,
          grace: 7 * DAY,
        }),
      ).to.be.revertedWith(`ProgramInvalidDurationError()`)
    })

    it('reverts if too long duration', async () => {
      const now = await currentBlockTimestamp()

      await expect(
        incentivizer.connect(owner).create({
          product: product.address,
          token: token.address,
          amount: {
            maker: utils.parseEther('8000'),
            taker: utils.parseEther('2000'),
          },
          start: now + HOUR,
          duration: 4 * YEAR,
          grace: 7 * DAY,
        }),
      ).to.be.revertedWith(`ProgramInvalidDurationError()`)
    })

    it('reverts if too short grace', async () => {
      const now = await currentBlockTimestamp()

      await expect(
        incentivizer.connect(owner).create({
          product: product.address,
          token: token.address,
          amount: {
            maker: utils.parseEther('8000'),
            taker: utils.parseEther('2000'),
          },
          start: now + HOUR,
          duration: 30 * DAY,
          grace: 3 * DAY,
        }),
      ).to.be.revertedWith(`ProgramInvalidGraceError()`)
    })

    it('reverts if too long grace', async () => {
      const now = await currentBlockTimestamp()

      await expect(
        incentivizer.connect(owner).create({
          product: product.address,
          token: token.address,
          amount: {
            maker: utils.parseEther('8000'),
            taker: utils.parseEther('2000'),
          },
          start: now + HOUR,
          duration: 30 * DAY,
          grace: 90 * DAY,
        }),
      ).to.be.revertedWith(`ProgramInvalidGraceError()`)
    })

    it('reverts if paused', async () => {
      await controller.mock['paused(address)'].withArgs(product.address).returns(true)
      const now = await currentBlockTimestamp()

      await expect(
        incentivizer.connect(owner).create({
          product: product.address,
          token: token.address,
          amount: {
            maker: utils.parseEther('8000'),
            taker: utils.parseEther('2000'),
          },
          start: now + HOUR,
          duration: 30 * DAY,
          grace: 7 * DAY,
        }),
      ).to.be.revertedWith(`PausedError()`)
    })
  })

  describe('#sync', async () => {
    beforeEach(async () => {
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('20000'))
        .returns(true)

      const now = await currentBlockTimestamp()

      await incentivizer.connect(productOwner).create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
        grace: 7 * DAY,
      })

      await incentivizer.connect(productOwner).create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('16000'),
          taker: utils.parseEther('4000'),
        },
        start: now + HOUR,
        duration: 60 * DAY,
        grace: 7 * DAY,
      })
    })

    it('correctly completes neither program', async () => {
      await increase(29 * DAY)

      const now = await currentBlockTimestamp()
      const LATEST_VERSION = 19

      await product.mock.latestVersion.withArgs().returns(LATEST_VERSION)

      await expect(
        incentivizer.connect(productSigner).sync({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_VERSION + 1,
        }),
      )

      expect(await incentivizer.versionComplete(0)).to.equal(0)
      expect(await incentivizer.versionComplete(1)).to.equal(0)
    })

    it('correctly completes first program', async () => {
      await increase(31 * DAY)

      const now = await currentBlockTimestamp()
      const LATEST_VERSION = 23

      await product.mock.latestVersion.withArgs().returns(LATEST_VERSION)

      await expect(
        incentivizer.connect(productSigner).sync({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_VERSION + 1,
        }),
      )
        .to.emit(incentivizer, 'ProgramCompleted')
        .withArgs(0, LATEST_VERSION)

      expect(await incentivizer.versionComplete(0)).to.equal(LATEST_VERSION)
      expect(await incentivizer.versionComplete(1)).to.equal(0)
    })

    it('correctly completes first program later', async () => {
      await increase(31 * DAY)

      const now = await currentBlockTimestamp()
      const LATEST_VERSION = 23

      await product.mock.latestVersion.withArgs().returns(LATEST_VERSION)

      await expect(
        incentivizer.connect(productSigner).sync({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_VERSION + 10,
        }),
      )
        .to.emit(incentivizer, 'ProgramCompleted')
        .withArgs(0, LATEST_VERSION)

      expect(await incentivizer.versionComplete(0)).to.equal(LATEST_VERSION)
      expect(await incentivizer.versionComplete(1)).to.equal(0)
    })

    it('correctly completes both programs', async () => {
      await increase(61 * DAY)

      const now = await currentBlockTimestamp()
      const LATEST_VERSION = 46

      await product.mock.latestVersion.withArgs().returns(LATEST_VERSION)

      await expect(
        incentivizer.connect(productSigner).sync({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_VERSION + 1,
        }),
      )
        .to.emit(incentivizer, 'ProgramCompleted')
        .withArgs(0, LATEST_VERSION)
        .to.emit(incentivizer, 'ProgramCompleted')
        .withArgs(1, LATEST_VERSION)

      expect(await incentivizer.versionComplete(0)).to.equal(LATEST_VERSION)
      expect(await incentivizer.versionComplete(1)).to.equal(LATEST_VERSION)
    })

    it('doesnt recomplete program', async () => {
      await increase(31 * DAY)

      let now = await currentBlockTimestamp()
      await product.mock.latestVersion.withArgs().returns(23)

      await incentivizer.connect(productSigner).sync({
        price: utils.parseEther('1'),
        timestamp: now,
        version: 23 + 1,
      })

      await increase(31 * DAY)

      now = await currentBlockTimestamp()
      await product.mock.latestVersion.withArgs().returns(46)

      await expect(
        incentivizer.connect(productSigner).sync({
          price: utils.parseEther('1'),
          timestamp: now,
          version: 46 + 1,
        }),
      )
        .to.emit(incentivizer, 'ProgramCompleted')
        .withArgs(1, 46)

      expect(await incentivizer.versionComplete(0)).to.equal(23)
      expect(await incentivizer.versionComplete(1)).to.equal(46)
    })

    it('reverts if not product', async () => {
      const now = await currentBlockTimestamp()
      await controller.mock.isProduct.withArgs(user.address).returns(false)

      await expect(
        incentivizer.connect(user).sync({
          price: utils.parseEther('1'),
          timestamp: now,
          version: 23 + 1,
        }),
      ).to.be.revertedWith(`NotProductError("${user.address}")`)
    })
  })

  describe('#syncAccount', async () => {
    beforeEach(async () => {
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('20000'))
        .returns(true)

      const now = await currentBlockTimestamp()

      await incentivizer.connect(productOwner).create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
        grace: 7 * DAY,
      })

      await incentivizer.connect(productOwner).create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('16000'),
          taker: utils.parseEther('4000'),
        },
        start: now + HOUR,
        duration: 60 * DAY,
        grace: 7 * DAY,
      })
    })

    context('first sync', async () => {
      beforeEach(async () => {
        await increase(2 * HOUR)
      })

      it('all empty', async () => {
        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 23
        const SHARE_DELTA = { maker: 0, taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000'))
        expect(await incentivizer.settled(user.address, 0)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(0)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000'))
        expect(await incentivizer.settled(user.address, 1)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(0)
      })

      it('share change no position', async () => {
        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 23
        const SHARE_DELTA = { maker: utils.parseEther('180'), taker: utils.parseEther('360') }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000'))
        expect(await incentivizer.settled(user.address, 0)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(0)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000'))
        expect(await incentivizer.settled(user.address, 1)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(0)
      })

      it('share change maker position', async () => {
        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 23
        const SHARE_DELTA = { maker: utils.parseEther('180'), taker: utils.parseEther('360') }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000'))
        expect(await incentivizer.settled(user.address, 0)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(0)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000'))
        expect(await incentivizer.settled(user.address, 1)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(0)
      })

      it('share change taker position', async () => {
        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 23
        const SHARE_DELTA = { maker: utils.parseEther('180'), taker: utils.parseEther('360') }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000'))
        expect(await incentivizer.settled(user.address, 0)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(0)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000'))
        expect(await incentivizer.settled(user.address, 1)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(0)
      })
    })

    context('second sync', async () => {
      beforeEach(async () => {
        await increase(2 * HOUR)

        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 17
        const SHARE_DELTA = { maker: 0, taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        await increase(2 * HOUR)
      })

      it('all empty', async () => {
        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 23
        const SHARE_DELTA = { maker: 0, taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000'))
        expect(await incentivizer.settled(user.address, 0)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(0)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000'))
        expect(await incentivizer.settled(user.address, 1)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(0)
      })

      it('share change no position', async () => {
        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 23
        const SHARE_DELTA = { maker: 0, taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000'))
        expect(await incentivizer.settled(user.address, 0)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(0)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000'))
        expect(await incentivizer.settled(user.address, 1)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(0)
      })

      it('share change maker position', async () => {
        // reward pre second * share delta * position
        // 8000 * 10^18 / (60 * 60 * 24 * 30) * 180 * 10 = 5555555555555555555
        const EXPECTED_REWARD = ethers.BigNumber.from('5555555555555554200')

        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 23
        const SHARE_DELTA = { maker: utils.parseEther('1800'), taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000').sub(EXPECTED_REWARD))
        expect(await incentivizer.settled(user.address, 0)).to.equal(EXPECTED_REWARD)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(EXPECTED_REWARD)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000').sub(EXPECTED_REWARD))
        expect(await incentivizer.settled(user.address, 1)).to.equal(EXPECTED_REWARD)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(EXPECTED_REWARD)
      })

      it('share change taker position', async () => {
        // reward pre second * share delta * position
        // 2000 * 10^18 / (60 * 60 * 24 * 30) * 360 * 5 = 1388888888888888888
        const EXPECTED_REWARD = ethers.BigNumber.from('1388888888888887200')

        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 23
        const SHARE_DELTA = { maker: 0, taker: utils.parseEther('1800') }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000').sub(EXPECTED_REWARD))
        expect(await incentivizer.settled(user.address, 0)).to.equal(EXPECTED_REWARD)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(EXPECTED_REWARD)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000').sub(EXPECTED_REWARD))
        expect(await incentivizer.settled(user.address, 1)).to.equal(EXPECTED_REWARD)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(23)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(EXPECTED_REWARD)
      })
    })

    context('already complete', async () => {
      beforeEach(async () => {
        await increase(2 * HOUR)

        let now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 17
        const SHARE_DELTA = { maker: 0, taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        await increase(61 * DAY)

        now = await currentBlockTimestamp()
        const LATEST_VERSION = 46
        await product.mock.latestVersion.withArgs().returns(LATEST_VERSION)

        await incentivizer.connect(productSigner).sync({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_VERSION + 1,
        })

        await increase(2 * HOUR)
      })

      it('all empty', async () => {
        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 49
        const VERSION_COMPLETE = 46
        const SHARE_DELTA = { maker: 0, taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await productProvider.mock.atVersion.withArgs(VERSION_COMPLETE).returns({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000'))
        expect(await incentivizer.settled(user.address, 0)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(VERSION_COMPLETE)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(0)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000'))
        expect(await incentivizer.settled(user.address, 1)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(VERSION_COMPLETE)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(0)
      })

      it('share change no position', async () => {
        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 49
        const VERSION_COMPLETE = 46
        const SHARE_DELTA = { maker: 0, taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await productProvider.mock.atVersion.withArgs(VERSION_COMPLETE).returns({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000'))
        expect(await incentivizer.settled(user.address, 0)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(VERSION_COMPLETE)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(0)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000'))
        expect(await incentivizer.settled(user.address, 1)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(VERSION_COMPLETE)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(0)
      })

      it('share change maker position', async () => {
        // reward pre second * share delta * position
        // 8000 * 10^18 / (60 * 60 * 24 * 30) * 180 * 10 = 5555555555555555555
        const EXPECTED_REWARD = ethers.BigNumber.from('5555555555555554200')

        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 49
        const VERSION_COMPLETE = 46
        const SHARE_DELTA = { maker: utils.parseEther('1800'), taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await productProvider.mock.atVersion.withArgs(VERSION_COMPLETE).returns({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000').sub(EXPECTED_REWARD))
        expect(await incentivizer.settled(user.address, 0)).to.equal(EXPECTED_REWARD)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(VERSION_COMPLETE)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(EXPECTED_REWARD)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000').sub(EXPECTED_REWARD))
        expect(await incentivizer.settled(user.address, 1)).to.equal(EXPECTED_REWARD)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(VERSION_COMPLETE)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(EXPECTED_REWARD)
      })

      it('share change taker position', async () => {
        // reward pre second * share delta * position
        // 2000 * 10^18 / (60 * 60 * 24 * 30) * 360 * 5 = 1388888888888888888
        const EXPECTED_REWARD = ethers.BigNumber.from('1388888888888887200')

        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 49
        const VERSION_COMPLETE = 46
        const SHARE_DELTA = { maker: 0, taker: utils.parseEther('1800') }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await productProvider.mock.atVersion.withArgs(VERSION_COMPLETE).returns({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000').sub(EXPECTED_REWARD))
        expect(await incentivizer.settled(user.address, 0)).to.equal(EXPECTED_REWARD)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(VERSION_COMPLETE)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(EXPECTED_REWARD)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000').sub(EXPECTED_REWARD))
        expect(await incentivizer.settled(user.address, 1)).to.equal(EXPECTED_REWARD)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(VERSION_COMPLETE)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(EXPECTED_REWARD)
      })
    })

    context('not yet complete', async () => {
      beforeEach(async () => {
        await increase(2 * HOUR)

        let now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 17
        const SHARE_DELTA = { maker: 0, taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        await increase(61 * DAY)

        now = await currentBlockTimestamp()
        const LATEST_VERSION = 46
        await product.mock.latestVersion.withArgs().returns(LATEST_VERSION)

        await incentivizer.connect(productSigner).sync({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_VERSION + 1,
        })

        await increase(2 * HOUR)
      })

      it('all empty', async () => {
        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 43
        const SHARE_DELTA = { maker: 0, taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000'))
        expect(await incentivizer.settled(user.address, 0)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(LATEST_USER_VERSION)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(0)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000'))
        expect(await incentivizer.settled(user.address, 1)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(LATEST_USER_VERSION)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(0)
      })

      it('share change no position', async () => {
        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 43
        const SHARE_DELTA = { maker: 0, taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000'))
        expect(await incentivizer.settled(user.address, 0)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(LATEST_USER_VERSION)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(0)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000'))
        expect(await incentivizer.settled(user.address, 1)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(LATEST_USER_VERSION)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(0)
      })

      it('share change maker position', async () => {
        // reward pre second * share delta * position
        // 8000 * 10^18 / (60 * 60 * 24 * 30) * 180 * 10 = 5555555555555555555
        const EXPECTED_REWARD = ethers.BigNumber.from('5555555555555554200')

        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 43
        const SHARE_DELTA = { maker: utils.parseEther('1800'), taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000').sub(EXPECTED_REWARD))
        expect(await incentivizer.settled(user.address, 0)).to.equal(EXPECTED_REWARD)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(LATEST_USER_VERSION)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(EXPECTED_REWARD)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000').sub(EXPECTED_REWARD))
        expect(await incentivizer.settled(user.address, 1)).to.equal(EXPECTED_REWARD)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(LATEST_USER_VERSION)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(EXPECTED_REWARD)
      })

      it('share change taker position', async () => {
        // reward pre second * share delta * position
        // 2000 * 10^18 / (60 * 60 * 24 * 30) * 360 * 5 = 1388888888888888888
        const EXPECTED_REWARD = ethers.BigNumber.from('1388888888888887200')

        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 43
        const SHARE_DELTA = { maker: 0, taker: utils.parseEther('1800') }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000').sub(EXPECTED_REWARD))
        expect(await incentivizer.settled(user.address, 0)).to.equal(EXPECTED_REWARD)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(LATEST_USER_VERSION)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(EXPECTED_REWARD)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000').sub(EXPECTED_REWARD))
        expect(await incentivizer.settled(user.address, 1)).to.equal(EXPECTED_REWARD)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(LATEST_USER_VERSION)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(EXPECTED_REWARD)
      })
    })

    context('closed', async () => {
      beforeEach(async () => {
        await increase(2 * HOUR)

        let now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 17
        const SHARE_DELTA = { maker: 0, taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        await increase(61 * DAY)

        now = await currentBlockTimestamp()
        const LATEST_VERSION = 46

        await product.mock.latestVersion.withArgs().returns(LATEST_VERSION)
        await productProvider.mock.atVersion.withArgs(LATEST_VERSION).returns({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_VERSION,
        })

        await incentivizer.connect(productSigner).sync({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_VERSION + 1,
        })

        await increase(8 * DAY)

        await token.mock.transfer.withArgs(productTreasury.address, utils.parseEther('10000')).returns(true)
        await token.mock.transfer.withArgs(productTreasury.address, utils.parseEther('20000')).returns(true)

        await incentivizer.connect(productSigner).close(0)
        await incentivizer.connect(productSigner).close(1)
      })

      it('unclaimed is wiped', async () => {
        const now = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 43
        const LATEST_USER_VERSION_PREVIOUS = 17
        const POSITION = { maker: utils.parseEther('10'), taker: 0 }
        const SHARE = { maker: utils.parseEther('180'), taker: utils.parseEther('360') }
        const SHARE_PREVIOUS = { maker: 0, taker: 0 }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock.position.withArgs(user.address).returns(POSITION)
        await product.mock.shareAtVersion.withArgs(LATEST_USER_VERSION).returns(SHARE)
        await product.mock.shareAtVersion.withArgs(LATEST_USER_VERSION_PREVIOUS).returns(SHARE_PREVIOUS)
        await productProvider.mock.atVersion.withArgs(LATEST_USER_VERSION).returns({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }) // or version complete

        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(0)
      })
    })

    context('not started', async () => {
      it('latest version is not set', async () => {
        const now = await currentBlockTimestamp()

        const LATEST_USER_VERSION = 23
        const SHARE_DELTA = { maker: 0, taker: 0 }
        const TO_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        }

        await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

        expect(await incentivizer.available(0)).to.equal(utils.parseEther('10000'))
        expect(await incentivizer.settled(user.address, 0)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 0)).to.equal(0)
        expect(await incentivizer.unclaimed(user.address, 0)).to.equal(0)

        expect(await incentivizer.available(1)).to.equal(utils.parseEther('20000'))
        expect(await incentivizer.settled(user.address, 1)).to.equal(0)
        expect(await incentivizer.latestVersion(user.address, 1)).to.equal(0)
        expect(await incentivizer.unclaimed(user.address, 1)).to.equal(0)
      })
    })

    context('invalid', async () => {
      it('unclaimed is zero', async () => {
        const now = await currentBlockTimestamp()

        const LATEST_USER_VERSION = 23
        const LATEST_USER_VERSION_PREVIOUS = 0
        const POSITION = { maker: 0, taker: 0 }
        const SHARE = { maker: 0, taker: 0 }
        const SHARE_PREVIOUS = { maker: 0, taker: 0 }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock.position.withArgs(user.address).returns(POSITION)
        await product.mock.shareAtVersion.withArgs(LATEST_USER_VERSION).returns(SHARE)
        await product.mock.shareAtVersion.withArgs(LATEST_USER_VERSION_PREVIOUS).returns(SHARE_PREVIOUS)
        await productProvider.mock.atVersion.withArgs(LATEST_USER_VERSION).returns({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_USER_VERSION,
        })

        expect(await incentivizer.unclaimed(user.address, 2)).to.equal(0)
      })
    })

    it('reverts if not product', async () => {
      await controller.mock.isProduct.withArgs(user.address).returns(false)

      await expect(
        incentivizer
          .connect(user)
          .syncAccount(user.address, { maker: 0, taker: 0 }, { price: 0, timestamp: 0, version: 0 }),
      ).to.be.revertedWith(`NotProductError("${user.address}")`)
    })
  })

  describe('#end', async () => {
    beforeEach(async () => {
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)

      let now = await currentBlockTimestamp()

      await incentivizer.connect(productOwner).create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
        grace: 7 * DAY,
      })

      await increase(2 * HOUR)

      now = await currentBlockTimestamp()
      const LATEST_USER_VERSION = 17
      const SHARE_DELTA = { maker: 0, taker: 0 }
      const TO_ORACLE_VERSION = {
        price: utils.parseEther('1'),
        timestamp: now,
        version: LATEST_USER_VERSION,
      }

      await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

      await increase(16 * DAY)

      now = await currentBlockTimestamp()
      const LATEST_VERSION = 23

      await product.mock.latestVersion.withArgs().returns(LATEST_VERSION)
      await productProvider.mock.atVersion.withArgs(LATEST_VERSION).returns({
        price: utils.parseEther('1'),
        timestamp: now,
        version: LATEST_VERSION,
      })

      await incentivizer.connect(productSigner).sync({
        price: utils.parseEther('1'),
        timestamp: now,
        version: LATEST_VERSION + 1,
      })
    })

    it('ends correctly', async () => {
      await expect(incentivizer.connect(productOwner).end(0)).to.emit(incentivizer, 'ProgramCompleted').withArgs(0, 23)

      expect(await incentivizer.closed(0)).to.equal(false)
      expect(await incentivizer.versionComplete(0)).to.equal(23)
    })

    it('closable early after ending early', async () => {
      await incentivizer.connect(productOwner).end(0)

      await increase(8 * DAY)

      await token.mock.transfer.withArgs(productTreasury.address, utils.parseEther('10000')).returns(true)

      await expect(incentivizer.connect(productSigner).close(0))
        .to.emit(incentivizer, 'ProgramClosed')
        .withArgs(0, utils.parseEther('10000'))

      expect(await incentivizer.available(0)).to.equal(0)
      expect(await incentivizer.closed(0)).to.equal(true)
      expect(await incentivizer.versionComplete(0)).to.equal(23)
      expect(await incentivizer.programsForLength(product.address)).to.equal(0)
    })

    it('reverts if not valid program', async () => {
      await expect(incentivizer.connect(productSigner).end(1)).to.be.revertedWith(`IncentivizerInvalidProgramError(1)`)
    })

    it('reverts if not owner', async () => {
      await expect(incentivizer.connect(user).end(0)).to.be.revertedWith(`IncentivizerNotProgramOwnerError(0)`)
    })

    it('reverts if paused', async () => {
      await controller.mock['paused(address)'].withArgs(product.address).returns(true)
      await expect(incentivizer.connect(productOwner).end(0)).to.be.revertedWith(`IncentivizerProgramPausedError(0)`)
    })
  })

  describe('#claim', async () => {
    // reward pre second * share delta * position
    // 8000 * 10^18 / (60 * 60 * 24 * 30) * 180 * 10 = 5555555555555555555
    const EXPECTED_REWARD = ethers.BigNumber.from('5555555555555554200')

    beforeEach(async () => {
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('20000'))
        .returns(true)

      let now = await currentBlockTimestamp()

      await incentivizer.connect(productOwner).create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
        grace: 7 * DAY,
      })

      await incentivizer.connect(productOwner).create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('16000'),
          taker: utils.parseEther('4000'),
        },
        start: now + HOUR,
        duration: 60 * DAY,
        grace: 7 * DAY,
      })

      await increase(2 * HOUR)

      now = await currentBlockTimestamp()
      let LATEST_USER_VERSION = 17
      let SHARE_DELTA = { maker: utils.parseEther('0'), taker: utils.parseEther('0') }
      let TO_ORACLE_VERSION = {
        price: utils.parseEther('1'),
        timestamp: now,
        version: LATEST_USER_VERSION,
      }

      await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

      await increase(2 * HOUR)

      // reward pre second * share delta * position
      // 8000 * 10^18 / (60 * 60 * 24 * 30) * 180 * 10 = 5555555555555555555
      const EXPECTED_REWARD = ethers.BigNumber.from('5555555555555554200')

      now = await currentBlockTimestamp()
      LATEST_USER_VERSION = 23
      SHARE_DELTA = { maker: utils.parseEther('1800'), taker: utils.parseEther('0') }
      TO_ORACLE_VERSION = {
        price: utils.parseEther('1'),
        timestamp: now,
        version: LATEST_USER_VERSION,
      }

      await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

      await token.mock.transfer.withArgs(user.address, EXPECTED_REWARD).returns(true)
      await product.mock.settle.withArgs().returns()
      await product.mock.settleAccount.withArgs(user.address).returns()
    })

    it('claims individual programs', async () => {
      await incentivizer.connect(user)['claim(uint256)'](0)
      await incentivizer.connect(user)['claim(uint256)'](1)

      expect(await incentivizer.settled(user.address, 0)).to.equal(0)
      expect(await incentivizer.unclaimed(user.address, 0)).to.equal(0)
      expect(await incentivizer.settled(user.address, 1)).to.equal(0)
      expect(await incentivizer.unclaimed(user.address, 1)).to.equal(0)
    })

    it('claims product', async () => {
      await expect(incentivizer.connect(user)['claim(address)'](product.address))
        .to.emit(incentivizer, 'Claim')
        .withArgs(user.address, 0, EXPECTED_REWARD)
        .to.emit(incentivizer, 'Claim')
        .withArgs(user.address, 1, EXPECTED_REWARD)

      expect(await incentivizer.settled(user.address, 0)).to.equal(0)
      expect(await incentivizer.unclaimed(user.address, 0)).to.equal(0)
      expect(await incentivizer.settled(user.address, 1)).to.equal(0)
      expect(await incentivizer.unclaimed(user.address, 1)).to.equal(0)
    })

    it('reverts if not valid program', async () => {
      await expect(incentivizer.connect(user)['claim(uint256)'](2)).to.be.revertedWith(
        `IncentivizerInvalidProgramError(2)`,
      )
    })

    it('reverts if paused (product)', async () => {
      await controller.mock['paused(address)'].withArgs(product.address).returns(true)
      await expect(incentivizer.connect(user)['claim(address)'](product.address)).to.be.revertedWith(`PausedError()`)
    })

    it('reverts if paused (program)', async () => {
      await controller.mock['paused(address)'].withArgs(product.address).returns(true)
      await expect(incentivizer.connect(user)['claim(uint256)'](0)).to.be.revertedWith(
        `IncentivizerProgramPausedError(0)`,
      )
    })
  })

  describe('#claimFee', async () => {
    beforeEach(async () => {
      await controller.mock.incentivizationFee.withArgs().returns(utils.parseEther('0.01'))

      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('20000'))
        .returns(true)

      const now = await currentBlockTimestamp()

      await incentivizer.connect(productOwner).create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
        grace: 7 * DAY,
      })

      await incentivizer.connect(productOwner).create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('16000'),
          taker: utils.parseEther('4000'),
        },
        start: now + HOUR,
        duration: 60 * DAY,
        grace: 7 * DAY,
      })
    })

    it('claims accrued fees', async () => {
      await token.mock.transfer.withArgs(treasury.address, utils.parseEther('300')).returns(true)

      await expect(incentivizer.connect(user).claimFee([token.address]))
        .to.emit(incentivizer, 'FeeClaim')
        .withArgs(token.address, utils.parseEther('300'))

      expect(await incentivizer.fees(token.address)).to.equal(0)
    })

    it('skips claim if zero', async () => {
      await incentivizer.connect(user).claimFee([product.address])
    })

    it('reverts if paused (protocol)', async () => {
      await controller.mock['paused()'].withArgs().returns(true)
      await expect(incentivizer.connect(user).claimFee([token.address])).to.be.revertedWith(`PausedError()`)
    })
  })

  describe('#close', async () => {
    beforeEach(async () => {
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)

      let now = await currentBlockTimestamp()

      await incentivizer.connect(productOwner).create({
        product: product.address,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
        grace: 7 * DAY,
      })

      await increase(2 * HOUR)

      now = await currentBlockTimestamp()
      const LATEST_USER_VERSION = 17
      const SHARE_DELTA = { maker: 0, taker: 0 }
      const TO_ORACLE_VERSION = {
        price: utils.parseEther('1'),
        timestamp: now,
        version: LATEST_USER_VERSION,
      }

      await incentivizer.connect(productSigner).syncAccount(user.address, SHARE_DELTA, TO_ORACLE_VERSION)

      await increase(31 * DAY)

      const LATEST_VERSION = 46

      await product.mock.latestVersion.withArgs().returns(LATEST_VERSION)
      await productProvider.mock.atVersion.withArgs(LATEST_VERSION).returns({
        price: utils.parseEther('1'),
        timestamp: now,
        version: LATEST_VERSION,
      })
    })

    it('closes correctly', async () => {
      const now = await currentBlockTimestamp()
      const LATEST_VERSION = 46

      await incentivizer.connect(productSigner).sync({
        price: utils.parseEther('1'),
        timestamp: now,
        version: LATEST_VERSION + 1,
      })

      await increase(8 * DAY)

      await token.mock.transfer.withArgs(productTreasury.address, utils.parseEther('10000')).returns(true)

      await expect(incentivizer.connect(productSigner).close(0))
        .to.emit(incentivizer, 'ProgramClosed')
        .withArgs(0, utils.parseEther('10000'))

      expect(await incentivizer.available(0)).to.equal(0)
      expect(await incentivizer.closed(0)).to.equal(true)
      expect(await incentivizer.programsForLength(product.address)).to.equal(0)
    })

    it('completes if uncompleted', async () => {
      await increase(8 * DAY)

      await token.mock.transfer.withArgs(productTreasury.address, utils.parseEther('10000')).returns(true)

      await expect(incentivizer.connect(productSigner).close(0))
        .to.emit(incentivizer, 'ProgramClosed')
        .withArgs(0, utils.parseEther('10000'))
        .to.emit(incentivizer, 'ProgramCompleted')
        .withArgs(0, 46)

      expect(await incentivizer.available(0)).to.equal(0)
      expect(await incentivizer.closed(0)).to.equal(true)
      expect(await incentivizer.versionComplete(0)).to.equal(46)
      expect(await incentivizer.programsForLength(product.address)).to.equal(0)
    })

    it('reverts when too early', async () => {
      await expect(incentivizer.connect(productSigner).close(0)).to.be.revertedWith(
        `IncentivizerProgramNotClosableError()`,
      )
    })

    it('reverts if not valid program', async () => {
      await expect(incentivizer.connect(productSigner).close(1)).to.be.revertedWith(
        `IncentivizerInvalidProgramError(1)`,
      )
    })

    it('reverts if paused', async () => {
      await controller.mock['paused(address)'].withArgs(product.address).returns(true)
      await expect(incentivizer.connect(productSigner).close(0)).to.be.revertedWith(`IncentivizerProgramPausedError(0)`)
    })
  })
})
