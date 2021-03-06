import {
  MnemonicWalletSubprovider,
  RPCSubprovider,
  Web3ProviderEngine
} from "@0xproject/subproviders";
import { Web3Wrapper } from "@0xproject/web3-wrapper";
import { BigNumber } from "@0xproject/utils";
import { ContractWrappers } from "@0xproject/contract-wrappers";

import * as ethers from "ethers";
import packageJson from "../package.json";
import { EthHelper } from "../common/eth";
import { getSprawlOrderFrom0xSignedOrder } from "../common/orders";

const config = {
  TX_DEFAULTS: { gas: 400000 },
  MNEMONIC: packageJson.config.mnemonic,
  BASE_DERIVATION_PATH: `44'/60'/0'/0`,
  NETWORK_CONFIG: {
    url: "http://127.0.0.1:8545",
    networkId: 50
  }
};

function getStartedProiderEngine() {
  const mnemonicWallet = new MnemonicWalletSubprovider({
    mnemonic: config.MNEMONIC,
    baseDerivationPath: config.BASE_DERIVATION_PATH,
    addressSearchLimit: 11
  });

  const pe = new Web3ProviderEngine();

  pe.addProvider(mnemonicWallet);
  pe.addProvider(new RPCSubprovider(config.NETWORK_CONFIG.url, 1000));
  pe.start();

  return pe;
}

async function withProviderEngine(callback) {
  const pe = getStartedProiderEngine();

  try {
    return await callback(pe);
  } finally {
    pe.stop();
  }
}

async function with0xWeb3Wrapper(callback) {
  return withProviderEngine(async pe => {
    const web3 = new Web3Wrapper(pe);
    return await callback(web3, pe);
  });
}

async function getAddressWithEth(web3, wei) {
  const addresses = await web3.getAvailableAddressesAsync();

  for (let i = addresses.length - 1; i > 0; i--) {
    const addr = addresses[i];
    const weiBalance = await web3.getBalanceInWeiAsync(addr);

    if (weiBalance.greaterThan(wei)) {
      return addr;
    }
  }

  throw new Error("No address has enough wei");
}

export async function sendEtherFromPredefinedAccounts(sendTo, wei) {
  return with0xWeb3Wrapper(async web3 => {
    const addr = await getAddressWithEth(web3, wei);

    return web3.sendTransactionAsync({
      from: addr,
      to: sendTo.toLowerCase(),
      value: new BigNumber(wei)
    });
  });
}

export async function sendWethFromPredefinedAccounts(sendTo, wei) {
  return with0xWeb3Wrapper(async (web3, pe) => {
    const addr = await getAddressWithEth(web3, wei);

    const contractWrappers = new ContractWrappers(pe, {
      networkId: config.NETWORK_CONFIG.networkId
    });

    const etherTokenAddress = contractWrappers.etherToken.getContractAddressIfExists();

    await contractWrappers.etherToken.depositAsync(
      etherTokenAddress,
      new BigNumber(wei),
      addr
    );

    return await contractWrappers.erc20Token.transferAsync(
      etherTokenAddress,
      addr,
      sendTo.toLowerCase(),
      new BigNumber(wei)
    );
  });
}

export async function doesNodeHaveEnoughEther(address) {
  return with0xWeb3Wrapper(async web3 => {
    const balance = await web3.getBalanceInWeiAsync(address.toLowerCase());
    return balance.greaterThanOrEqualTo(3e18);
  });
}

export function shouldSetupFixtureData() {
  return process.env.LOCAL_NODE;
}

export function getZrxSellOrders(nodeWallet) {
  return with0xWeb3Wrapper(async (web3, pe) => {
    const orders = [];

    const fixtureProvider = new ethers.providers.Web3Provider(pe);
    const fixtureHelper = new EthHelper(fixtureProvider);

    const addresses = await web3.getAvailableAddressesAsync();
    const sender = nodeWallet.address.toLowerCase();
    const maker = addresses[0];

    const makerAssetAddress = "0x871dd7c2b4b25e1aa18728e9d5f2af4c4e431f5c";
    const takerAssetAddress = "0x0b1ba0af832d7c05fd64161e0db78e85978e8082";
    const makerAssetAmount = new BigNumber(0.5e18);
    const takerAssetAmount = new BigNumber(1e18);

    await fixtureHelper.set0xProxyUnllimitedAllowance(makerAssetAddress, maker);

    for (let i = 0; i < 10; i++) {
      const signedOrder = await fixtureHelper.createAndSignOrder(
        maker,
        sender,
        makerAssetAddress,
        makerAssetAmount,
        takerAssetAddress,
        takerAssetAmount
      );

      orders.push(getSprawlOrderFrom0xSignedOrder(signedOrder));
    }

    return orders;
  });
}
