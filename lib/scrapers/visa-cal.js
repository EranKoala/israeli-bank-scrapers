"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _moment = _interopRequireDefault(require("moment"));
var _debug = require("../helpers/debug");
var _elementsInteractions = require("../helpers/elements-interactions");
var _fetch = require("../helpers/fetch");
var _navigation = require("../helpers/navigation");
var _storage = require("../helpers/storage");
var _transactions = require("../helpers/transactions");
var _waiting = require("../helpers/waiting");
var _transactions2 = require("../transactions");
var _baseScraperWithBrowser = require("./base-scraper-with-browser");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const LOGIN_URL = 'https://www.cal-online.co.il/';
const TRANSACTIONS_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails';
const PENDING_TRANSACTIONS_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Transactions/api/approvals/getClearanceRequests';
const SSO_AUTHORIZATION_REQUEST_ENDPOINT = 'https://connect.cal-online.co.il/col-rest/calconnect/authentication/SSO';
const InvalidPasswordMessage = 'שם המשתמש או הסיסמה שהוזנו שגויים';
const debug = (0, _debug.getDebug)('visa-cal');
var TrnTypeCode = /*#__PURE__*/function (TrnTypeCode) {
  TrnTypeCode["regular"] = "5";
  TrnTypeCode["credit"] = "6";
  TrnTypeCode["installments"] = "8";
  TrnTypeCode["standingOrder"] = "9";
  return TrnTypeCode;
}(TrnTypeCode || {});
function isPending(transaction) {
  return transaction.debCrdDate === undefined; // an arbitrary field that only appears in a completed transaction
}
function isCardTransactionDetails(result) {
  return result.result !== undefined;
}
function isCardPendingTransactionDetails(result) {
  return result.result !== undefined;
}
async function getLoginFrame(page) {
  let frame = null;
  debug('wait until login frame found');
  await (0, _waiting.waitUntil)(() => {
    frame = page.frames().find(f => f.url().includes('connect')) || null;
    return Promise.resolve(!!frame);
  }, 'wait for iframe with login form', 10000, 1000);
  if (!frame) {
    debug('failed to find login frame for 10 seconds');
    throw new Error('failed to extract login iframe');
  }
  return frame;
}
async function hasInvalidPasswordError(page) {
  const frame = await getLoginFrame(page);
  const errorFound = await (0, _elementsInteractions.elementPresentOnPage)(frame, 'div.general-error > div');
  const errorMessage = errorFound ? await (0, _elementsInteractions.pageEval)(frame, 'div.general-error > div', '', item => {
    return item.innerText;
  }) : '';
  return errorMessage === InvalidPasswordMessage;
}
async function hasChangePasswordForm(page) {
  const frame = await getLoginFrame(page);
  const errorFound = await (0, _elementsInteractions.elementPresentOnPage)(frame, '.change-password-subtitle');
  return errorFound;
}
function getPossibleLoginResults() {
  debug('return possible login results');
  const urls = {
    [_baseScraperWithBrowser.LoginResults.Success]: [/dashboard/i],
    [_baseScraperWithBrowser.LoginResults.InvalidPassword]: [async options => {
      const page = options?.page;
      if (!page) {
        return false;
      }
      return hasInvalidPasswordError(page);
    }],
    // [LoginResults.AccountBlocked]: [], // TODO add when reaching this scenario
    [_baseScraperWithBrowser.LoginResults.ChangePassword]: [async options => {
      const page = options?.page;
      if (!page) {
        return false;
      }
      return hasChangePasswordForm(page);
    }]
  };
  return urls;
}
function createLoginFields(credentials) {
  debug('create login fields for username and password');
  return [{
    selector: '[formcontrolname="userName"]',
    value: credentials.username
  }, {
    selector: '[formcontrolname="password"]',
    value: credentials.password
  }];
}
function convertParsedDataToTransactions(data, pendingData) {
  const pendingTransactions = pendingData?.result ? pendingData.result.cardsList.flatMap(card => card.authDetalisList) : [];
  const bankAccounts = data.flatMap(monthData => monthData.result.bankAccounts);
  const regularDebitDays = bankAccounts.flatMap(accounts => accounts.debitDates);
  const immediateDebitDays = bankAccounts.flatMap(accounts => accounts.immidiateDebits.debitDays);
  const completedTransactions = [...regularDebitDays, ...immediateDebitDays].flatMap(debitDate => debitDate.transactions);
  const all = [...pendingTransactions, ...completedTransactions];
  return all.map(transaction => {
    const numOfPayments = isPending(transaction) ? transaction.numberOfPayments : transaction.numOfPayments;
    const installments = numOfPayments ? {
      number: isPending(transaction) ? 1 : transaction.curPaymentNum,
      total: numOfPayments
    } : undefined;
    const date = (0, _moment.default)(transaction.trnPurchaseDate);
    let chargedAmount = isPending(transaction) ? transaction.trnAmt * -1 : transaction.amtBeforeConvAndIndex * -1;
    let originalAmount = transaction.trnAmt * -1;
    if (transaction.trnTypeCode === TrnTypeCode.credit) {
      chargedAmount = isPending(transaction) ? transaction.trnAmt : transaction.amtBeforeConvAndIndex;
      originalAmount = transaction.trnAmt;
    }
    const result = {
      identifier: !isPending(transaction) ? transaction.trnIntId : undefined,
      type: [TrnTypeCode.regular, TrnTypeCode.standingOrder].includes(transaction.trnTypeCode) ? _transactions2.TransactionTypes.Normal : _transactions2.TransactionTypes.Installments,
      status: isPending(transaction) ? _transactions2.TransactionStatuses.Pending : _transactions2.TransactionStatuses.Completed,
      date: installments ? date.add(installments.number - 1, 'month').toISOString() : date.toISOString(),
      processedDate: isPending(transaction) ? date.toISOString() : new Date(transaction.debCrdDate).toISOString(),
      originalAmount,
      originalCurrency: transaction.trnCurrencySymbol,
      chargedAmount,
      chargedCurrency: !isPending(transaction) ? transaction.debCrdCurrencySymbol : undefined,
      description: transaction.merchantName,
      memo: transaction.transTypeCommentDetails.toString(),
      category: transaction.branchCodeDesc
    };
    if (installments) {
      result.installments = installments;
    }
    return result;
  });
}
class VisaCalScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  authorization = undefined;
  openLoginPopup = async () => {
    debug('open login popup, wait until login button available');
    await (0, _elementsInteractions.waitUntilElementFound)(this.page, '#ccLoginDesktopBtn', true);
    debug('click on the login button');
    await (0, _elementsInteractions.clickButton)(this.page, '#ccLoginDesktopBtn');
    debug('get the frame that holds the login');
    const frame = await getLoginFrame(this.page);
    debug('wait until the password login tab header is available');
    await (0, _elementsInteractions.waitUntilElementFound)(frame, '#regular-login');
    debug('navigate to the password login tab');
    await (0, _elementsInteractions.clickButton)(frame, '#regular-login');
    debug('wait until the password login tab is active');
    await (0, _elementsInteractions.waitUntilElementFound)(frame, 'regular-login');
    return frame;
  };
  async getCards() {
    const initData = await (0, _waiting.waitUntil)(() => (0, _storage.getFromSessionStorage)(this.page, 'init'), 'get init data in session storage', 10000, 1000);
    if (!initData) {
      throw new Error("could not find 'init' data in session storage");
    }
    return initData?.result.cards.map(({
      cardUniqueId,
      last4Digits
    }) => ({
      cardUniqueId,
      last4Digits
    }));
  }
  async getAuthorizationHeader() {
    if (!this.authorization) {
      const authModule = await (0, _storage.getFromSessionStorage)(this.page, 'auth-module');
      if (authModule?.auth.calConnectToken) {
        return `CALAuthScheme ${authModule.auth.calConnectToken}`;
      }
      throw new Error('could not retrieve authorization header');
    }
    return this.authorization;
  }
  async getXSiteId() {
    /*
      I don't know if the constant below will change in the feature.
      If so, use the next code:
        return this.page.evaluate(() => new Ut().xSiteId);
        To get the classname search for 'xSiteId' in the page source
      class Ut {
        constructor(_e, on, yn) {
            this.store = _e,
            this.config = on,
            this.eventBusService = yn,
            this.xSiteId = "09031987-273E-2311-906C-8AF85B17C8D9",
    */
    return Promise.resolve('09031987-273E-2311-906C-8AF85B17C8D9');
  }
  getLoginOptions(credentials) {
    this.authRequestPromise = this.page.waitForRequest(SSO_AUTHORIZATION_REQUEST_ENDPOINT, {
      timeout: 10_000
    }).catch(e => {
      debug('error while waiting for the token request', e);
      return undefined;
    });
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: 'button[type="submit"]',
      possibleResults: getPossibleLoginResults(),
      checkReadiness: async () => (0, _elementsInteractions.waitUntilElementFound)(this.page, '#ccLoginDesktopBtn'),
      preAction: this.openLoginPopup,
      postAction: async () => {
        try {
          await (0, _navigation.waitForNavigation)(this.page);
          const currentUrl = await (0, _navigation.getCurrentUrl)(this.page);
          if (currentUrl.endsWith('site-tutorial')) {
            await (0, _elementsInteractions.clickButton)(this.page, 'button.btn-close');
          }
          const request = await this.authRequestPromise;
          this.authorization = request?.headers()?.authorization;
        } catch (e) {
          const currentUrl = await (0, _navigation.getCurrentUrl)(this.page);
          if (currentUrl.endsWith('dashboard')) return;
          const requiresChangePassword = await hasChangePasswordForm(this.page);
          if (requiresChangePassword) return;
          throw e;
        }
      },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36'
    };
  }
  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years').subtract(6, 'months').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = _moment.default.max(defaultStartMoment, (0, _moment.default)(startDate));
    debug(`fetch transactions starting ${startMoment.format()}`);
    const Authorization = await this.getAuthorizationHeader();
    const cards = await this.getCards();
    const xSiteId = await this.getXSiteId();
    const futureMonthsToScrape = this.options.futureMonthsToScrape ?? 1;
    const accounts = await Promise.all(cards.map(async card => {
      const finalMonthToFetchMoment = (0, _moment.default)().add(futureMonthsToScrape, 'month');
      const months = finalMonthToFetchMoment.diff(startMoment, 'months');
      const allMonthsData = [];
      debug(`fetch pending transactions for card ${card.cardUniqueId}`);
      let pendingData = await (0, _fetch.fetchPostWithinPage)(this.page, PENDING_TRANSACTIONS_REQUEST_ENDPOINT, {
        cardUniqueIDArray: [card.cardUniqueId]
      }, {
        Authorization,
        'X-Site-Id': xSiteId,
        'Content-Type': 'application/json'
      });
      debug(`fetch completed transactions for card ${card.cardUniqueId}`);
      for (let i = 0; i <= months; i += 1) {
        const month = finalMonthToFetchMoment.clone().subtract(i, 'months');
        const monthData = await (0, _fetch.fetchPostWithinPage)(this.page, TRANSACTIONS_REQUEST_ENDPOINT, {
          cardUniqueId: card.cardUniqueId,
          month: month.format('M'),
          year: month.format('YYYY')
        }, {
          Authorization,
          'X-Site-Id': xSiteId,
          'Content-Type': 'application/json'
        });
        if (monthData?.statusCode !== 1) throw new Error(`failed to fetch transactions for card ${card.last4Digits}. Message: ${monthData?.title || ''}`);
        if (!isCardTransactionDetails(monthData)) {
          throw new Error('monthData is not of type CardTransactionDetails');
        }
        allMonthsData.push(monthData);
      }
      if (pendingData?.statusCode !== 1 && pendingData?.statusCode !== 96) {
        debug(`failed to fetch pending transactions for card ${card.last4Digits}. Message: ${pendingData?.title || ''}`);
        pendingData = null;
      } else if (!isCardPendingTransactionDetails(pendingData)) {
        debug('pendingData is not of type CardTransactionDetails');
        pendingData = null;
      }
      const transactions = convertParsedDataToTransactions(allMonthsData, pendingData);
      debug('filer out old transactions');
      const txns = this.options.outputData?.enableTransactionsFilterByDate ?? true ? (0, _transactions.filterOldTransactions)(transactions, (0, _moment.default)(startDate), this.options.combineInstallments || false) : transactions;
      return {
        txns,
        accountNumber: card.last4Digits
      };
    }));
    debug('return the scraped accounts');
    debug(JSON.stringify(accounts, null, 2));
    return {
      success: true,
      accounts
    };
  }
}
var _default = exports.default = VisaCalScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfZGVidWciLCJfZWxlbWVudHNJbnRlcmFjdGlvbnMiLCJfZmV0Y2giLCJfbmF2aWdhdGlvbiIsIl9zdG9yYWdlIiwiX3RyYW5zYWN0aW9ucyIsIl93YWl0aW5nIiwiX3RyYW5zYWN0aW9uczIiLCJfYmFzZVNjcmFwZXJXaXRoQnJvd3NlciIsImUiLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsIkxPR0lOX1VSTCIsIlRSQU5TQUNUSU9OU19SRVFVRVNUX0VORFBPSU5UIiwiUEVORElOR19UUkFOU0FDVElPTlNfUkVRVUVTVF9FTkRQT0lOVCIsIlNTT19BVVRIT1JJWkFUSU9OX1JFUVVFU1RfRU5EUE9JTlQiLCJJbnZhbGlkUGFzc3dvcmRNZXNzYWdlIiwiZGVidWciLCJnZXREZWJ1ZyIsIlRyblR5cGVDb2RlIiwiaXNQZW5kaW5nIiwidHJhbnNhY3Rpb24iLCJkZWJDcmREYXRlIiwidW5kZWZpbmVkIiwiaXNDYXJkVHJhbnNhY3Rpb25EZXRhaWxzIiwicmVzdWx0IiwiaXNDYXJkUGVuZGluZ1RyYW5zYWN0aW9uRGV0YWlscyIsImdldExvZ2luRnJhbWUiLCJwYWdlIiwiZnJhbWUiLCJ3YWl0VW50aWwiLCJmcmFtZXMiLCJmaW5kIiwiZiIsInVybCIsImluY2x1ZGVzIiwiUHJvbWlzZSIsInJlc29sdmUiLCJFcnJvciIsImhhc0ludmFsaWRQYXNzd29yZEVycm9yIiwiZXJyb3JGb3VuZCIsImVsZW1lbnRQcmVzZW50T25QYWdlIiwiZXJyb3JNZXNzYWdlIiwicGFnZUV2YWwiLCJpdGVtIiwiaW5uZXJUZXh0IiwiaGFzQ2hhbmdlUGFzc3dvcmRGb3JtIiwiZ2V0UG9zc2libGVMb2dpblJlc3VsdHMiLCJ1cmxzIiwiTG9naW5SZXN1bHRzIiwiU3VjY2VzcyIsIkludmFsaWRQYXNzd29yZCIsIm9wdGlvbnMiLCJDaGFuZ2VQYXNzd29yZCIsImNyZWF0ZUxvZ2luRmllbGRzIiwiY3JlZGVudGlhbHMiLCJzZWxlY3RvciIsInZhbHVlIiwidXNlcm5hbWUiLCJwYXNzd29yZCIsImNvbnZlcnRQYXJzZWREYXRhVG9UcmFuc2FjdGlvbnMiLCJkYXRhIiwicGVuZGluZ0RhdGEiLCJwZW5kaW5nVHJhbnNhY3Rpb25zIiwiY2FyZHNMaXN0IiwiZmxhdE1hcCIsImNhcmQiLCJhdXRoRGV0YWxpc0xpc3QiLCJiYW5rQWNjb3VudHMiLCJtb250aERhdGEiLCJyZWd1bGFyRGViaXREYXlzIiwiYWNjb3VudHMiLCJkZWJpdERhdGVzIiwiaW1tZWRpYXRlRGViaXREYXlzIiwiaW1taWRpYXRlRGViaXRzIiwiZGViaXREYXlzIiwiY29tcGxldGVkVHJhbnNhY3Rpb25zIiwiZGViaXREYXRlIiwidHJhbnNhY3Rpb25zIiwiYWxsIiwibWFwIiwibnVtT2ZQYXltZW50cyIsIm51bWJlck9mUGF5bWVudHMiLCJpbnN0YWxsbWVudHMiLCJudW1iZXIiLCJjdXJQYXltZW50TnVtIiwidG90YWwiLCJkYXRlIiwibW9tZW50IiwidHJuUHVyY2hhc2VEYXRlIiwiY2hhcmdlZEFtb3VudCIsInRybkFtdCIsImFtdEJlZm9yZUNvbnZBbmRJbmRleCIsIm9yaWdpbmFsQW1vdW50IiwidHJuVHlwZUNvZGUiLCJjcmVkaXQiLCJpZGVudGlmaWVyIiwidHJuSW50SWQiLCJ0eXBlIiwicmVndWxhciIsInN0YW5kaW5nT3JkZXIiLCJUcmFuc2FjdGlvblR5cGVzIiwiTm9ybWFsIiwiSW5zdGFsbG1lbnRzIiwic3RhdHVzIiwiVHJhbnNhY3Rpb25TdGF0dXNlcyIsIlBlbmRpbmciLCJDb21wbGV0ZWQiLCJhZGQiLCJ0b0lTT1N0cmluZyIsInByb2Nlc3NlZERhdGUiLCJEYXRlIiwib3JpZ2luYWxDdXJyZW5jeSIsInRybkN1cnJlbmN5U3ltYm9sIiwiY2hhcmdlZEN1cnJlbmN5IiwiZGViQ3JkQ3VycmVuY3lTeW1ib2wiLCJkZXNjcmlwdGlvbiIsIm1lcmNoYW50TmFtZSIsIm1lbW8iLCJ0cmFuc1R5cGVDb21tZW50RGV0YWlscyIsInRvU3RyaW5nIiwiY2F0ZWdvcnkiLCJicmFuY2hDb2RlRGVzYyIsIlZpc2FDYWxTY3JhcGVyIiwiQmFzZVNjcmFwZXJXaXRoQnJvd3NlciIsImF1dGhvcml6YXRpb24iLCJvcGVuTG9naW5Qb3B1cCIsIndhaXRVbnRpbEVsZW1lbnRGb3VuZCIsImNsaWNrQnV0dG9uIiwiZ2V0Q2FyZHMiLCJpbml0RGF0YSIsImdldEZyb21TZXNzaW9uU3RvcmFnZSIsImNhcmRzIiwiY2FyZFVuaXF1ZUlkIiwibGFzdDREaWdpdHMiLCJnZXRBdXRob3JpemF0aW9uSGVhZGVyIiwiYXV0aE1vZHVsZSIsImF1dGgiLCJjYWxDb25uZWN0VG9rZW4iLCJnZXRYU2l0ZUlkIiwiZ2V0TG9naW5PcHRpb25zIiwiYXV0aFJlcXVlc3RQcm9taXNlIiwid2FpdEZvclJlcXVlc3QiLCJ0aW1lb3V0IiwiY2F0Y2giLCJsb2dpblVybCIsImZpZWxkcyIsInN1Ym1pdEJ1dHRvblNlbGVjdG9yIiwicG9zc2libGVSZXN1bHRzIiwiY2hlY2tSZWFkaW5lc3MiLCJwcmVBY3Rpb24iLCJwb3N0QWN0aW9uIiwid2FpdEZvck5hdmlnYXRpb24iLCJjdXJyZW50VXJsIiwiZ2V0Q3VycmVudFVybCIsImVuZHNXaXRoIiwicmVxdWVzdCIsImhlYWRlcnMiLCJyZXF1aXJlc0NoYW5nZVBhc3N3b3JkIiwidXNlckFnZW50IiwiZmV0Y2hEYXRhIiwiZGVmYXVsdFN0YXJ0TW9tZW50Iiwic3VidHJhY3QiLCJzdGFydERhdGUiLCJ0b0RhdGUiLCJzdGFydE1vbWVudCIsIm1heCIsImZvcm1hdCIsIkF1dGhvcml6YXRpb24iLCJ4U2l0ZUlkIiwiZnV0dXJlTW9udGhzVG9TY3JhcGUiLCJmaW5hbE1vbnRoVG9GZXRjaE1vbWVudCIsIm1vbnRocyIsImRpZmYiLCJhbGxNb250aHNEYXRhIiwiZmV0Y2hQb3N0V2l0aGluUGFnZSIsImNhcmRVbmlxdWVJREFycmF5IiwiaSIsIm1vbnRoIiwiY2xvbmUiLCJ5ZWFyIiwic3RhdHVzQ29kZSIsInRpdGxlIiwicHVzaCIsInR4bnMiLCJvdXRwdXREYXRhIiwiZW5hYmxlVHJhbnNhY3Rpb25zRmlsdGVyQnlEYXRlIiwiZmlsdGVyT2xkVHJhbnNhY3Rpb25zIiwiY29tYmluZUluc3RhbGxtZW50cyIsImFjY291bnROdW1iZXIiLCJKU09OIiwic3RyaW5naWZ5Iiwic3VjY2VzcyIsIl9kZWZhdWx0IiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zY3JhcGVycy92aXNhLWNhbC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgbW9tZW50IGZyb20gJ21vbWVudCc7XHJcbmltcG9ydCB7IHR5cGUgSFRUUFJlcXVlc3QsIHR5cGUgRnJhbWUsIHR5cGUgUGFnZSB9IGZyb20gJ3B1cHBldGVlcic7XHJcbmltcG9ydCB7IGdldERlYnVnIH0gZnJvbSAnLi4vaGVscGVycy9kZWJ1Zyc7XHJcbmltcG9ydCB7IGNsaWNrQnV0dG9uLCBlbGVtZW50UHJlc2VudE9uUGFnZSwgcGFnZUV2YWwsIHdhaXRVbnRpbEVsZW1lbnRGb3VuZCB9IGZyb20gJy4uL2hlbHBlcnMvZWxlbWVudHMtaW50ZXJhY3Rpb25zJztcclxuaW1wb3J0IHsgZmV0Y2hQb3N0V2l0aGluUGFnZSB9IGZyb20gJy4uL2hlbHBlcnMvZmV0Y2gnO1xyXG5pbXBvcnQgeyBnZXRDdXJyZW50VXJsLCB3YWl0Rm9yTmF2aWdhdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvbmF2aWdhdGlvbic7XHJcbmltcG9ydCB7IGdldEZyb21TZXNzaW9uU3RvcmFnZSB9IGZyb20gJy4uL2hlbHBlcnMvc3RvcmFnZSc7XHJcbmltcG9ydCB7IGZpbHRlck9sZFRyYW5zYWN0aW9ucyB9IGZyb20gJy4uL2hlbHBlcnMvdHJhbnNhY3Rpb25zJztcclxuaW1wb3J0IHsgd2FpdFVudGlsIH0gZnJvbSAnLi4vaGVscGVycy93YWl0aW5nJztcclxuaW1wb3J0IHsgVHJhbnNhY3Rpb25TdGF0dXNlcywgVHJhbnNhY3Rpb25UeXBlcywgdHlwZSBUcmFuc2FjdGlvbiwgdHlwZSBUcmFuc2FjdGlvbnNBY2NvdW50IH0gZnJvbSAnLi4vdHJhbnNhY3Rpb25zJztcclxuaW1wb3J0IHsgQmFzZVNjcmFwZXJXaXRoQnJvd3NlciwgTG9naW5SZXN1bHRzLCB0eXBlIExvZ2luT3B0aW9ucyB9IGZyb20gJy4vYmFzZS1zY3JhcGVyLXdpdGgtYnJvd3Nlcic7XHJcbmltcG9ydCB7IHR5cGUgU2NyYXBlclNjcmFwaW5nUmVzdWx0IH0gZnJvbSAnLi9pbnRlcmZhY2UnO1xyXG5cclxuY29uc3QgTE9HSU5fVVJMID0gJ2h0dHBzOi8vd3d3LmNhbC1vbmxpbmUuY28uaWwvJztcclxuY29uc3QgVFJBTlNBQ1RJT05TX1JFUVVFU1RfRU5EUE9JTlQgPVxyXG4gICdodHRwczovL2FwaS5jYWwtb25saW5lLmNvLmlsL1RyYW5zYWN0aW9ucy9hcGkvdHJhbnNhY3Rpb25zRGV0YWlscy9nZXRDYXJkVHJhbnNhY3Rpb25zRGV0YWlscyc7XHJcbmNvbnN0IFBFTkRJTkdfVFJBTlNBQ1RJT05TX1JFUVVFU1RfRU5EUE9JTlQgPVxyXG4gICdodHRwczovL2FwaS5jYWwtb25saW5lLmNvLmlsL1RyYW5zYWN0aW9ucy9hcGkvYXBwcm92YWxzL2dldENsZWFyYW5jZVJlcXVlc3RzJztcclxuY29uc3QgU1NPX0FVVEhPUklaQVRJT05fUkVRVUVTVF9FTkRQT0lOVCA9ICdodHRwczovL2Nvbm5lY3QuY2FsLW9ubGluZS5jby5pbC9jb2wtcmVzdC9jYWxjb25uZWN0L2F1dGhlbnRpY2F0aW9uL1NTTyc7XHJcblxyXG5jb25zdCBJbnZhbGlkUGFzc3dvcmRNZXNzYWdlID0gJ9ep150g15TXntep16rXntepINeQ15Ug15TXodeZ16HXnteUINep15TXldeW16DXlSDXqdeS15XXmdeZ150nO1xyXG5cclxuY29uc3QgZGVidWcgPSBnZXREZWJ1ZygndmlzYS1jYWwnKTtcclxuXHJcbmVudW0gVHJuVHlwZUNvZGUge1xyXG4gIHJlZ3VsYXIgPSAnNScsXHJcbiAgY3JlZGl0ID0gJzYnLFxyXG4gIGluc3RhbGxtZW50cyA9ICc4JyxcclxuICBzdGFuZGluZ09yZGVyID0gJzknLFxyXG59XHJcblxyXG5pbnRlcmZhY2UgU2NyYXBlZFRyYW5zYWN0aW9uIHtcclxuICBhbXRCZWZvcmVDb252QW5kSW5kZXg6IG51bWJlcjtcclxuICBicmFuY2hDb2RlRGVzYzogc3RyaW5nO1xyXG4gIGNhc2hBY2NNYW5hZ2VyTmFtZTogbnVsbDtcclxuICBjYXNoQWNjb3VudE1hbmFnZXI6IG51bGw7XHJcbiAgY2FzaEFjY291bnRUcm5BbXQ6IG51bWJlcjtcclxuICBjaGFyZ2VFeHRlcm5hbFRvQ2FyZENvbW1lbnQ6IHN0cmluZztcclxuICBjb21tZW50czogW107XHJcbiAgY3VyUGF5bWVudE51bTogbnVtYmVyO1xyXG4gIGRlYkNyZEN1cnJlbmN5U3ltYm9sOiBDdXJyZW5jeVN5bWJvbDtcclxuICBkZWJDcmREYXRlOiBzdHJpbmc7XHJcbiAgZGViaXRTcHJlYWRJbmQ6IGJvb2xlYW47XHJcbiAgZGlzY291bnRBbW91bnQ6IHVua25vd247XHJcbiAgZGlzY291bnRSZWFzb246IHVua25vd247XHJcbiAgaW1tZWRpYXRlQ29tbWVudHM6IFtdO1xyXG4gIGlzSW1tZWRpYXRlQ29tbWVudEluZDogYm9vbGVhbjtcclxuICBpc0ltbWVkaWF0ZUhIS0luZDogYm9vbGVhbjtcclxuICBpc01hcmdhcml0YTogYm9vbGVhbjtcclxuICBpc1NwcmVhZFBheW1lbnN0QWJyb2FkOiBib29sZWFuO1xyXG4gIGxpbmtlZENvbW1lbnRzOiBbXTtcclxuICBtZXJjaGFudEFkZHJlc3M6IHN0cmluZztcclxuICBtZXJjaGFudE5hbWU6IHN0cmluZztcclxuICBtZXJjaGFudFBob25lTm86IHN0cmluZztcclxuICBudW1PZlBheW1lbnRzOiBudW1iZXI7XHJcbiAgb25Hb2luZ1RyYW5zYWN0aW9uc0NvbW1lbnQ6IHN0cmluZztcclxuICByZWZ1bmRJbmQ6IGJvb2xlYW47XHJcbiAgcm91bmRpbmdBbW91bnQ6IHVua25vd247XHJcbiAgcm91bmRpbmdSZWFzb246IHVua25vd247XHJcbiAgdG9rZW5JbmQ6IDA7XHJcbiAgdG9rZW5OdW1iZXJQYXJ0NDogJyc7XHJcbiAgdHJhbnNDYXJkUHJlc2VudEluZDogYm9vbGVhbjtcclxuICB0cmFuc1R5cGVDb21tZW50RGV0YWlsczogW107XHJcbiAgdHJuQW10OiBudW1iZXI7XHJcbiAgdHJuQ3VycmVuY3lTeW1ib2w6IEN1cnJlbmN5U3ltYm9sO1xyXG4gIHRybkV4YWNXYXk6IG51bWJlcjtcclxuICB0cm5JbnRJZDogc3RyaW5nO1xyXG4gIHRybk51bWFyZXRvcjogbnVtYmVyO1xyXG4gIHRyblB1cmNoYXNlRGF0ZTogc3RyaW5nO1xyXG4gIHRyblR5cGU6IHN0cmluZztcclxuICB0cm5UeXBlQ29kZTogVHJuVHlwZUNvZGU7XHJcbiAgd2FsbGV0UHJvdmlkZXJDb2RlOiAwO1xyXG4gIHdhbGxldFByb3ZpZGVyRGVzYzogJyc7XHJcbiAgZWFybHlQYXltZW50SW5kOiBib29sZWFuO1xyXG59XHJcbmludGVyZmFjZSBTY3JhcGVkUGVuZGluZ1RyYW5zYWN0aW9uIHtcclxuICBtZXJjaGFudElEOiBzdHJpbmc7XHJcbiAgbWVyY2hhbnROYW1lOiBzdHJpbmc7XHJcbiAgdHJuUHVyY2hhc2VEYXRlOiBzdHJpbmc7XHJcbiAgd2FsbGV0VHJhbkluZDogbnVtYmVyO1xyXG4gIHRyYW5zYWN0aW9uc09yaWdpbjogbnVtYmVyO1xyXG4gIHRybkFtdDogbnVtYmVyO1xyXG4gIHRwYUFwcHJvdmFsQW1vdW50OiB1bmtub3duO1xyXG4gIHRybkN1cnJlbmN5U3ltYm9sOiBDdXJyZW5jeVN5bWJvbDtcclxuICB0cm5UeXBlQ29kZTogVHJuVHlwZUNvZGU7XHJcbiAgdHJuVHlwZTogc3RyaW5nO1xyXG4gIGJyYW5jaENvZGVEZXNjOiBzdHJpbmc7XHJcbiAgdHJhbnNDYXJkUHJlc2VudEluZDogYm9vbGVhbjtcclxuICBqNUluZGljYXRvcjogc3RyaW5nO1xyXG4gIG51bWJlck9mUGF5bWVudHM6IG51bWJlcjtcclxuICBmaXJzdFBheW1lbnRBbW91bnQ6IG51bWJlcjtcclxuICB0cmFuc1R5cGVDb21tZW50RGV0YWlsczogW107XHJcbn1cclxuaW50ZXJmYWNlIEluaXRSZXNwb25zZSB7XHJcbiAgcmVzdWx0OiB7XHJcbiAgICBjYXJkczoge1xyXG4gICAgICBjYXJkVW5pcXVlSWQ6IHN0cmluZztcclxuICAgICAgbGFzdDREaWdpdHM6IHN0cmluZztcclxuICAgICAgW2tleTogc3RyaW5nXTogdW5rbm93bjtcclxuICAgIH1bXTtcclxuICB9O1xyXG59XHJcbnR5cGUgQ3VycmVuY3lTeW1ib2wgPSBzdHJpbmc7XHJcbmludGVyZmFjZSBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzRXJyb3Ige1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgc3RhdHVzQ29kZTogbnVtYmVyO1xyXG59XHJcbmludGVyZmFjZSBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzIGV4dGVuZHMgQ2FyZFRyYW5zYWN0aW9uRGV0YWlsc0Vycm9yIHtcclxuICByZXN1bHQ6IHtcclxuICAgIGJhbmtBY2NvdW50czoge1xyXG4gICAgICBiYW5rQWNjb3VudE51bTogc3RyaW5nO1xyXG4gICAgICBiYW5rTmFtZTogc3RyaW5nO1xyXG4gICAgICBjaG9pY2VFeHRlcm5hbFRyYW5zYWN0aW9uczogYW55O1xyXG4gICAgICBjdXJyZW50QmFua0FjY291bnRJbmQ6IGJvb2xlYW47XHJcbiAgICAgIGRlYml0RGF0ZXM6IHtcclxuICAgICAgICBiYXNrZXRBbW91bnRDb21tZW50OiB1bmtub3duO1xyXG4gICAgICAgIGNob2ljZUhIS0RlYml0OiBudW1iZXI7XHJcbiAgICAgICAgZGF0ZTogc3RyaW5nO1xyXG4gICAgICAgIGRlYml0UmVhc29uOiB1bmtub3duO1xyXG4gICAgICAgIGZpeERlYml0QW1vdW50OiBudW1iZXI7XHJcbiAgICAgICAgZnJvbVB1cmNoYXNlRGF0ZTogc3RyaW5nO1xyXG4gICAgICAgIGlzQ2hvaWNlUmVwYWltZW50OiBib29sZWFuO1xyXG4gICAgICAgIHRvUHVyY2hhc2VEYXRlOiBzdHJpbmc7XHJcbiAgICAgICAgdG90YWxCYXNrZXRBbW91bnQ6IG51bWJlcjtcclxuICAgICAgICB0b3RhbERlYml0czoge1xyXG4gICAgICAgICAgY3VycmVuY3lTeW1ib2w6IEN1cnJlbmN5U3ltYm9sO1xyXG4gICAgICAgICAgYW1vdW50OiBudW1iZXI7XHJcbiAgICAgICAgfVtdO1xyXG4gICAgICAgIHRyYW5zYWN0aW9uczogU2NyYXBlZFRyYW5zYWN0aW9uW107XHJcbiAgICAgIH1bXTtcclxuICAgICAgaW1taWRpYXRlRGViaXRzOiB7IHRvdGFsRGViaXRzOiBbXTsgZGViaXREYXlzOiBbXSB9O1xyXG4gICAgfVtdO1xyXG4gICAgYmxvY2tlZENhcmRJbmQ6IGJvb2xlYW47XHJcbiAgfTtcclxuICBzdGF0dXNDb2RlOiAxO1xyXG4gIHN0YXR1c0Rlc2NyaXB0aW9uOiBzdHJpbmc7XHJcbiAgc3RhdHVzVGl0bGU6IHN0cmluZztcclxufVxyXG5pbnRlcmZhY2UgQ2FyZFBlbmRpbmdUcmFuc2FjdGlvbkRldGFpbHMgZXh0ZW5kcyBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzRXJyb3Ige1xyXG4gIHJlc3VsdDoge1xyXG4gICAgY2FyZHNMaXN0OiB7XHJcbiAgICAgIGNhcmRVbmlxdWVJRDogc3RyaW5nO1xyXG4gICAgICBhdXRoRGV0YWxpc0xpc3Q6IFNjcmFwZWRQZW5kaW5nVHJhbnNhY3Rpb25bXTtcclxuICAgIH1bXTtcclxuICB9O1xyXG4gIHN0YXR1c0NvZGU6IDE7XHJcbiAgc3RhdHVzRGVzY3JpcHRpb246IHN0cmluZztcclxuICBzdGF0dXNUaXRsZTogc3RyaW5nO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc1BlbmRpbmcoXHJcbiAgdHJhbnNhY3Rpb246IFNjcmFwZWRUcmFuc2FjdGlvbiB8IFNjcmFwZWRQZW5kaW5nVHJhbnNhY3Rpb24sXHJcbik6IHRyYW5zYWN0aW9uIGlzIFNjcmFwZWRQZW5kaW5nVHJhbnNhY3Rpb24ge1xyXG4gIHJldHVybiAodHJhbnNhY3Rpb24gYXMgU2NyYXBlZFRyYW5zYWN0aW9uKS5kZWJDcmREYXRlID09PSB1bmRlZmluZWQ7IC8vIGFuIGFyYml0cmFyeSBmaWVsZCB0aGF0IG9ubHkgYXBwZWFycyBpbiBhIGNvbXBsZXRlZCB0cmFuc2FjdGlvblxyXG59XHJcblxyXG5mdW5jdGlvbiBpc0NhcmRUcmFuc2FjdGlvbkRldGFpbHMoXHJcbiAgcmVzdWx0OiBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzIHwgQ2FyZFRyYW5zYWN0aW9uRGV0YWlsc0Vycm9yLFxyXG4pOiByZXN1bHQgaXMgQ2FyZFRyYW5zYWN0aW9uRGV0YWlscyB7XHJcbiAgcmV0dXJuIChyZXN1bHQgYXMgQ2FyZFRyYW5zYWN0aW9uRGV0YWlscykucmVzdWx0ICE9PSB1bmRlZmluZWQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzQ2FyZFBlbmRpbmdUcmFuc2FjdGlvbkRldGFpbHMoXHJcbiAgcmVzdWx0OiBDYXJkUGVuZGluZ1RyYW5zYWN0aW9uRGV0YWlscyB8IENhcmRUcmFuc2FjdGlvbkRldGFpbHNFcnJvcixcclxuKTogcmVzdWx0IGlzIENhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzIHtcclxuICByZXR1cm4gKHJlc3VsdCBhcyBDYXJkUGVuZGluZ1RyYW5zYWN0aW9uRGV0YWlscykucmVzdWx0ICE9PSB1bmRlZmluZWQ7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGdldExvZ2luRnJhbWUocGFnZTogUGFnZSkge1xyXG4gIGxldCBmcmFtZTogRnJhbWUgfCBudWxsID0gbnVsbDtcclxuICBkZWJ1Zygnd2FpdCB1bnRpbCBsb2dpbiBmcmFtZSBmb3VuZCcpO1xyXG4gIGF3YWl0IHdhaXRVbnRpbChcclxuICAgICgpID0+IHtcclxuICAgICAgZnJhbWUgPSBwYWdlLmZyYW1lcygpLmZpbmQoZiA9PiBmLnVybCgpLmluY2x1ZGVzKCdjb25uZWN0JykpIHx8IG51bGw7XHJcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoISFmcmFtZSk7XHJcbiAgICB9LFxyXG4gICAgJ3dhaXQgZm9yIGlmcmFtZSB3aXRoIGxvZ2luIGZvcm0nLFxyXG4gICAgMTAwMDAsXHJcbiAgICAxMDAwLFxyXG4gICk7XHJcblxyXG4gIGlmICghZnJhbWUpIHtcclxuICAgIGRlYnVnKCdmYWlsZWQgdG8gZmluZCBsb2dpbiBmcmFtZSBmb3IgMTAgc2Vjb25kcycpO1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKCdmYWlsZWQgdG8gZXh0cmFjdCBsb2dpbiBpZnJhbWUnKTtcclxuICB9XHJcblxyXG4gIHJldHVybiBmcmFtZTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gaGFzSW52YWxpZFBhc3N3b3JkRXJyb3IocGFnZTogUGFnZSkge1xyXG4gIGNvbnN0IGZyYW1lID0gYXdhaXQgZ2V0TG9naW5GcmFtZShwYWdlKTtcclxuICBjb25zdCBlcnJvckZvdW5kID0gYXdhaXQgZWxlbWVudFByZXNlbnRPblBhZ2UoZnJhbWUsICdkaXYuZ2VuZXJhbC1lcnJvciA+IGRpdicpO1xyXG4gIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yRm91bmRcclxuICAgID8gYXdhaXQgcGFnZUV2YWwoZnJhbWUsICdkaXYuZ2VuZXJhbC1lcnJvciA+IGRpdicsICcnLCBpdGVtID0+IHtcclxuICAgICAgICByZXR1cm4gKGl0ZW0gYXMgSFRNTERpdkVsZW1lbnQpLmlubmVyVGV4dDtcclxuICAgICAgfSlcclxuICAgIDogJyc7XHJcbiAgcmV0dXJuIGVycm9yTWVzc2FnZSA9PT0gSW52YWxpZFBhc3N3b3JkTWVzc2FnZTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gaGFzQ2hhbmdlUGFzc3dvcmRGb3JtKHBhZ2U6IFBhZ2UpIHtcclxuICBjb25zdCBmcmFtZSA9IGF3YWl0IGdldExvZ2luRnJhbWUocGFnZSk7XHJcbiAgY29uc3QgZXJyb3JGb3VuZCA9IGF3YWl0IGVsZW1lbnRQcmVzZW50T25QYWdlKGZyYW1lLCAnLmNoYW5nZS1wYXNzd29yZC1zdWJ0aXRsZScpO1xyXG4gIHJldHVybiBlcnJvckZvdW5kO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRQb3NzaWJsZUxvZ2luUmVzdWx0cygpIHtcclxuICBkZWJ1ZygncmV0dXJuIHBvc3NpYmxlIGxvZ2luIHJlc3VsdHMnKTtcclxuICBjb25zdCB1cmxzOiBMb2dpbk9wdGlvbnNbJ3Bvc3NpYmxlUmVzdWx0cyddID0ge1xyXG4gICAgW0xvZ2luUmVzdWx0cy5TdWNjZXNzXTogWy9kYXNoYm9hcmQvaV0sXHJcbiAgICBbTG9naW5SZXN1bHRzLkludmFsaWRQYXNzd29yZF06IFtcclxuICAgICAgYXN5bmMgKG9wdGlvbnM/OiB7IHBhZ2U/OiBQYWdlIH0pID0+IHtcclxuICAgICAgICBjb25zdCBwYWdlID0gb3B0aW9ucz8ucGFnZTtcclxuICAgICAgICBpZiAoIXBhZ2UpIHtcclxuICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIGhhc0ludmFsaWRQYXNzd29yZEVycm9yKHBhZ2UpO1xyXG4gICAgICB9LFxyXG4gICAgXSxcclxuICAgIC8vIFtMb2dpblJlc3VsdHMuQWNjb3VudEJsb2NrZWRdOiBbXSwgLy8gVE9ETyBhZGQgd2hlbiByZWFjaGluZyB0aGlzIHNjZW5hcmlvXHJcbiAgICBbTG9naW5SZXN1bHRzLkNoYW5nZVBhc3N3b3JkXTogW1xyXG4gICAgICBhc3luYyAob3B0aW9ucz86IHsgcGFnZT86IFBhZ2UgfSkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHBhZ2UgPSBvcHRpb25zPy5wYWdlO1xyXG4gICAgICAgIGlmICghcGFnZSkge1xyXG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gaGFzQ2hhbmdlUGFzc3dvcmRGb3JtKHBhZ2UpO1xyXG4gICAgICB9LFxyXG4gICAgXSxcclxuICB9O1xyXG4gIHJldHVybiB1cmxzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVMb2dpbkZpZWxkcyhjcmVkZW50aWFsczogU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMpIHtcclxuICBkZWJ1ZygnY3JlYXRlIGxvZ2luIGZpZWxkcyBmb3IgdXNlcm5hbWUgYW5kIHBhc3N3b3JkJyk7XHJcbiAgcmV0dXJuIFtcclxuICAgIHsgc2VsZWN0b3I6ICdbZm9ybWNvbnRyb2xuYW1lPVwidXNlck5hbWVcIl0nLCB2YWx1ZTogY3JlZGVudGlhbHMudXNlcm5hbWUgfSxcclxuICAgIHsgc2VsZWN0b3I6ICdbZm9ybWNvbnRyb2xuYW1lPVwicGFzc3dvcmRcIl0nLCB2YWx1ZTogY3JlZGVudGlhbHMucGFzc3dvcmQgfSxcclxuICBdO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb252ZXJ0UGFyc2VkRGF0YVRvVHJhbnNhY3Rpb25zKFxyXG4gIGRhdGE6IENhcmRUcmFuc2FjdGlvbkRldGFpbHNbXSxcclxuICBwZW5kaW5nRGF0YT86IENhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzIHwgbnVsbCxcclxuKTogVHJhbnNhY3Rpb25bXSB7XHJcbiAgY29uc3QgcGVuZGluZ1RyYW5zYWN0aW9ucyA9IHBlbmRpbmdEYXRhPy5yZXN1bHRcclxuICAgID8gcGVuZGluZ0RhdGEucmVzdWx0LmNhcmRzTGlzdC5mbGF0TWFwKGNhcmQgPT4gY2FyZC5hdXRoRGV0YWxpc0xpc3QpXHJcbiAgICA6IFtdO1xyXG5cclxuICBjb25zdCBiYW5rQWNjb3VudHMgPSBkYXRhLmZsYXRNYXAobW9udGhEYXRhID0+IG1vbnRoRGF0YS5yZXN1bHQuYmFua0FjY291bnRzKTtcclxuICBjb25zdCByZWd1bGFyRGViaXREYXlzID0gYmFua0FjY291bnRzLmZsYXRNYXAoYWNjb3VudHMgPT4gYWNjb3VudHMuZGViaXREYXRlcyk7XHJcbiAgY29uc3QgaW1tZWRpYXRlRGViaXREYXlzID0gYmFua0FjY291bnRzLmZsYXRNYXAoYWNjb3VudHMgPT4gYWNjb3VudHMuaW1taWRpYXRlRGViaXRzLmRlYml0RGF5cyk7XHJcbiAgY29uc3QgY29tcGxldGVkVHJhbnNhY3Rpb25zID0gWy4uLnJlZ3VsYXJEZWJpdERheXMsIC4uLmltbWVkaWF0ZURlYml0RGF5c10uZmxhdE1hcChcclxuICAgIGRlYml0RGF0ZSA9PiBkZWJpdERhdGUudHJhbnNhY3Rpb25zLFxyXG4gICk7XHJcblxyXG4gIGNvbnN0IGFsbDogKFNjcmFwZWRUcmFuc2FjdGlvbiB8IFNjcmFwZWRQZW5kaW5nVHJhbnNhY3Rpb24pW10gPSBbLi4ucGVuZGluZ1RyYW5zYWN0aW9ucywgLi4uY29tcGxldGVkVHJhbnNhY3Rpb25zXTtcclxuXHJcbiAgcmV0dXJuIGFsbC5tYXAodHJhbnNhY3Rpb24gPT4ge1xyXG4gICAgY29uc3QgbnVtT2ZQYXltZW50cyA9IGlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyB0cmFuc2FjdGlvbi5udW1iZXJPZlBheW1lbnRzIDogdHJhbnNhY3Rpb24ubnVtT2ZQYXltZW50cztcclxuICAgIGNvbnN0IGluc3RhbGxtZW50cyA9IG51bU9mUGF5bWVudHNcclxuICAgICAgPyB7XHJcbiAgICAgICAgICBudW1iZXI6IGlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyAxIDogdHJhbnNhY3Rpb24uY3VyUGF5bWVudE51bSxcclxuICAgICAgICAgIHRvdGFsOiBudW1PZlBheW1lbnRzLFxyXG4gICAgICAgIH1cclxuICAgICAgOiB1bmRlZmluZWQ7XHJcblxyXG4gICAgY29uc3QgZGF0ZSA9IG1vbWVudCh0cmFuc2FjdGlvbi50cm5QdXJjaGFzZURhdGUpO1xyXG5cclxuICAgIGxldCBjaGFyZ2VkQW1vdW50ID0gaXNQZW5kaW5nKHRyYW5zYWN0aW9uKSA/IHRyYW5zYWN0aW9uLnRybkFtdCAqIC0xIDogdHJhbnNhY3Rpb24uYW10QmVmb3JlQ29udkFuZEluZGV4ICogLTE7XHJcbiAgICBsZXQgb3JpZ2luYWxBbW91bnQgPSB0cmFuc2FjdGlvbi50cm5BbXQgKiAtMTtcclxuXHJcbiAgICBpZiAodHJhbnNhY3Rpb24udHJuVHlwZUNvZGUgPT09IFRyblR5cGVDb2RlLmNyZWRpdCkge1xyXG4gICAgICBjaGFyZ2VkQW1vdW50ID0gaXNQZW5kaW5nKHRyYW5zYWN0aW9uKSA/IHRyYW5zYWN0aW9uLnRybkFtdCA6IHRyYW5zYWN0aW9uLmFtdEJlZm9yZUNvbnZBbmRJbmRleDtcclxuICAgICAgb3JpZ2luYWxBbW91bnQgPSB0cmFuc2FjdGlvbi50cm5BbXQ7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVzdWx0OiBUcmFuc2FjdGlvbiA9IHtcclxuICAgICAgaWRlbnRpZmllcjogIWlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyB0cmFuc2FjdGlvbi50cm5JbnRJZCA6IHVuZGVmaW5lZCxcclxuICAgICAgdHlwZTogW1RyblR5cGVDb2RlLnJlZ3VsYXIsIFRyblR5cGVDb2RlLnN0YW5kaW5nT3JkZXJdLmluY2x1ZGVzKHRyYW5zYWN0aW9uLnRyblR5cGVDb2RlKVxyXG4gICAgICAgID8gVHJhbnNhY3Rpb25UeXBlcy5Ob3JtYWxcclxuICAgICAgICA6IFRyYW5zYWN0aW9uVHlwZXMuSW5zdGFsbG1lbnRzLFxyXG4gICAgICBzdGF0dXM6IGlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyBUcmFuc2FjdGlvblN0YXR1c2VzLlBlbmRpbmcgOiBUcmFuc2FjdGlvblN0YXR1c2VzLkNvbXBsZXRlZCxcclxuICAgICAgZGF0ZTogaW5zdGFsbG1lbnRzID8gZGF0ZS5hZGQoaW5zdGFsbG1lbnRzLm51bWJlciAtIDEsICdtb250aCcpLnRvSVNPU3RyaW5nKCkgOiBkYXRlLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgIHByb2Nlc3NlZERhdGU6IGlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyBkYXRlLnRvSVNPU3RyaW5nKCkgOiBuZXcgRGF0ZSh0cmFuc2FjdGlvbi5kZWJDcmREYXRlKS50b0lTT1N0cmluZygpLFxyXG4gICAgICBvcmlnaW5hbEFtb3VudCxcclxuICAgICAgb3JpZ2luYWxDdXJyZW5jeTogdHJhbnNhY3Rpb24udHJuQ3VycmVuY3lTeW1ib2wsXHJcbiAgICAgIGNoYXJnZWRBbW91bnQsXHJcbiAgICAgIGNoYXJnZWRDdXJyZW5jeTogIWlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyB0cmFuc2FjdGlvbi5kZWJDcmRDdXJyZW5jeVN5bWJvbCA6IHVuZGVmaW5lZCxcclxuICAgICAgZGVzY3JpcHRpb246IHRyYW5zYWN0aW9uLm1lcmNoYW50TmFtZSxcclxuICAgICAgbWVtbzogdHJhbnNhY3Rpb24udHJhbnNUeXBlQ29tbWVudERldGFpbHMudG9TdHJpbmcoKSxcclxuICAgICAgY2F0ZWdvcnk6IHRyYW5zYWN0aW9uLmJyYW5jaENvZGVEZXNjLFxyXG4gICAgfTtcclxuXHJcbiAgICBpZiAoaW5zdGFsbG1lbnRzKSB7XHJcbiAgICAgIHJlc3VsdC5pbnN0YWxsbWVudHMgPSBpbnN0YWxsbWVudHM7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9KTtcclxufVxyXG5cclxudHlwZSBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscyA9IHsgdXNlcm5hbWU6IHN0cmluZzsgcGFzc3dvcmQ6IHN0cmluZyB9O1xyXG5cclxuY2xhc3MgVmlzYUNhbFNjcmFwZXIgZXh0ZW5kcyBCYXNlU2NyYXBlcldpdGhCcm93c2VyPFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzPiB7XHJcbiAgcHJpdmF0ZSBhdXRob3JpemF0aW9uOiBzdHJpbmcgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XHJcblxyXG4gIHByaXZhdGUgYXV0aFJlcXVlc3RQcm9taXNlOiBQcm9taXNlPEhUVFBSZXF1ZXN0IHwgdW5kZWZpbmVkPiB8IHVuZGVmaW5lZDtcclxuXHJcbiAgb3BlbkxvZ2luUG9wdXAgPSBhc3luYyAoKSA9PiB7XHJcbiAgICBkZWJ1Zygnb3BlbiBsb2dpbiBwb3B1cCwgd2FpdCB1bnRpbCBsb2dpbiBidXR0b24gYXZhaWxhYmxlJyk7XHJcbiAgICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQodGhpcy5wYWdlLCAnI2NjTG9naW5EZXNrdG9wQnRuJywgdHJ1ZSk7XHJcbiAgICBkZWJ1ZygnY2xpY2sgb24gdGhlIGxvZ2luIGJ1dHRvbicpO1xyXG4gICAgYXdhaXQgY2xpY2tCdXR0b24odGhpcy5wYWdlLCAnI2NjTG9naW5EZXNrdG9wQnRuJyk7XHJcbiAgICBkZWJ1ZygnZ2V0IHRoZSBmcmFtZSB0aGF0IGhvbGRzIHRoZSBsb2dpbicpO1xyXG4gICAgY29uc3QgZnJhbWUgPSBhd2FpdCBnZXRMb2dpbkZyYW1lKHRoaXMucGFnZSk7XHJcbiAgICBkZWJ1Zygnd2FpdCB1bnRpbCB0aGUgcGFzc3dvcmQgbG9naW4gdGFiIGhlYWRlciBpcyBhdmFpbGFibGUnKTtcclxuICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChmcmFtZSwgJyNyZWd1bGFyLWxvZ2luJyk7XHJcbiAgICBkZWJ1ZygnbmF2aWdhdGUgdG8gdGhlIHBhc3N3b3JkIGxvZ2luIHRhYicpO1xyXG4gICAgYXdhaXQgY2xpY2tCdXR0b24oZnJhbWUsICcjcmVndWxhci1sb2dpbicpO1xyXG4gICAgZGVidWcoJ3dhaXQgdW50aWwgdGhlIHBhc3N3b3JkIGxvZ2luIHRhYiBpcyBhY3RpdmUnKTtcclxuICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChmcmFtZSwgJ3JlZ3VsYXItbG9naW4nKTtcclxuXHJcbiAgICByZXR1cm4gZnJhbWU7XHJcbiAgfTtcclxuXHJcbiAgYXN5bmMgZ2V0Q2FyZHMoKSB7XHJcbiAgICBjb25zdCBpbml0RGF0YSA9IGF3YWl0IHdhaXRVbnRpbChcclxuICAgICAgKCkgPT4gZ2V0RnJvbVNlc3Npb25TdG9yYWdlPEluaXRSZXNwb25zZT4odGhpcy5wYWdlLCAnaW5pdCcpLFxyXG4gICAgICAnZ2V0IGluaXQgZGF0YSBpbiBzZXNzaW9uIHN0b3JhZ2UnLFxyXG4gICAgICAxMDAwMCxcclxuICAgICAgMTAwMCxcclxuICAgICk7XHJcbiAgICBpZiAoIWluaXREYXRhKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImNvdWxkIG5vdCBmaW5kICdpbml0JyBkYXRhIGluIHNlc3Npb24gc3RvcmFnZVwiKTtcclxuICAgIH1cclxuICAgIHJldHVybiBpbml0RGF0YT8ucmVzdWx0LmNhcmRzLm1hcCgoeyBjYXJkVW5pcXVlSWQsIGxhc3Q0RGlnaXRzIH0pID0+ICh7IGNhcmRVbmlxdWVJZCwgbGFzdDREaWdpdHMgfSkpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0QXV0aG9yaXphdGlvbkhlYWRlcigpIHtcclxuICAgIGlmICghdGhpcy5hdXRob3JpemF0aW9uKSB7XHJcbiAgICAgIGNvbnN0IGF1dGhNb2R1bGUgPSBhd2FpdCBnZXRGcm9tU2Vzc2lvblN0b3JhZ2U8eyBhdXRoOiB7IGNhbENvbm5lY3RUb2tlbjogc3RyaW5nIHwgbnVsbCB9IH0+KFxyXG4gICAgICAgIHRoaXMucGFnZSxcclxuICAgICAgICAnYXV0aC1tb2R1bGUnLFxyXG4gICAgICApO1xyXG4gICAgICBpZiAoYXV0aE1vZHVsZT8uYXV0aC5jYWxDb25uZWN0VG9rZW4pIHtcclxuICAgICAgICByZXR1cm4gYENBTEF1dGhTY2hlbWUgJHthdXRoTW9kdWxlLmF1dGguY2FsQ29ubmVjdFRva2VufWA7XHJcbiAgICAgIH1cclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdjb3VsZCBub3QgcmV0cmlldmUgYXV0aG9yaXphdGlvbiBoZWFkZXInKTtcclxuICAgIH1cclxuICAgIHJldHVybiB0aGlzLmF1dGhvcml6YXRpb247XHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRYU2l0ZUlkKCkge1xyXG4gICAgLypcclxuICAgICAgSSBkb24ndCBrbm93IGlmIHRoZSBjb25zdGFudCBiZWxvdyB3aWxsIGNoYW5nZSBpbiB0aGUgZmVhdHVyZS5cclxuICAgICAgSWYgc28sIHVzZSB0aGUgbmV4dCBjb2RlOlxyXG5cclxuICAgICAgcmV0dXJuIHRoaXMucGFnZS5ldmFsdWF0ZSgoKSA9PiBuZXcgVXQoKS54U2l0ZUlkKTtcclxuXHJcbiAgICAgIFRvIGdldCB0aGUgY2xhc3NuYW1lIHNlYXJjaCBmb3IgJ3hTaXRlSWQnIGluIHRoZSBwYWdlIHNvdXJjZVxyXG4gICAgICBjbGFzcyBVdCB7XHJcbiAgICAgICAgY29uc3RydWN0b3IoX2UsIG9uLCB5bikge1xyXG4gICAgICAgICAgICB0aGlzLnN0b3JlID0gX2UsXHJcbiAgICAgICAgICAgIHRoaXMuY29uZmlnID0gb24sXHJcbiAgICAgICAgICAgIHRoaXMuZXZlbnRCdXNTZXJ2aWNlID0geW4sXHJcbiAgICAgICAgICAgIHRoaXMueFNpdGVJZCA9IFwiMDkwMzE5ODctMjczRS0yMzExLTkwNkMtOEFGODVCMTdDOEQ5XCIsXHJcbiAgICAqL1xyXG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgnMDkwMzE5ODctMjczRS0yMzExLTkwNkMtOEFGODVCMTdDOEQ5Jyk7XHJcbiAgfVxyXG5cclxuICBnZXRMb2dpbk9wdGlvbnMoY3JlZGVudGlhbHM6IFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzKTogTG9naW5PcHRpb25zIHtcclxuICAgIHRoaXMuYXV0aFJlcXVlc3RQcm9taXNlID0gdGhpcy5wYWdlXHJcbiAgICAgIC53YWl0Rm9yUmVxdWVzdChTU09fQVVUSE9SSVpBVElPTl9SRVFVRVNUX0VORFBPSU5ULCB7IHRpbWVvdXQ6IDEwXzAwMCB9KVxyXG4gICAgICAuY2F0Y2goZSA9PiB7XHJcbiAgICAgICAgZGVidWcoJ2Vycm9yIHdoaWxlIHdhaXRpbmcgZm9yIHRoZSB0b2tlbiByZXF1ZXN0JywgZSk7XHJcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgICAgfSk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBsb2dpblVybDogYCR7TE9HSU5fVVJMfWAsXHJcbiAgICAgIGZpZWxkczogY3JlYXRlTG9naW5GaWVsZHMoY3JlZGVudGlhbHMpLFxyXG4gICAgICBzdWJtaXRCdXR0b25TZWxlY3RvcjogJ2J1dHRvblt0eXBlPVwic3VibWl0XCJdJyxcclxuICAgICAgcG9zc2libGVSZXN1bHRzOiBnZXRQb3NzaWJsZUxvZ2luUmVzdWx0cygpLFxyXG4gICAgICBjaGVja1JlYWRpbmVzczogYXN5bmMgKCkgPT4gd2FpdFVudGlsRWxlbWVudEZvdW5kKHRoaXMucGFnZSwgJyNjY0xvZ2luRGVza3RvcEJ0bicpLFxyXG4gICAgICBwcmVBY3Rpb246IHRoaXMub3BlbkxvZ2luUG9wdXAsXHJcbiAgICAgIHBvc3RBY3Rpb246IGFzeW5jICgpID0+IHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgYXdhaXQgd2FpdEZvck5hdmlnYXRpb24odGhpcy5wYWdlKTtcclxuICAgICAgICAgIGNvbnN0IGN1cnJlbnRVcmwgPSBhd2FpdCBnZXRDdXJyZW50VXJsKHRoaXMucGFnZSk7XHJcbiAgICAgICAgICBpZiAoY3VycmVudFVybC5lbmRzV2l0aCgnc2l0ZS10dXRvcmlhbCcpKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGNsaWNrQnV0dG9uKHRoaXMucGFnZSwgJ2J1dHRvbi5idG4tY2xvc2UnKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLmF1dGhSZXF1ZXN0UHJvbWlzZTtcclxuICAgICAgICAgIHRoaXMuYXV0aG9yaXphdGlvbiA9IHJlcXVlc3Q/LmhlYWRlcnMoKT8uYXV0aG9yaXphdGlvbjtcclxuICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICBjb25zdCBjdXJyZW50VXJsID0gYXdhaXQgZ2V0Q3VycmVudFVybCh0aGlzLnBhZ2UpO1xyXG4gICAgICAgICAgaWYgKGN1cnJlbnRVcmwuZW5kc1dpdGgoJ2Rhc2hib2FyZCcpKSByZXR1cm47XHJcbiAgICAgICAgICBjb25zdCByZXF1aXJlc0NoYW5nZVBhc3N3b3JkID0gYXdhaXQgaGFzQ2hhbmdlUGFzc3dvcmRGb3JtKHRoaXMucGFnZSk7XHJcbiAgICAgICAgICBpZiAocmVxdWlyZXNDaGFuZ2VQYXNzd29yZCkgcmV0dXJuO1xyXG4gICAgICAgICAgdGhyb3cgZTtcclxuICAgICAgICB9XHJcbiAgICAgIH0sXHJcbiAgICAgIHVzZXJBZ2VudDpcclxuICAgICAgICAnTW96aWxsYS81LjAgKFgxMTsgTGludXggeDg2XzY0KSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBDaHJvbWUvNzguMC4zOTA0LjEwOCBTYWZhcmkvNTM3LjM2JyxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBhc3luYyBmZXRjaERhdGEoKTogUHJvbWlzZTxTY3JhcGVyU2NyYXBpbmdSZXN1bHQ+IHtcclxuICAgIGNvbnN0IGRlZmF1bHRTdGFydE1vbWVudCA9IG1vbWVudCgpLnN1YnRyYWN0KDEsICd5ZWFycycpLnN1YnRyYWN0KDYsICdtb250aHMnKS5hZGQoMSwgJ2RheScpO1xyXG4gICAgY29uc3Qgc3RhcnREYXRlID0gdGhpcy5vcHRpb25zLnN0YXJ0RGF0ZSB8fCBkZWZhdWx0U3RhcnRNb21lbnQudG9EYXRlKCk7XHJcbiAgICBjb25zdCBzdGFydE1vbWVudCA9IG1vbWVudC5tYXgoZGVmYXVsdFN0YXJ0TW9tZW50LCBtb21lbnQoc3RhcnREYXRlKSk7XHJcbiAgICBkZWJ1ZyhgZmV0Y2ggdHJhbnNhY3Rpb25zIHN0YXJ0aW5nICR7c3RhcnRNb21lbnQuZm9ybWF0KCl9YCk7XHJcblxyXG4gICAgY29uc3QgQXV0aG9yaXphdGlvbiA9IGF3YWl0IHRoaXMuZ2V0QXV0aG9yaXphdGlvbkhlYWRlcigpO1xyXG4gICAgY29uc3QgY2FyZHMgPSBhd2FpdCB0aGlzLmdldENhcmRzKCk7XHJcbiAgICBjb25zdCB4U2l0ZUlkID0gYXdhaXQgdGhpcy5nZXRYU2l0ZUlkKCk7XHJcbiAgICBjb25zdCBmdXR1cmVNb250aHNUb1NjcmFwZSA9IHRoaXMub3B0aW9ucy5mdXR1cmVNb250aHNUb1NjcmFwZSA/PyAxO1xyXG5cclxuICAgIGNvbnN0IGFjY291bnRzID0gYXdhaXQgUHJvbWlzZS5hbGwoXHJcbiAgICAgIGNhcmRzLm1hcChhc3luYyBjYXJkID0+IHtcclxuICAgICAgICBjb25zdCBmaW5hbE1vbnRoVG9GZXRjaE1vbWVudCA9IG1vbWVudCgpLmFkZChmdXR1cmVNb250aHNUb1NjcmFwZSwgJ21vbnRoJyk7XHJcbiAgICAgICAgY29uc3QgbW9udGhzID0gZmluYWxNb250aFRvRmV0Y2hNb21lbnQuZGlmZihzdGFydE1vbWVudCwgJ21vbnRocycpO1xyXG5cclxuICAgICAgICBjb25zdCBhbGxNb250aHNEYXRhOiBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzW10gPSBbXTtcclxuXHJcbiAgICAgICAgZGVidWcoYGZldGNoIHBlbmRpbmcgdHJhbnNhY3Rpb25zIGZvciBjYXJkICR7Y2FyZC5jYXJkVW5pcXVlSWR9YCk7XHJcbiAgICAgICAgbGV0IHBlbmRpbmdEYXRhID0gYXdhaXQgZmV0Y2hQb3N0V2l0aGluUGFnZTxDYXJkUGVuZGluZ1RyYW5zYWN0aW9uRGV0YWlscyB8IENhcmRUcmFuc2FjdGlvbkRldGFpbHNFcnJvcj4oXHJcbiAgICAgICAgICB0aGlzLnBhZ2UsXHJcbiAgICAgICAgICBQRU5ESU5HX1RSQU5TQUNUSU9OU19SRVFVRVNUX0VORFBPSU5ULFxyXG4gICAgICAgICAgeyBjYXJkVW5pcXVlSURBcnJheTogW2NhcmQuY2FyZFVuaXF1ZUlkXSB9LFxyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBBdXRob3JpemF0aW9uLFxyXG4gICAgICAgICAgICAnWC1TaXRlLUlkJzogeFNpdGVJZCxcclxuICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgICAgZGVidWcoYGZldGNoIGNvbXBsZXRlZCB0cmFuc2FjdGlvbnMgZm9yIGNhcmQgJHtjYXJkLmNhcmRVbmlxdWVJZH1gKTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSBtb250aHM7IGkgKz0gMSkge1xyXG4gICAgICAgICAgY29uc3QgbW9udGggPSBmaW5hbE1vbnRoVG9GZXRjaE1vbWVudC5jbG9uZSgpLnN1YnRyYWN0KGksICdtb250aHMnKTtcclxuICAgICAgICAgIGNvbnN0IG1vbnRoRGF0YSA9IGF3YWl0IGZldGNoUG9zdFdpdGhpblBhZ2U8Q2FyZFRyYW5zYWN0aW9uRGV0YWlscyB8IENhcmRUcmFuc2FjdGlvbkRldGFpbHNFcnJvcj4oXHJcbiAgICAgICAgICAgIHRoaXMucGFnZSxcclxuICAgICAgICAgICAgVFJBTlNBQ1RJT05TX1JFUVVFU1RfRU5EUE9JTlQsXHJcbiAgICAgICAgICAgIHsgY2FyZFVuaXF1ZUlkOiBjYXJkLmNhcmRVbmlxdWVJZCwgbW9udGg6IG1vbnRoLmZvcm1hdCgnTScpLCB5ZWFyOiBtb250aC5mb3JtYXQoJ1lZWVknKSB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgQXV0aG9yaXphdGlvbixcclxuICAgICAgICAgICAgICAnWC1TaXRlLUlkJzogeFNpdGVJZCxcclxuICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgKTtcclxuXHJcbiAgICAgICAgICBpZiAobW9udGhEYXRhPy5zdGF0dXNDb2RlICE9PSAxKVxyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXHJcbiAgICAgICAgICAgICAgYGZhaWxlZCB0byBmZXRjaCB0cmFuc2FjdGlvbnMgZm9yIGNhcmQgJHtjYXJkLmxhc3Q0RGlnaXRzfS4gTWVzc2FnZTogJHttb250aERhdGE/LnRpdGxlIHx8ICcnfWAsXHJcbiAgICAgICAgICAgICk7XHJcblxyXG4gICAgICAgICAgaWYgKCFpc0NhcmRUcmFuc2FjdGlvbkRldGFpbHMobW9udGhEYXRhKSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ21vbnRoRGF0YSBpcyBub3Qgb2YgdHlwZSBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzJyk7XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgYWxsTW9udGhzRGF0YS5wdXNoKG1vbnRoRGF0YSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAocGVuZGluZ0RhdGE/LnN0YXR1c0NvZGUgIT09IDEgJiYgcGVuZGluZ0RhdGE/LnN0YXR1c0NvZGUgIT09IDk2KSB7XHJcbiAgICAgICAgICBkZWJ1ZyhcclxuICAgICAgICAgICAgYGZhaWxlZCB0byBmZXRjaCBwZW5kaW5nIHRyYW5zYWN0aW9ucyBmb3IgY2FyZCAke2NhcmQubGFzdDREaWdpdHN9LiBNZXNzYWdlOiAke3BlbmRpbmdEYXRhPy50aXRsZSB8fCAnJ31gLFxyXG4gICAgICAgICAgKTtcclxuICAgICAgICAgIHBlbmRpbmdEYXRhID0gbnVsbDtcclxuICAgICAgICB9IGVsc2UgaWYgKCFpc0NhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzKHBlbmRpbmdEYXRhKSkge1xyXG4gICAgICAgICAgZGVidWcoJ3BlbmRpbmdEYXRhIGlzIG5vdCBvZiB0eXBlIENhcmRUcmFuc2FjdGlvbkRldGFpbHMnKTtcclxuICAgICAgICAgIHBlbmRpbmdEYXRhID0gbnVsbDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHRyYW5zYWN0aW9ucyA9IGNvbnZlcnRQYXJzZWREYXRhVG9UcmFuc2FjdGlvbnMoYWxsTW9udGhzRGF0YSwgcGVuZGluZ0RhdGEpO1xyXG5cclxuICAgICAgICBkZWJ1ZygnZmlsZXIgb3V0IG9sZCB0cmFuc2FjdGlvbnMnKTtcclxuICAgICAgICBjb25zdCB0eG5zID1cclxuICAgICAgICAgICh0aGlzLm9wdGlvbnMub3V0cHV0RGF0YT8uZW5hYmxlVHJhbnNhY3Rpb25zRmlsdGVyQnlEYXRlID8/IHRydWUpXHJcbiAgICAgICAgICAgID8gZmlsdGVyT2xkVHJhbnNhY3Rpb25zKHRyYW5zYWN0aW9ucywgbW9tZW50KHN0YXJ0RGF0ZSksIHRoaXMub3B0aW9ucy5jb21iaW5lSW5zdGFsbG1lbnRzIHx8IGZhbHNlKVxyXG4gICAgICAgICAgICA6IHRyYW5zYWN0aW9ucztcclxuXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHR4bnMsXHJcbiAgICAgICAgICBhY2NvdW50TnVtYmVyOiBjYXJkLmxhc3Q0RGlnaXRzLFxyXG4gICAgICAgIH0gYXMgVHJhbnNhY3Rpb25zQWNjb3VudDtcclxuICAgICAgfSksXHJcbiAgICApO1xyXG5cclxuICAgIGRlYnVnKCdyZXR1cm4gdGhlIHNjcmFwZWQgYWNjb3VudHMnKTtcclxuXHJcbiAgICBkZWJ1ZyhKU09OLnN0cmluZ2lmeShhY2NvdW50cywgbnVsbCwgMikpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgYWNjb3VudHMsXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQgVmlzYUNhbFNjcmFwZXI7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsSUFBQUEsT0FBQSxHQUFBQyxzQkFBQSxDQUFBQyxPQUFBO0FBRUEsSUFBQUMsTUFBQSxHQUFBRCxPQUFBO0FBQ0EsSUFBQUUscUJBQUEsR0FBQUYsT0FBQTtBQUNBLElBQUFHLE1BQUEsR0FBQUgsT0FBQTtBQUNBLElBQUFJLFdBQUEsR0FBQUosT0FBQTtBQUNBLElBQUFLLFFBQUEsR0FBQUwsT0FBQTtBQUNBLElBQUFNLGFBQUEsR0FBQU4sT0FBQTtBQUNBLElBQUFPLFFBQUEsR0FBQVAsT0FBQTtBQUNBLElBQUFRLGNBQUEsR0FBQVIsT0FBQTtBQUNBLElBQUFTLHVCQUFBLEdBQUFULE9BQUE7QUFBc0csU0FBQUQsdUJBQUFXLENBQUEsV0FBQUEsQ0FBQSxJQUFBQSxDQUFBLENBQUFDLFVBQUEsR0FBQUQsQ0FBQSxLQUFBRSxPQUFBLEVBQUFGLENBQUE7QUFHdEcsTUFBTUcsU0FBUyxHQUFHLCtCQUErQjtBQUNqRCxNQUFNQyw2QkFBNkIsR0FDakMsOEZBQThGO0FBQ2hHLE1BQU1DLHFDQUFxQyxHQUN6Qyw4RUFBOEU7QUFDaEYsTUFBTUMsa0NBQWtDLEdBQUcseUVBQXlFO0FBRXBILE1BQU1DLHNCQUFzQixHQUFHLG1DQUFtQztBQUVsRSxNQUFNQyxLQUFLLEdBQUcsSUFBQUMsZUFBUSxFQUFDLFVBQVUsQ0FBQztBQUFDLElB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Q2IseUNBQXlDNEIsSUFBSSxDQUFDb0UsV0FBVyxjQUFjakUsU0FBUyxFQUFFaUgsS0FBSyxJQUFJLEVBQUUsRUFDL0YsQ0FBQztRQUVILElBQUksQ0FBQzlKLHdCQUF3QixDQUFDNkMsU0FBUyxDQUFDLEVBQUU7VUFDeEMsTUFBTSxJQUFJL0IsS0FBSyxDQUFDLGlEQUFpRCxDQUFDO1FBQ3BFO1FBRUF3SSxhQUFhLENBQUNTLElBQUksQ0FBQ2xILFNBQVMsQ0FBQztNQUMvQjtNQUVBLElBQUlQLFdBQVcsRUFBRXVILFVBQVUsS0FBSyxDQUFDLElBQUl2SCxXQUFXLEVBQUV1SCxVQUFVLEtBQUssRUFBRSxFQUFFO1FBQ25FcEssS0FBSyxDQUNILGlEQUFpRGlELElBQUksQ0FBQ29FLFdBQVcsY0FBY3hFLFdBQVcsRUFBRXdILEtBQUssSUFBSSxFQUFFLEVBQ3pHLENBQUM7UUFDRHhILFdBQVcsR0FBRyxJQUFJO01BQ3BCLENBQUMsTUFBTSxJQUFJLENBQUNwQywrQkFBK0IsQ0FBQ29DLFdBQVcsQ0FBQyxFQUFFO1FBQ3hEN0MsS0FBSyxDQUFDLG1EQUFtRCxDQUFDO1FBQzFENkMsV0FBVyxHQUFHLElBQUk7TUFDcEI7TUFFQSxNQUFNZ0IsWUFBWSxHQUFHbEIsK0JBQStCLENBQUNrSCxhQUFhLEVBQUVoSCxXQUFXLENBQUM7TUFFaEY3QyxLQUFLLENBQUMsNEJBQTRCLENBQUM7TUFDbkMsTUFBTXVLLElBQUksR0FDUCxJQUFJLENBQUNwSSxPQUFPLENBQUNxSSxVQUFVLEVBQUVDLDhCQUE4QixJQUFJLElBQUksR0FDNUQsSUFBQUMsbUNBQXFCLEVBQUM3RyxZQUFZLEVBQUUsSUFBQVUsZUFBTSxFQUFDMkUsU0FBUyxDQUFDLEVBQUUsSUFBSSxDQUFDL0csT0FBTyxDQUFDd0ksbUJBQW1CLElBQUksS0FBSyxDQUFDLEdBQ2pHOUcsWUFBWTtNQUVsQixPQUFPO1FBQ0wwRyxJQUFJO1FBQ0pLLGFBQWEsRUFBRTNILElBQUksQ0FBQ29FO01BQ3RCLENBQUM7SUFDSCxDQUFDLENBQ0gsQ0FBQztJQUVEckgsS0FBSyxDQUFDLDZCQUE2QixDQUFDO0lBRXBDQSxLQUFLLENBQUM2SyxJQUFJLENBQUNDLFNBQVMsQ0FBQ3hILFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDeEMsT0FBTztNQUNMeUgsT0FBTyxFQUFFLElBQUk7TUFDYnpIO0lBQ0YsQ0FBQztFQUNIO0FBQ0Y7QUFBQyxJQUFBMEgsUUFBQSxHQUFBQyxPQUFBLENBQUF2TCxPQUFBLEdBRWNnSCxjQUFjIiwiaWdub3JlTGlzdCI6W119