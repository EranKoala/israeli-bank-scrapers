"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clickAccountSelectorGetAccountIds = clickAccountSelectorGetAccountIds;
exports.createLoginFields = createLoginFields;
exports.default = void 0;
exports.getPossibleLoginResults = getPossibleLoginResults;
exports.selectAccountFromDropdown = selectAccountFromDropdown;
exports.waitForPostLogin = waitForPostLogin;
var _moment = _interopRequireDefault(require("moment"));
var _constants = require("../constants");
var _elementsInteractions = require("../helpers/elements-interactions");
var _navigation = require("../helpers/navigation");
var _waiting = require("../helpers/waiting");
var _transactions = require("../transactions");
var _baseScraperWithBrowser = require("./base-scraper-with-browser");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const DATE_FORMAT = 'DD/MM/YYYY';
const NO_TRANSACTION_IN_DATE_RANGE_TEXT = 'לא נמצאו נתונים בנושא המבוקש';
const DATE_COLUMN_CLASS_COMPLETED = 'date first';
const DATE_COLUMN_CLASS_PENDING = 'first date';
const DESCRIPTION_COLUMN_CLASS_COMPLETED = 'reference wrap_normal';
const DESCRIPTION_COLUMN_CLASS_PENDING = 'details wrap_normal';
const REFERENCE_COLUMN_CLASS = 'details';
const DEBIT_COLUMN_CLASS = 'debit';
const CREDIT_COLUMN_CLASS = 'credit';
const ERROR_MESSAGE_CLASS = 'NO_DATA';
const ACCOUNTS_NUMBER = 'div.fibi_account span.acc_num';
const CLOSE_SEARCH_BY_DATES_BUTTON_CLASS = 'ui-datepicker-close';
const SHOW_SEARCH_BY_DATES_BUTTON_VALUE = 'הצג';
const COMPLETED_TRANSACTIONS_TABLE = 'table#dataTable077';
const PENDING_TRANSACTIONS_TABLE = 'table#dataTable023';
const NEXT_PAGE_LINK = 'a#Npage.paging';
const CURRENT_BALANCE = '.main_balance';
const IFRAME_NAME = 'iframe-old-pages';
const ELEMENT_RENDER_TIMEOUT_MS = 10000;
function getPossibleLoginResults() {
  const urls = {};
  urls[_baseScraperWithBrowser.LoginResults.Success] = [/fibi.*accountSummary/,
  // New UI pattern
  /Resources\/PortalNG\/shell/,
  // New UI pattern
  /FibiMenu\/Online/ // Old UI pattern
  ];
  urls[_baseScraperWithBrowser.LoginResults.InvalidPassword] = [/FibiMenu\/Marketing\/Private\/Home/];
  return urls;
}
function createLoginFields(credentials) {
  return [{
    selector: '#username',
    value: credentials.username
  }, {
    selector: '#password',
    value: credentials.password
  }];
}
function getAmountData(amountStr) {
  let amountStrCopy = amountStr.replace(_constants.SHEKEL_CURRENCY_SYMBOL, '');
  amountStrCopy = amountStrCopy.replaceAll(',', '');
  return parseFloat(amountStrCopy);
}
function getTxnAmount(txn) {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}
function convertTransactions(txns) {
  return txns.map(txn => {
    const convertedDate = (0, _moment.default)(txn.date, DATE_FORMAT).toISOString();
    const convertedAmount = getTxnAmount(txn);
    return {
      type: _transactions.TransactionTypes.Normal,
      identifier: txn.reference ? parseInt(txn.reference, 10) : undefined,
      date: convertedDate,
      processedDate: convertedDate,
      originalAmount: convertedAmount,
      originalCurrency: _constants.SHEKEL_CURRENCY,
      chargedAmount: convertedAmount,
      status: txn.status,
      description: txn.description,
      memo: txn.memo
    };
  });
}
function getTransactionDate(tds, transactionType, transactionsColsTypes) {
  if (transactionType === 'completed') {
    return (tds[transactionsColsTypes[DATE_COLUMN_CLASS_COMPLETED]] || '').trim();
  }
  return (tds[transactionsColsTypes[DATE_COLUMN_CLASS_PENDING]] || '').trim();
}
function getTransactionDescription(tds, transactionType, transactionsColsTypes) {
  if (transactionType === 'completed') {
    return (tds[transactionsColsTypes[DESCRIPTION_COLUMN_CLASS_COMPLETED]] || '').trim();
  }
  return (tds[transactionsColsTypes[DESCRIPTION_COLUMN_CLASS_PENDING]] || '').trim();
}
function getTransactionReference(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[REFERENCE_COLUMN_CLASS]] || '').trim();
}
function getTransactionDebit(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[DEBIT_COLUMN_CLASS]] || '').trim();
}
function getTransactionCredit(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[CREDIT_COLUMN_CLASS]] || '').trim();
}
function extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes) {
  const tds = txnRow.innerTds;
  const item = {
    status: transactionStatus,
    date: getTransactionDate(tds, transactionStatus, transactionsColsTypes),
    description: getTransactionDescription(tds, transactionStatus, transactionsColsTypes),
    reference: getTransactionReference(tds, transactionsColsTypes),
    debit: getTransactionDebit(tds, transactionsColsTypes),
    credit: getTransactionCredit(tds, transactionsColsTypes)
  };
  return item;
}
async function getTransactionsColsTypeClasses(page, tableLocator) {
  const result = {};
  const typeClassesObjs = await (0, _elementsInteractions.pageEvalAll)(page, `${tableLocator} tbody tr:first-of-type td`, null, tds => {
    return tds.map((td, index) => ({
      colClass: td.getAttribute('class'),
      index
    }));
  });
  for (const typeClassObj of typeClassesObjs) {
    if (typeClassObj.colClass) {
      result[typeClassObj.colClass] = typeClassObj.index;
    }
  }
  return result;
}
function extractTransaction(txns, transactionStatus, txnRow, transactionsColsTypes) {
  const txn = extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes);
  if (txn.date !== '') {
    txns.push(txn);
  }
}
async function extractTransactions(page, tableLocator, transactionStatus) {
  const txns = [];
  const transactionsColsTypes = await getTransactionsColsTypeClasses(page, tableLocator);
  const transactionsRows = await (0, _elementsInteractions.pageEvalAll)(page, `${tableLocator} tbody tr`, [], trs => {
    return trs.map(tr => ({
      innerTds: Array.from(tr.getElementsByTagName('td')).map(td => td.innerText)
    }));
  });
  for (const txnRow of transactionsRows) {
    extractTransaction(txns, transactionStatus, txnRow, transactionsColsTypes);
  }
  return txns;
}
async function isNoTransactionInDateRangeError(page) {
  const hasErrorInfoElement = await (0, _elementsInteractions.elementPresentOnPage)(page, `.${ERROR_MESSAGE_CLASS}`);
  if (hasErrorInfoElement) {
    const errorText = await page.$eval(`.${ERROR_MESSAGE_CLASS}`, errorElement => {
      return errorElement.innerText;
    });
    return errorText.trim() === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
  }
  return false;
}
async function searchByDates(page, startDate) {
  await (0, _elementsInteractions.clickButton)(page, 'a#tabHeader4');
  await (0, _elementsInteractions.waitUntilElementFound)(page, 'div#fibi_dates');
  await (0, _elementsInteractions.fillInput)(page, 'input#fromDate', startDate.format(DATE_FORMAT));
  await (0, _elementsInteractions.clickButton)(page, `button[class*=${CLOSE_SEARCH_BY_DATES_BUTTON_CLASS}]`);
  await (0, _elementsInteractions.clickButton)(page, `input[value=${SHOW_SEARCH_BY_DATES_BUTTON_VALUE}]`);
  await (0, _navigation.waitForNavigation)(page);
}
async function getAccountNumber(page) {
  // Wait until the account number element is present in the DOM
  await (0, _elementsInteractions.waitUntilElementFound)(page, ACCOUNTS_NUMBER, true, ELEMENT_RENDER_TIMEOUT_MS);
  const selectedSnifAccount = await page.$eval(ACCOUNTS_NUMBER, option => {
    return option.innerText;
  });
  return selectedSnifAccount.replace('/', '_').trim();
}
async function checkIfHasNextPage(page) {
  return (0, _elementsInteractions.elementPresentOnPage)(page, NEXT_PAGE_LINK);
}
async function navigateToNextPage(page) {
  await (0, _elementsInteractions.clickButton)(page, NEXT_PAGE_LINK);
  await (0, _navigation.waitForNavigation)(page);
}

/* Couldn't reproduce scenario with multiple pages of pending transactions - Should support if exists such case.
   needToPaginate is false if scraping pending transactions */
async function scrapeTransactions(page, tableLocator, transactionStatus, needToPaginate) {
  const txns = [];
  let hasNextPage = false;
  do {
    const currentPageTxns = await extractTransactions(page, tableLocator, transactionStatus);
    txns.push(...currentPageTxns);
    if (needToPaginate) {
      hasNextPage = await checkIfHasNextPage(page);
      if (hasNextPage) {
        await navigateToNextPage(page);
      }
    }
  } while (hasNextPage);
  return convertTransactions(txns);
}
async function getAccountTransactions(page) {
  await Promise.race([(0, _elementsInteractions.waitUntilElementFound)(page, "div[id*='divTable']", false), (0, _elementsInteractions.waitUntilElementFound)(page, `.${ERROR_MESSAGE_CLASS}`, false)]);
  const noTransactionInRangeError = await isNoTransactionInDateRangeError(page);
  if (noTransactionInRangeError) {
    return [];
  }
  const pendingTxns = await scrapeTransactions(page, PENDING_TRANSACTIONS_TABLE, _transactions.TransactionStatuses.Pending, false);
  const completedTxns = await scrapeTransactions(page, COMPLETED_TRANSACTIONS_TABLE, _transactions.TransactionStatuses.Completed, true);
  const txns = [...pendingTxns, ...completedTxns];
  return txns;
}
async function getCurrentBalance(page) {
  // Wait for the balance element to appear and be visible
  await (0, _elementsInteractions.waitUntilElementFound)(page, CURRENT_BALANCE, true, ELEMENT_RENDER_TIMEOUT_MS);

  // Extract text content
  const balanceStr = await page.$eval(CURRENT_BALANCE, el => {
    return el.innerText;
  });
  return getAmountData(balanceStr);
}
async function waitForPostLogin(page) {
  return Promise.race([(0, _elementsInteractions.waitUntilElementFound)(page, '#card-header', true),
  // New UI
  (0, _elementsInteractions.waitUntilElementFound)(page, '#account_num', true),
  // New UI
  (0, _elementsInteractions.waitUntilElementFound)(page, '#matafLogoutLink', true),
  // Old UI
  (0, _elementsInteractions.waitUntilElementFound)(page, '#validationMsg', true) // Old UI
  ]);
}
async function fetchAccountData(page, startDate) {
  const accountNumber = await getAccountNumber(page);
  const balance = await getCurrentBalance(page);
  await searchByDates(page, startDate);
  const txns = await getAccountTransactions(page);
  return {
    accountNumber,
    txns,
    balance
  };
}
async function getAccountIdsOldUI(page) {
  return page.evaluate(() => {
    const selectElement = document.getElementById('account_num_select');
    const options = selectElement ? selectElement.querySelectorAll('option') : [];
    if (!options) return [];
    return Array.from(options, option => option.value);
  });
}

/**
 * Ensures the account dropdown is open, then returns the available account labels.
 *
 * This method:
 * - Checks if the dropdown is already open.
 * - If not open, clicks the account selector to open it.
 * - Waits for the dropdown to render.
 * - Extracts and returns the list of available account labels.
 *
 * Graceful handling:
 * - If any error occurs (e.g., selectors not found, timing issues, UI version changes),
 *   the function returns an empty list.
 *
 * @param page Puppeteer Page object.
 * @returns An array of available account labels (e.g., ["127 | XXXX1", "127 | XXXX2"]),
 *          or an empty array if something goes wrong.
 */
async function clickAccountSelectorGetAccountIds(page) {
  try {
    const accountSelector = 'div.current-account'; // Direct selector to clickable element
    const dropdownPanelSelector = 'div.mat-mdc-autocomplete-panel.account-select-dd'; // The dropdown list box
    const optionSelector = 'mat-option .mdc-list-item__primary-text'; // Account option labels

    // Check if dropdown is already open
    const dropdownVisible = await page.$eval(dropdownPanelSelector, el => {
      return el && window.getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
    }).catch(() => false); // catch if dropdown is not in the DOM yet

    if (!dropdownVisible) {
      await (0, _elementsInteractions.waitUntilElementFound)(page, accountSelector, true, ELEMENT_RENDER_TIMEOUT_MS);

      // Click the account selector to open the dropdown
      await (0, _elementsInteractions.clickButton)(page, accountSelector);

      // Wait for the dropdown to open
      await (0, _elementsInteractions.waitUntilElementFound)(page, dropdownPanelSelector, true, ELEMENT_RENDER_TIMEOUT_MS);
    }

    // Extract account labels from the dropdown options
    const accountLabels = await page.$$eval(optionSelector, options => {
      return options.map(option => option.textContent?.trim() || '').filter(label => label !== '');
    });
    return accountLabels;
  } catch (error) {
    return []; // Graceful fallback
  }
}
async function getAccountIdsBothUIs(page) {
  let accountsIds = await clickAccountSelectorGetAccountIds(page);
  if (accountsIds.length === 0) {
    accountsIds = await getAccountIdsOldUI(page);
  }
  return accountsIds;
}

/**
 * Selects an account from the dropdown based on the provided account label.
 *
 * This method:
 * - Clicks the account selector button to open the dropdown.
 * - Retrieves the list of available account labels.
 * - Checks if the provided account label exists in the list.
 * - Finds and clicks the matching account option if found.
 *
 * @param page Puppeteer Page object.
 * @param accountLabel The text of the account to select (e.g., "127 | XXXXX").
 * @returns True if the account option was found and clicked; false otherwise.
 */
async function selectAccountFromDropdown(page, accountLabel) {
  // Call clickAccountSelector to get the available accounts and open the dropdown
  const availableAccounts = await clickAccountSelectorGetAccountIds(page);

  // Check if the account label exists in the available accounts
  if (!availableAccounts.includes(accountLabel)) {
    return false;
  }

  // Wait for the dropdown options to be rendered
  const optionSelector = 'mat-option .mdc-list-item__primary-text';
  await (0, _elementsInteractions.waitUntilElementFound)(page, optionSelector, true, ELEMENT_RENDER_TIMEOUT_MS);

  // Query all matching options
  const accountOptions = await page.$$(optionSelector);

  // Find and click the option matching the accountLabel
  for (const option of accountOptions) {
    const text = await page.evaluate(el => el.textContent?.trim(), option);
    if (text === accountLabel) {
      const optionHandle = await option.evaluateHandle(el => el);
      await page.evaluate(el => el.click(), optionHandle);
      return true;
    }
  }
  return false;
}
async function getTransactionsFrame(page) {
  // Try a few times to find the iframe, as it might not be immediately available
  for (let attempt = 0; attempt < 3; attempt++) {
    await (0, _waiting.sleep)(2000);
    const frames = page.frames();
    const targetFrame = frames.find(f => f.name() === IFRAME_NAME);
    if (targetFrame) {
      return targetFrame;
    }
  }
  return null;
}
async function selectAccountBothUIs(page, accountId) {
  const accountSelected = await selectAccountFromDropdown(page, accountId);
  if (!accountSelected) {
    // Old UI format
    await page.select('#account_num_select', accountId);
    await (0, _elementsInteractions.waitUntilElementFound)(page, '#account_num_select', true);
  }
}
async function fetchAccountDataBothUIs(page, startDate) {
  // Try to get the iframe for the new UI
  const frame = await getTransactionsFrame(page);

  // Use the frame if available (new UI), otherwise use the page directly (old UI)
  const targetPage = frame || page;
  return fetchAccountData(targetPage, startDate);
}
async function fetchAccounts(page, startDate) {
  const accountsIds = await getAccountIdsBothUIs(page);
  if (accountsIds.length === 0) {
    // In case accountsIds could no be parsed just return the transactions of the currently selected account
    const accountData = await fetchAccountDataBothUIs(page, startDate);
    return [accountData];
  }
  const accounts = [];
  for (const accountId of accountsIds) {
    await selectAccountBothUIs(page, accountId);
    const accountData = await fetchAccountDataBothUIs(page, startDate);
    accounts.push(accountData);
  }
  return accounts;
}
class BeinleumiGroupBaseScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  BASE_URL = '';
  LOGIN_URL = '';
  TRANSACTIONS_URL = '';
  getLoginOptions(credentials) {
    return {
      loginUrl: `${this.LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#continueBtn',
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults(),
      // HACK: For some reason, though the login button (#continueBtn) is present and visible, the click action does not perform.
      // Adding this delay fixes the issue.
      preAction: async () => {
        await (0, _waiting.sleep)(1000);
      }
    };
  }
  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years').add(1, 'day');
    const startMomentLimit = (0, _moment.default)({
      year: 1600
    });
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = _moment.default.max(startMomentLimit, (0, _moment.default)(startDate));
    await this.navigateTo(this.TRANSACTIONS_URL);
    const accounts = await fetchAccounts(this.page, startMoment);
    return {
      success: true,
      accounts
    };
  }
}
var _default = exports.default = BeinleumiGroupBaseScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfY29uc3RhbnRzIiwiX2VsZW1lbnRzSW50ZXJhY3Rpb25zIiwiX25hdmlnYXRpb24iLCJfd2FpdGluZyIsIl90cmFuc2FjdGlvbnMiLCJfYmFzZVNjcmFwZXJXaXRoQnJvd3NlciIsImUiLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsIkRBVEVfRk9STUFUIiwiTk9fVFJBTlNBQ1RJT05fSU5fREFURV9SQU5HRV9URVhUIiwiREFURV9DT0xVTU5fQ0xBU1NfQ09NUExFVEVEIiwiREFURV9DT0xVTU5fQ0xBU1NfUEVORElORyIsIkRFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19DT01QTEVURUQiLCJERVNDUklQVElPTl9DT0xVTU5fQ0xBU1NfUEVORElORyIsIlJFRkVSRU5DRV9DT0xVTU5fQ0xBU1MiLCJERUJJVF9DT0xVTU5fQ0xBU1MiLCJDUkVESVRfQ09MVU1OX0NMQVNTIiwiRVJST1JfTUVTU0FHRV9DTEFTUyIsIkFDQ09VTlRTX05VTUJFUiIsIkNMT1NFX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fQ0xBU1MiLCJTSE9XX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fVkFMVUUiLCJDT01QTEVURURfVFJBTlNBQ1RJT05TX1RBQkxFIiwiUEVORElOR19UUkFOU0FDVElPTlNfVEFCTEUiLCJORVhUX1BBR0VfTElOSyIsIkNVUlJFTlRfQkFMQU5DRSIsIklGUkFNRV9OQU1FIiwiRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyIsImdldFBvc3NpYmxlTG9naW5SZXN1bHRzIiwidXJscyIsIkxvZ2luUmVzdWx0cyIsIlN1Y2Nlc3MiLCJJbnZhbGlkUGFzc3dvcmQiLCJjcmVhdGVMb2dpbkZpZWxkcyIsImNyZWRlbnRpYWxzIiwic2VsZWN0b3IiLCJ2YWx1ZSIsInVzZXJuYW1lIiwicGFzc3dvcmQiLCJnZXRBbW91bnREYXRhIiwiYW1vdW50U3RyIiwiYW1vdW50U3RyQ29weSIsInJlcGxhY2UiLCJTSEVLRUxfQ1VSUkVOQ1lfU1lNQk9MIiwicmVwbGFjZUFsbCIsInBhcnNlRmxvYXQiLCJnZXRUeG5BbW91bnQiLCJ0eG4iLCJjcmVkaXQiLCJkZWJpdCIsIk51bWJlciIsImlzTmFOIiwiY29udmVydFRyYW5zYWN0aW9ucyIsInR4bnMiLCJtYXAiLCJjb252ZXJ0ZWREYXRlIiwibW9tZW50IiwiZGF0ZSIsInRvSVNPU3RyaW5nIiwiY29udmVydGVkQW1vdW50IiwidHlwZSIsIlRyYW5zYWN0aW9uVHlwZXMiLCJOb3JtYWwiLCJpZGVudGlmaWVyIiwicmVmZXJlbmNlIiwicGFyc2VJbnQiLCJ1bmRlZmluZWQiLCJwcm9jZXNzZWREYXRlIiwib3JpZ2luYWxBbW91bnQiLCJvcmlnaW5hbEN1cnJlbmN5IiwiU0hFS0VMX0NVUlJFTkNZIiwiY2hhcmdlZEFtb3VudCIsInN0YXR1cyIsImRlc2NyaXB0aW9uIiwibWVtbyIsImdldFRyYW5zYWN0aW9uRGF0ZSIsInRkcyIsInRyYW5zYWN0aW9uVHlwZSIsInRyYW5zYWN0aW9uc0NvbHNUeXBlcyIsInRyaW0iLCJnZXRUcmFuc2FjdGlvbkRlc2NyaXB0aW9uIiwiZ2V0VHJhbnNhY3Rpb25SZWZlcmVuY2UiLCJnZXRUcmFuc2FjdGlvbkRlYml0IiwiZ2V0VHJhbnNhY3Rpb25DcmVkaXQiLCJleHRyYWN0VHJhbnNhY3Rpb25EZXRhaWxzIiwidHhuUm93IiwidHJhbnNhY3Rpb25TdGF0dXMiLCJpbm5lclRkcyIsIml0ZW0iLCJnZXRUcmFuc2FjdGlvbnNDb2xzVHlwZUNsYXNzZXMiLCJwYWdlIiwidGFibGVMb2NhdG9yIiwicmVzdWx0IiwidHlwZUNsYXNzZXNPYmpzIiwicGFnZUV2YWxBbGwiLCJ0ZCIsImluZGV4IiwiY29sQ2xhc3MiLCJnZXRBdHRyaWJ1dGUiLCJ0eXBlQ2xhc3NPYmoiLCJleHRyYWN0VHJhbnNhY3Rpb24iLCJwdXNoIiwiZXh0cmFjdFRyYW5zYWN0aW9ucyIsInRyYW5zYWN0aW9uc1Jvd3MiLCJ0cnMiLCJ0ciIsIkFycmF5IiwiZnJvbSIsImdldEVsZW1lbnRzQnlUYWdOYW1lIiwiaW5uZXJUZXh0IiwiaXNOb1RyYW5zYWN0aW9uSW5EYXRlUmFuZ2VFcnJvciIsImhhc0Vycm9ySW5mb0VsZW1lbnQiLCJlbGVtZW50UHJlc2VudE9uUGFnZSIsImVycm9yVGV4dCIsIiRldmFsIiwiZXJyb3JFbGVtZW50Iiwic2VhcmNoQnlEYXRlcyIsInN0YXJ0RGF0ZSIsImNsaWNrQnV0dG9uIiwid2FpdFVudGlsRWxlbWVudEZvdW5kIiwiZmlsbElucHV0IiwiZm9ybWF0Iiwid2FpdEZvck5hdmlnYXRpb24iLCJnZXRBY2NvdW50TnVtYmVyIiwic2VsZWN0ZWRTbmlmQWNjb3VudCIsIm9wdGlvbiIsImNoZWNrSWZIYXNOZXh0UGFnZSIsIm5hdmlnYXRlVG9OZXh0UGFnZSIsInNjcmFwZVRyYW5zYWN0aW9ucyIsIm5lZWRUb1BhZ2luYXRlIiwiaGFzTmV4dFBhZ2UiLCJjdXJyZW50UGFnZVR4bnMiLCJnZXRBY2NvdW50VHJhbnNhY3Rpb25zIiwiUHJvbWlzZSIsInJhY2UiLCJub1RyYW5zYWN0aW9uSW5SYW5nZUVycm9yIiwicGVuZGluZ1R4bnMiLCJUcmFuc2FjdGlvblN0YXR1c2VzIiwiUGVuZGluZyIsImNvbXBsZXRlZFR4bnMiLCJDb21wbGV0ZWQiLCJnZXRDdXJyZW50QmFsYW5jZSIsImJhbGFuY2VTdHIiLCJlbCIsIndhaXRGb3JQb3N0TG9naW4iLCJmZXRjaEFjY291bnREYXRhIiwiYWNjb3VudE51bWJlciIsImJhbGFuY2UiLCJnZXRBY2NvdW50SWRzT2xkVUkiLCJldmFsdWF0ZSIsInNlbGVjdEVsZW1lbnQiLCJkb2N1bWVudCIsImdldEVsZW1lbnRCeUlkIiwib3B0aW9ucyIsInF1ZXJ5U2VsZWN0b3JBbGwiLCJjbGlja0FjY291bnRTZWxlY3RvckdldEFjY291bnRJZHMiLCJhY2NvdW50U2VsZWN0b3IiLCJkcm9wZG93blBhbmVsU2VsZWN0b3IiLCJvcHRpb25TZWxlY3RvciIsImRyb3Bkb3duVmlzaWJsZSIsIndpbmRvdyIsImdldENvbXB1dGVkU3R5bGUiLCJkaXNwbGF5Iiwib2Zmc2V0UGFyZW50IiwiY2F0Y2giLCJhY2NvdW50TGFiZWxzIiwiJCRldmFsIiwidGV4dENvbnRlbnQiLCJmaWx0ZXIiLCJsYWJlbCIsImVycm9yIiwiZ2V0QWNjb3VudElkc0JvdGhVSXMiLCJhY2NvdW50c0lkcyIsImxlbmd0aCIsInNlbGVjdEFjY291bnRGcm9tRHJvcGRvd24iLCJhY2NvdW50TGFiZWwiLCJhdmFpbGFibGVBY2NvdW50cyIsImluY2x1ZGVzIiwiYWNjb3VudE9wdGlvbnMiLCIkJCIsInRleHQiLCJvcHRpb25IYW5kbGUiLCJldmFsdWF0ZUhhbmRsZSIsImNsaWNrIiwiZ2V0VHJhbnNhY3Rpb25zRnJhbWUiLCJhdHRlbXB0Iiwic2xlZXAiLCJmcmFtZXMiLCJ0YXJnZXRGcmFtZSIsImZpbmQiLCJmIiwibmFtZSIsInNlbGVjdEFjY291bnRCb3RoVUlzIiwiYWNjb3VudElkIiwiYWNjb3VudFNlbGVjdGVkIiwic2VsZWN0IiwiZmV0Y2hBY2NvdW50RGF0YUJvdGhVSXMiLCJmcmFtZSIsInRhcmdldFBhZ2UiLCJmZXRjaEFjY291bnRzIiwiYWNjb3VudERhdGEiLCJhY2NvdW50cyIsIkJlaW5sZXVtaUdyb3VwQmFzZVNjcmFwZXIiLCJCYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiQkFTRV9VUkwiLCJMT0dJTl9VUkwiLCJUUkFOU0FDVElPTlNfVVJMIiwiZ2V0TG9naW5PcHRpb25zIiwibG9naW5VcmwiLCJmaWVsZHMiLCJzdWJtaXRCdXR0b25TZWxlY3RvciIsInBvc3RBY3Rpb24iLCJwb3NzaWJsZVJlc3VsdHMiLCJwcmVBY3Rpb24iLCJmZXRjaERhdGEiLCJkZWZhdWx0U3RhcnRNb21lbnQiLCJzdWJ0cmFjdCIsImFkZCIsInN0YXJ0TW9tZW50TGltaXQiLCJ5ZWFyIiwidG9EYXRlIiwic3RhcnRNb21lbnQiLCJtYXgiLCJuYXZpZ2F0ZVRvIiwic3VjY2VzcyIsIl9kZWZhdWx0IiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zY3JhcGVycy9iYXNlLWJlaW5sZXVtaS1ncm91cC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgbW9tZW50LCB7IHR5cGUgTW9tZW50IH0gZnJvbSAnbW9tZW50JztcclxuaW1wb3J0IHsgdHlwZSBGcmFtZSwgdHlwZSBQYWdlIH0gZnJvbSAncHVwcGV0ZWVyJztcclxuaW1wb3J0IHsgU0hFS0VMX0NVUlJFTkNZLCBTSEVLRUxfQ1VSUkVOQ1lfU1lNQk9MIH0gZnJvbSAnLi4vY29uc3RhbnRzJztcclxuaW1wb3J0IHtcclxuICBjbGlja0J1dHRvbixcclxuICBlbGVtZW50UHJlc2VudE9uUGFnZSxcclxuICBmaWxsSW5wdXQsXHJcbiAgcGFnZUV2YWxBbGwsXHJcbiAgd2FpdFVudGlsRWxlbWVudEZvdW5kLFxyXG59IGZyb20gJy4uL2hlbHBlcnMvZWxlbWVudHMtaW50ZXJhY3Rpb25zJztcclxuaW1wb3J0IHsgd2FpdEZvck5hdmlnYXRpb24gfSBmcm9tICcuLi9oZWxwZXJzL25hdmlnYXRpb24nO1xyXG5pbXBvcnQgeyBzbGVlcCB9IGZyb20gJy4uL2hlbHBlcnMvd2FpdGluZyc7XHJcbmltcG9ydCB7IFRyYW5zYWN0aW9uU3RhdHVzZXMsIFRyYW5zYWN0aW9uVHlwZXMsIHR5cGUgVHJhbnNhY3Rpb24sIHR5cGUgVHJhbnNhY3Rpb25zQWNjb3VudCB9IGZyb20gJy4uL3RyYW5zYWN0aW9ucyc7XHJcbmltcG9ydCB7IEJhc2VTY3JhcGVyV2l0aEJyb3dzZXIsIExvZ2luUmVzdWx0cywgdHlwZSBQb3NzaWJsZUxvZ2luUmVzdWx0cyB9IGZyb20gJy4vYmFzZS1zY3JhcGVyLXdpdGgtYnJvd3Nlcic7XHJcblxyXG5jb25zdCBEQVRFX0ZPUk1BVCA9ICdERC9NTS9ZWVlZJztcclxuY29uc3QgTk9fVFJBTlNBQ1RJT05fSU5fREFURV9SQU5HRV9URVhUID0gJ9ec15Ag16DXntem15DXlSDXoNeq15XXoNeZ150g15HXoNeV16nXkCDXlNee15HXlden16knO1xyXG5jb25zdCBEQVRFX0NPTFVNTl9DTEFTU19DT01QTEVURUQgPSAnZGF0ZSBmaXJzdCc7XHJcbmNvbnN0IERBVEVfQ09MVU1OX0NMQVNTX1BFTkRJTkcgPSAnZmlyc3QgZGF0ZSc7XHJcbmNvbnN0IERFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19DT01QTEVURUQgPSAncmVmZXJlbmNlIHdyYXBfbm9ybWFsJztcclxuY29uc3QgREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX1BFTkRJTkcgPSAnZGV0YWlscyB3cmFwX25vcm1hbCc7XHJcbmNvbnN0IFJFRkVSRU5DRV9DT0xVTU5fQ0xBU1MgPSAnZGV0YWlscyc7XHJcbmNvbnN0IERFQklUX0NPTFVNTl9DTEFTUyA9ICdkZWJpdCc7XHJcbmNvbnN0IENSRURJVF9DT0xVTU5fQ0xBU1MgPSAnY3JlZGl0JztcclxuY29uc3QgRVJST1JfTUVTU0FHRV9DTEFTUyA9ICdOT19EQVRBJztcclxuY29uc3QgQUNDT1VOVFNfTlVNQkVSID0gJ2Rpdi5maWJpX2FjY291bnQgc3Bhbi5hY2NfbnVtJztcclxuY29uc3QgQ0xPU0VfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9DTEFTUyA9ICd1aS1kYXRlcGlja2VyLWNsb3NlJztcclxuY29uc3QgU0hPV19TRUFSQ0hfQllfREFURVNfQlVUVE9OX1ZBTFVFID0gJ9eU16bXkic7XHJcbmNvbnN0IENPTVBMRVRFRF9UUkFOU0FDVElPTlNfVEFCTEUgPSAndGFibGUjZGF0YVRhYmxlMDc3JztcclxuY29uc3QgUEVORElOR19UUkFOU0FDVElPTlNfVEFCTEUgPSAndGFibGUjZGF0YVRhYmxlMDIzJztcclxuY29uc3QgTkVYVF9QQUdFX0xJTksgPSAnYSNOcGFnZS5wYWdpbmcnO1xyXG5jb25zdCBDVVJSRU5UX0JBTEFOQ0UgPSAnLm1haW5fYmFsYW5jZSc7XHJcbmNvbnN0IElGUkFNRV9OQU1FID0gJ2lmcmFtZS1vbGQtcGFnZXMnO1xyXG5jb25zdCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TID0gMTAwMDA7XHJcblxyXG50eXBlIFRyYW5zYWN0aW9uc0NvbHNUeXBlcyA9IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XHJcbnR5cGUgVHJhbnNhY3Rpb25zVHJUZHMgPSBzdHJpbmdbXTtcclxudHlwZSBUcmFuc2FjdGlvbnNUciA9IHsgaW5uZXJUZHM6IFRyYW5zYWN0aW9uc1RyVGRzIH07XHJcblxyXG5pbnRlcmZhY2UgU2NyYXBlZFRyYW5zYWN0aW9uIHtcclxuICByZWZlcmVuY2U6IHN0cmluZztcclxuICBkYXRlOiBzdHJpbmc7XHJcbiAgY3JlZGl0OiBzdHJpbmc7XHJcbiAgZGViaXQ6IHN0cmluZztcclxuICBtZW1vPzogc3RyaW5nO1xyXG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XHJcbiAgc3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0UG9zc2libGVMb2dpblJlc3VsdHMoKTogUG9zc2libGVMb2dpblJlc3VsdHMge1xyXG4gIGNvbnN0IHVybHM6IFBvc3NpYmxlTG9naW5SZXN1bHRzID0ge307XHJcbiAgdXJsc1tMb2dpblJlc3VsdHMuU3VjY2Vzc10gPSBbXHJcbiAgICAvZmliaS4qYWNjb3VudFN1bW1hcnkvLCAvLyBOZXcgVUkgcGF0dGVyblxyXG4gICAgL1Jlc291cmNlc1xcL1BvcnRhbE5HXFwvc2hlbGwvLCAvLyBOZXcgVUkgcGF0dGVyblxyXG4gICAgL0ZpYmlNZW51XFwvT25saW5lLywgLy8gT2xkIFVJIHBhdHRlcm5cclxuICBdO1xyXG4gIHVybHNbTG9naW5SZXN1bHRzLkludmFsaWRQYXNzd29yZF0gPSBbL0ZpYmlNZW51XFwvTWFya2V0aW5nXFwvUHJpdmF0ZVxcL0hvbWUvXTtcclxuICByZXR1cm4gdXJscztcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUxvZ2luRmllbGRzKGNyZWRlbnRpYWxzOiBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscykge1xyXG4gIHJldHVybiBbXHJcbiAgICB7IHNlbGVjdG9yOiAnI3VzZXJuYW1lJywgdmFsdWU6IGNyZWRlbnRpYWxzLnVzZXJuYW1lIH0sXHJcbiAgICB7IHNlbGVjdG9yOiAnI3Bhc3N3b3JkJywgdmFsdWU6IGNyZWRlbnRpYWxzLnBhc3N3b3JkIH0sXHJcbiAgXTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0QW1vdW50RGF0YShhbW91bnRTdHI6IHN0cmluZykge1xyXG4gIGxldCBhbW91bnRTdHJDb3B5ID0gYW1vdW50U3RyLnJlcGxhY2UoU0hFS0VMX0NVUlJFTkNZX1NZTUJPTCwgJycpO1xyXG4gIGFtb3VudFN0ckNvcHkgPSBhbW91bnRTdHJDb3B5LnJlcGxhY2VBbGwoJywnLCAnJyk7XHJcbiAgcmV0dXJuIHBhcnNlRmxvYXQoYW1vdW50U3RyQ29weSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFR4bkFtb3VudCh0eG46IFNjcmFwZWRUcmFuc2FjdGlvbikge1xyXG4gIGNvbnN0IGNyZWRpdCA9IGdldEFtb3VudERhdGEodHhuLmNyZWRpdCk7XHJcbiAgY29uc3QgZGViaXQgPSBnZXRBbW91bnREYXRhKHR4bi5kZWJpdCk7XHJcbiAgcmV0dXJuIChOdW1iZXIuaXNOYU4oY3JlZGl0KSA/IDAgOiBjcmVkaXQpIC0gKE51bWJlci5pc05hTihkZWJpdCkgPyAwIDogZGViaXQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb252ZXJ0VHJhbnNhY3Rpb25zKHR4bnM6IFNjcmFwZWRUcmFuc2FjdGlvbltdKTogVHJhbnNhY3Rpb25bXSB7XHJcbiAgcmV0dXJuIHR4bnMubWFwKCh0eG4pOiBUcmFuc2FjdGlvbiA9PiB7XHJcbiAgICBjb25zdCBjb252ZXJ0ZWREYXRlID0gbW9tZW50KHR4bi5kYXRlLCBEQVRFX0ZPUk1BVCkudG9JU09TdHJpbmcoKTtcclxuICAgIGNvbnN0IGNvbnZlcnRlZEFtb3VudCA9IGdldFR4bkFtb3VudCh0eG4pO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgdHlwZTogVHJhbnNhY3Rpb25UeXBlcy5Ob3JtYWwsXHJcbiAgICAgIGlkZW50aWZpZXI6IHR4bi5yZWZlcmVuY2UgPyBwYXJzZUludCh0eG4ucmVmZXJlbmNlLCAxMCkgOiB1bmRlZmluZWQsXHJcbiAgICAgIGRhdGU6IGNvbnZlcnRlZERhdGUsXHJcbiAgICAgIHByb2Nlc3NlZERhdGU6IGNvbnZlcnRlZERhdGUsXHJcbiAgICAgIG9yaWdpbmFsQW1vdW50OiBjb252ZXJ0ZWRBbW91bnQsXHJcbiAgICAgIG9yaWdpbmFsQ3VycmVuY3k6IFNIRUtFTF9DVVJSRU5DWSxcclxuICAgICAgY2hhcmdlZEFtb3VudDogY29udmVydGVkQW1vdW50LFxyXG4gICAgICBzdGF0dXM6IHR4bi5zdGF0dXMsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiB0eG4uZGVzY3JpcHRpb24sXHJcbiAgICAgIG1lbW86IHR4bi5tZW1vLFxyXG4gICAgfTtcclxuICB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25EYXRlKFxyXG4gIHRkczogVHJhbnNhY3Rpb25zVHJUZHMsXHJcbiAgdHJhbnNhY3Rpb25UeXBlOiBzdHJpbmcsXHJcbiAgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMsXHJcbikge1xyXG4gIGlmICh0cmFuc2FjdGlvblR5cGUgPT09ICdjb21wbGV0ZWQnKSB7XHJcbiAgICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbREFURV9DT0xVTU5fQ0xBU1NfQ09NUExFVEVEXV0gfHwgJycpLnRyaW0oKTtcclxuICB9XHJcbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0RBVEVfQ09MVU1OX0NMQVNTX1BFTkRJTkddXSB8fCAnJykudHJpbSgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkRlc2NyaXB0aW9uKFxyXG4gIHRkczogVHJhbnNhY3Rpb25zVHJUZHMsXHJcbiAgdHJhbnNhY3Rpb25UeXBlOiBzdHJpbmcsXHJcbiAgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMsXHJcbikge1xyXG4gIGlmICh0cmFuc2FjdGlvblR5cGUgPT09ICdjb21wbGV0ZWQnKSB7XHJcbiAgICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX0NPTVBMRVRFRF1dIHx8ICcnKS50cmltKCk7XHJcbiAgfVxyXG4gIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tERVNDUklQVElPTl9DT0xVTU5fQ0xBU1NfUEVORElOR11dIHx8ICcnKS50cmltKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uUmVmZXJlbmNlKHRkczogVHJhbnNhY3Rpb25zVHJUZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzKSB7XHJcbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW1JFRkVSRU5DRV9DT0xVTU5fQ0xBU1NdXSB8fCAnJykudHJpbSgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkRlYml0KHRkczogVHJhbnNhY3Rpb25zVHJUZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzKSB7XHJcbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0RFQklUX0NPTFVNTl9DTEFTU11dIHx8ICcnKS50cmltKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uQ3JlZGl0KHRkczogVHJhbnNhY3Rpb25zVHJUZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzKSB7XHJcbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0NSRURJVF9DT0xVTU5fQ0xBU1NdXSB8fCAnJykudHJpbSgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBleHRyYWN0VHJhbnNhY3Rpb25EZXRhaWxzKFxyXG4gIHR4blJvdzogVHJhbnNhY3Rpb25zVHIsXHJcbiAgdHJhbnNhY3Rpb25TdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMsXHJcbiAgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMsXHJcbik6IFNjcmFwZWRUcmFuc2FjdGlvbiB7XHJcbiAgY29uc3QgdGRzID0gdHhuUm93LmlubmVyVGRzO1xyXG4gIGNvbnN0IGl0ZW0gPSB7XHJcbiAgICBzdGF0dXM6IHRyYW5zYWN0aW9uU3RhdHVzLFxyXG4gICAgZGF0ZTogZ2V0VHJhbnNhY3Rpb25EYXRlKHRkcywgdHJhbnNhY3Rpb25TdGF0dXMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXHJcbiAgICBkZXNjcmlwdGlvbjogZ2V0VHJhbnNhY3Rpb25EZXNjcmlwdGlvbih0ZHMsIHRyYW5zYWN0aW9uU3RhdHVzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxyXG4gICAgcmVmZXJlbmNlOiBnZXRUcmFuc2FjdGlvblJlZmVyZW5jZSh0ZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXHJcbiAgICBkZWJpdDogZ2V0VHJhbnNhY3Rpb25EZWJpdCh0ZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXHJcbiAgICBjcmVkaXQ6IGdldFRyYW5zYWN0aW9uQ3JlZGl0KHRkcywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKSxcclxuICB9O1xyXG5cclxuICByZXR1cm4gaXRlbTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25zQ29sc1R5cGVDbGFzc2VzKFxyXG4gIHBhZ2U6IFBhZ2UgfCBGcmFtZSxcclxuICB0YWJsZUxvY2F0b3I6IHN0cmluZyxcclxuKTogUHJvbWlzZTxUcmFuc2FjdGlvbnNDb2xzVHlwZXM+IHtcclxuICBjb25zdCByZXN1bHQ6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyA9IHt9O1xyXG4gIGNvbnN0IHR5cGVDbGFzc2VzT2JqcyA9IGF3YWl0IHBhZ2VFdmFsQWxsKHBhZ2UsIGAke3RhYmxlTG9jYXRvcn0gdGJvZHkgdHI6Zmlyc3Qtb2YtdHlwZSB0ZGAsIG51bGwsIHRkcyA9PiB7XHJcbiAgICByZXR1cm4gdGRzLm1hcCgodGQsIGluZGV4KSA9PiAoe1xyXG4gICAgICBjb2xDbGFzczogdGQuZ2V0QXR0cmlidXRlKCdjbGFzcycpLFxyXG4gICAgICBpbmRleCxcclxuICAgIH0pKTtcclxuICB9KTtcclxuXHJcbiAgZm9yIChjb25zdCB0eXBlQ2xhc3NPYmogb2YgdHlwZUNsYXNzZXNPYmpzKSB7XHJcbiAgICBpZiAodHlwZUNsYXNzT2JqLmNvbENsYXNzKSB7XHJcbiAgICAgIHJlc3VsdFt0eXBlQ2xhc3NPYmouY29sQ2xhc3NdID0gdHlwZUNsYXNzT2JqLmluZGV4O1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gcmVzdWx0O1xyXG59XHJcblxyXG5mdW5jdGlvbiBleHRyYWN0VHJhbnNhY3Rpb24oXHJcbiAgdHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10sXHJcbiAgdHJhbnNhY3Rpb25TdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMsXHJcbiAgdHhuUm93OiBUcmFuc2FjdGlvbnNUcixcclxuICB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyxcclxuKSB7XHJcbiAgY29uc3QgdHhuID0gZXh0cmFjdFRyYW5zYWN0aW9uRGV0YWlscyh0eG5Sb3csIHRyYW5zYWN0aW9uU3RhdHVzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpO1xyXG4gIGlmICh0eG4uZGF0ZSAhPT0gJycpIHtcclxuICAgIHR4bnMucHVzaCh0eG4pO1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZXh0cmFjdFRyYW5zYWN0aW9ucyhwYWdlOiBQYWdlIHwgRnJhbWUsIHRhYmxlTG9jYXRvcjogc3RyaW5nLCB0cmFuc2FjdGlvblN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcykge1xyXG4gIGNvbnN0IHR4bnM6IFNjcmFwZWRUcmFuc2FjdGlvbltdID0gW107XHJcbiAgY29uc3QgdHJhbnNhY3Rpb25zQ29sc1R5cGVzID0gYXdhaXQgZ2V0VHJhbnNhY3Rpb25zQ29sc1R5cGVDbGFzc2VzKHBhZ2UsIHRhYmxlTG9jYXRvcik7XHJcblxyXG4gIGNvbnN0IHRyYW5zYWN0aW9uc1Jvd3MgPSBhd2FpdCBwYWdlRXZhbEFsbDxUcmFuc2FjdGlvbnNUcltdPihwYWdlLCBgJHt0YWJsZUxvY2F0b3J9IHRib2R5IHRyYCwgW10sIHRycyA9PiB7XHJcbiAgICByZXR1cm4gdHJzLm1hcCh0ciA9PiAoe1xyXG4gICAgICBpbm5lclRkczogQXJyYXkuZnJvbSh0ci5nZXRFbGVtZW50c0J5VGFnTmFtZSgndGQnKSkubWFwKHRkID0+IHRkLmlubmVyVGV4dCksXHJcbiAgICB9KSk7XHJcbiAgfSk7XHJcblxyXG4gIGZvciAoY29uc3QgdHhuUm93IG9mIHRyYW5zYWN0aW9uc1Jvd3MpIHtcclxuICAgIGV4dHJhY3RUcmFuc2FjdGlvbih0eG5zLCB0cmFuc2FjdGlvblN0YXR1cywgdHhuUm93LCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpO1xyXG4gIH1cclxuICByZXR1cm4gdHhucztcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gaXNOb1RyYW5zYWN0aW9uSW5EYXRlUmFuZ2VFcnJvcihwYWdlOiBQYWdlIHwgRnJhbWUpIHtcclxuICBjb25zdCBoYXNFcnJvckluZm9FbGVtZW50ID0gYXdhaXQgZWxlbWVudFByZXNlbnRPblBhZ2UocGFnZSwgYC4ke0VSUk9SX01FU1NBR0VfQ0xBU1N9YCk7XHJcbiAgaWYgKGhhc0Vycm9ySW5mb0VsZW1lbnQpIHtcclxuICAgIGNvbnN0IGVycm9yVGV4dCA9IGF3YWl0IHBhZ2UuJGV2YWwoYC4ke0VSUk9SX01FU1NBR0VfQ0xBU1N9YCwgZXJyb3JFbGVtZW50ID0+IHtcclxuICAgICAgcmV0dXJuIChlcnJvckVsZW1lbnQgYXMgSFRNTEVsZW1lbnQpLmlubmVyVGV4dDtcclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIGVycm9yVGV4dC50cmltKCkgPT09IE5PX1RSQU5TQUNUSU9OX0lOX0RBVEVfUkFOR0VfVEVYVDtcclxuICB9XHJcbiAgcmV0dXJuIGZhbHNlO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBzZWFyY2hCeURhdGVzKHBhZ2U6IFBhZ2UgfCBGcmFtZSwgc3RhcnREYXRlOiBNb21lbnQpIHtcclxuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCAnYSN0YWJIZWFkZXI0Jyk7XHJcbiAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICdkaXYjZmliaV9kYXRlcycpO1xyXG4gIGF3YWl0IGZpbGxJbnB1dChwYWdlLCAnaW5wdXQjZnJvbURhdGUnLCBzdGFydERhdGUuZm9ybWF0KERBVEVfRk9STUFUKSk7XHJcbiAgYXdhaXQgY2xpY2tCdXR0b24ocGFnZSwgYGJ1dHRvbltjbGFzcyo9JHtDTE9TRV9TRUFSQ0hfQllfREFURVNfQlVUVE9OX0NMQVNTfV1gKTtcclxuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBgaW5wdXRbdmFsdWU9JHtTSE9XX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fVkFMVUV9XWApO1xyXG4gIGF3YWl0IHdhaXRGb3JOYXZpZ2F0aW9uKHBhZ2UpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZXRBY2NvdW50TnVtYmVyKHBhZ2U6IFBhZ2UgfCBGcmFtZSk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgLy8gV2FpdCB1bnRpbCB0aGUgYWNjb3VudCBudW1iZXIgZWxlbWVudCBpcyBwcmVzZW50IGluIHRoZSBET01cclxuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgQUNDT1VOVFNfTlVNQkVSLCB0cnVlLCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TKTtcclxuXHJcbiAgY29uc3Qgc2VsZWN0ZWRTbmlmQWNjb3VudCA9IGF3YWl0IHBhZ2UuJGV2YWwoQUNDT1VOVFNfTlVNQkVSLCBvcHRpb24gPT4ge1xyXG4gICAgcmV0dXJuIChvcHRpb24gYXMgSFRNTEVsZW1lbnQpLmlubmVyVGV4dDtcclxuICB9KTtcclxuXHJcbiAgcmV0dXJuIHNlbGVjdGVkU25pZkFjY291bnQucmVwbGFjZSgnLycsICdfJykudHJpbSgpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBjaGVja0lmSGFzTmV4dFBhZ2UocGFnZTogUGFnZSB8IEZyYW1lKSB7XHJcbiAgcmV0dXJuIGVsZW1lbnRQcmVzZW50T25QYWdlKHBhZ2UsIE5FWFRfUEFHRV9MSU5LKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gbmF2aWdhdGVUb05leHRQYWdlKHBhZ2U6IFBhZ2UgfCBGcmFtZSkge1xyXG4gIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsIE5FWFRfUEFHRV9MSU5LKTtcclxuICBhd2FpdCB3YWl0Rm9yTmF2aWdhdGlvbihwYWdlKTtcclxufVxyXG5cclxuLyogQ291bGRuJ3QgcmVwcm9kdWNlIHNjZW5hcmlvIHdpdGggbXVsdGlwbGUgcGFnZXMgb2YgcGVuZGluZyB0cmFuc2FjdGlvbnMgLSBTaG91bGQgc3VwcG9ydCBpZiBleGlzdHMgc3VjaCBjYXNlLlxyXG4gICBuZWVkVG9QYWdpbmF0ZSBpcyBmYWxzZSBpZiBzY3JhcGluZyBwZW5kaW5nIHRyYW5zYWN0aW9ucyAqL1xyXG5hc3luYyBmdW5jdGlvbiBzY3JhcGVUcmFuc2FjdGlvbnMoXHJcbiAgcGFnZTogUGFnZSB8IEZyYW1lLFxyXG4gIHRhYmxlTG9jYXRvcjogc3RyaW5nLFxyXG4gIHRyYW5zYWN0aW9uU3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzLFxyXG4gIG5lZWRUb1BhZ2luYXRlOiBib29sZWFuLFxyXG4pIHtcclxuICBjb25zdCB0eG5zID0gW107XHJcbiAgbGV0IGhhc05leHRQYWdlID0gZmFsc2U7XHJcblxyXG4gIGRvIHtcclxuICAgIGNvbnN0IGN1cnJlbnRQYWdlVHhucyA9IGF3YWl0IGV4dHJhY3RUcmFuc2FjdGlvbnMocGFnZSwgdGFibGVMb2NhdG9yLCB0cmFuc2FjdGlvblN0YXR1cyk7XHJcbiAgICB0eG5zLnB1c2goLi4uY3VycmVudFBhZ2VUeG5zKTtcclxuICAgIGlmIChuZWVkVG9QYWdpbmF0ZSkge1xyXG4gICAgICBoYXNOZXh0UGFnZSA9IGF3YWl0IGNoZWNrSWZIYXNOZXh0UGFnZShwYWdlKTtcclxuICAgICAgaWYgKGhhc05leHRQYWdlKSB7XHJcbiAgICAgICAgYXdhaXQgbmF2aWdhdGVUb05leHRQYWdlKHBhZ2UpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfSB3aGlsZSAoaGFzTmV4dFBhZ2UpO1xyXG5cclxuICByZXR1cm4gY29udmVydFRyYW5zYWN0aW9ucyh0eG5zKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZ2V0QWNjb3VudFRyYW5zYWN0aW9ucyhwYWdlOiBQYWdlIHwgRnJhbWUpIHtcclxuICBhd2FpdCBQcm9taXNlLnJhY2UoW1xyXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIFwiZGl2W2lkKj0nZGl2VGFibGUnXVwiLCBmYWxzZSksXHJcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgYC4ke0VSUk9SX01FU1NBR0VfQ0xBU1N9YCwgZmFsc2UpLFxyXG4gIF0pO1xyXG5cclxuICBjb25zdCBub1RyYW5zYWN0aW9uSW5SYW5nZUVycm9yID0gYXdhaXQgaXNOb1RyYW5zYWN0aW9uSW5EYXRlUmFuZ2VFcnJvcihwYWdlKTtcclxuICBpZiAobm9UcmFuc2FjdGlvbkluUmFuZ2VFcnJvcikge1xyXG4gICAgcmV0dXJuIFtdO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgcGVuZGluZ1R4bnMgPSBhd2FpdCBzY3JhcGVUcmFuc2FjdGlvbnMocGFnZSwgUEVORElOR19UUkFOU0FDVElPTlNfVEFCTEUsIFRyYW5zYWN0aW9uU3RhdHVzZXMuUGVuZGluZywgZmFsc2UpO1xyXG4gIGNvbnN0IGNvbXBsZXRlZFR4bnMgPSBhd2FpdCBzY3JhcGVUcmFuc2FjdGlvbnMoXHJcbiAgICBwYWdlLFxyXG4gICAgQ09NUExFVEVEX1RSQU5TQUNUSU9OU19UQUJMRSxcclxuICAgIFRyYW5zYWN0aW9uU3RhdHVzZXMuQ29tcGxldGVkLFxyXG4gICAgdHJ1ZSxcclxuICApO1xyXG4gIGNvbnN0IHR4bnMgPSBbLi4ucGVuZGluZ1R4bnMsIC4uLmNvbXBsZXRlZFR4bnNdO1xyXG4gIHJldHVybiB0eG5zO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZXRDdXJyZW50QmFsYW5jZShwYWdlOiBQYWdlIHwgRnJhbWUpOiBQcm9taXNlPG51bWJlcj4ge1xyXG4gIC8vIFdhaXQgZm9yIHRoZSBiYWxhbmNlIGVsZW1lbnQgdG8gYXBwZWFyIGFuZCBiZSB2aXNpYmxlXHJcbiAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIENVUlJFTlRfQkFMQU5DRSwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XHJcblxyXG4gIC8vIEV4dHJhY3QgdGV4dCBjb250ZW50XHJcbiAgY29uc3QgYmFsYW5jZVN0ciA9IGF3YWl0IHBhZ2UuJGV2YWwoQ1VSUkVOVF9CQUxBTkNFLCBlbCA9PiB7XHJcbiAgICByZXR1cm4gKGVsIGFzIEhUTUxFbGVtZW50KS5pbm5lclRleHQ7XHJcbiAgfSk7XHJcblxyXG4gIHJldHVybiBnZXRBbW91bnREYXRhKGJhbGFuY2VTdHIpO1xyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2FpdEZvclBvc3RMb2dpbihwYWdlOiBQYWdlKSB7XHJcbiAgcmV0dXJuIFByb21pc2UucmFjZShbXHJcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNjYXJkLWhlYWRlcicsIHRydWUpLCAvLyBOZXcgVUlcclxuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI2FjY291bnRfbnVtJywgdHJ1ZSksIC8vIE5ldyBVSVxyXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICcjbWF0YWZMb2dvdXRMaW5rJywgdHJ1ZSksIC8vIE9sZCBVSVxyXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICcjdmFsaWRhdGlvbk1zZycsIHRydWUpLCAvLyBPbGQgVUlcclxuICBdKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBY2NvdW50RGF0YShwYWdlOiBQYWdlIHwgRnJhbWUsIHN0YXJ0RGF0ZTogTW9tZW50KSB7XHJcbiAgY29uc3QgYWNjb3VudE51bWJlciA9IGF3YWl0IGdldEFjY291bnROdW1iZXIocGFnZSk7XHJcbiAgY29uc3QgYmFsYW5jZSA9IGF3YWl0IGdldEN1cnJlbnRCYWxhbmNlKHBhZ2UpO1xyXG4gIGF3YWl0IHNlYXJjaEJ5RGF0ZXMocGFnZSwgc3RhcnREYXRlKTtcclxuICBjb25zdCB0eG5zID0gYXdhaXQgZ2V0QWNjb3VudFRyYW5zYWN0aW9ucyhwYWdlKTtcclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIGFjY291bnROdW1iZXIsXHJcbiAgICB0eG5zLFxyXG4gICAgYmFsYW5jZSxcclxuICB9O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZXRBY2NvdW50SWRzT2xkVUkocGFnZTogUGFnZSk6IFByb21pc2U8c3RyaW5nW10+IHtcclxuICByZXR1cm4gcGFnZS5ldmFsdWF0ZSgoKSA9PiB7XHJcbiAgICBjb25zdCBzZWxlY3RFbGVtZW50ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FjY291bnRfbnVtX3NlbGVjdCcpO1xyXG4gICAgY29uc3Qgb3B0aW9ucyA9IHNlbGVjdEVsZW1lbnQgPyBzZWxlY3RFbGVtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ29wdGlvbicpIDogW107XHJcbiAgICBpZiAoIW9wdGlvbnMpIHJldHVybiBbXTtcclxuICAgIHJldHVybiBBcnJheS5mcm9tKG9wdGlvbnMsIG9wdGlvbiA9PiBvcHRpb24udmFsdWUpO1xyXG4gIH0pO1xyXG59XHJcblxyXG4vKipcclxuICogRW5zdXJlcyB0aGUgYWNjb3VudCBkcm9wZG93biBpcyBvcGVuLCB0aGVuIHJldHVybnMgdGhlIGF2YWlsYWJsZSBhY2NvdW50IGxhYmVscy5cclxuICpcclxuICogVGhpcyBtZXRob2Q6XHJcbiAqIC0gQ2hlY2tzIGlmIHRoZSBkcm9wZG93biBpcyBhbHJlYWR5IG9wZW4uXHJcbiAqIC0gSWYgbm90IG9wZW4sIGNsaWNrcyB0aGUgYWNjb3VudCBzZWxlY3RvciB0byBvcGVuIGl0LlxyXG4gKiAtIFdhaXRzIGZvciB0aGUgZHJvcGRvd24gdG8gcmVuZGVyLlxyXG4gKiAtIEV4dHJhY3RzIGFuZCByZXR1cm5zIHRoZSBsaXN0IG9mIGF2YWlsYWJsZSBhY2NvdW50IGxhYmVscy5cclxuICpcclxuICogR3JhY2VmdWwgaGFuZGxpbmc6XHJcbiAqIC0gSWYgYW55IGVycm9yIG9jY3VycyAoZS5nLiwgc2VsZWN0b3JzIG5vdCBmb3VuZCwgdGltaW5nIGlzc3VlcywgVUkgdmVyc2lvbiBjaGFuZ2VzKSxcclxuICogICB0aGUgZnVuY3Rpb24gcmV0dXJucyBhbiBlbXB0eSBsaXN0LlxyXG4gKlxyXG4gKiBAcGFyYW0gcGFnZSBQdXBwZXRlZXIgUGFnZSBvYmplY3QuXHJcbiAqIEByZXR1cm5zIEFuIGFycmF5IG9mIGF2YWlsYWJsZSBhY2NvdW50IGxhYmVscyAoZS5nLiwgW1wiMTI3IHwgWFhYWDFcIiwgXCIxMjcgfCBYWFhYMlwiXSksXHJcbiAqICAgICAgICAgIG9yIGFuIGVtcHR5IGFycmF5IGlmIHNvbWV0aGluZyBnb2VzIHdyb25nLlxyXG4gKi9cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNsaWNrQWNjb3VudFNlbGVjdG9yR2V0QWNjb3VudElkcyhwYWdlOiBQYWdlKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBhY2NvdW50U2VsZWN0b3IgPSAnZGl2LmN1cnJlbnQtYWNjb3VudCc7IC8vIERpcmVjdCBzZWxlY3RvciB0byBjbGlja2FibGUgZWxlbWVudFxyXG4gICAgY29uc3QgZHJvcGRvd25QYW5lbFNlbGVjdG9yID0gJ2Rpdi5tYXQtbWRjLWF1dG9jb21wbGV0ZS1wYW5lbC5hY2NvdW50LXNlbGVjdC1kZCc7IC8vIFRoZSBkcm9wZG93biBsaXN0IGJveFxyXG4gICAgY29uc3Qgb3B0aW9uU2VsZWN0b3IgPSAnbWF0LW9wdGlvbiAubWRjLWxpc3QtaXRlbV9fcHJpbWFyeS10ZXh0JzsgLy8gQWNjb3VudCBvcHRpb24gbGFiZWxzXHJcblxyXG4gICAgLy8gQ2hlY2sgaWYgZHJvcGRvd24gaXMgYWxyZWFkeSBvcGVuXHJcbiAgICBjb25zdCBkcm9wZG93blZpc2libGUgPSBhd2FpdCBwYWdlXHJcbiAgICAgIC4kZXZhbChkcm9wZG93blBhbmVsU2VsZWN0b3IsIGVsID0+IHtcclxuICAgICAgICByZXR1cm4gZWwgJiYgd2luZG93LmdldENvbXB1dGVkU3R5bGUoZWwpLmRpc3BsYXkgIT09ICdub25lJyAmJiBlbC5vZmZzZXRQYXJlbnQgIT09IG51bGw7XHJcbiAgICAgIH0pXHJcbiAgICAgIC5jYXRjaCgoKSA9PiBmYWxzZSk7IC8vIGNhdGNoIGlmIGRyb3Bkb3duIGlzIG5vdCBpbiB0aGUgRE9NIHlldFxyXG5cclxuICAgIGlmICghZHJvcGRvd25WaXNpYmxlKSB7XHJcbiAgICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBhY2NvdW50U2VsZWN0b3IsIHRydWUsIEVMRU1FTlRfUkVOREVSX1RJTUVPVVRfTVMpO1xyXG5cclxuICAgICAgLy8gQ2xpY2sgdGhlIGFjY291bnQgc2VsZWN0b3IgdG8gb3BlbiB0aGUgZHJvcGRvd25cclxuICAgICAgYXdhaXQgY2xpY2tCdXR0b24ocGFnZSwgYWNjb3VudFNlbGVjdG9yKTtcclxuXHJcbiAgICAgIC8vIFdhaXQgZm9yIHRoZSBkcm9wZG93biB0byBvcGVuXHJcbiAgICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBkcm9wZG93blBhbmVsU2VsZWN0b3IsIHRydWUsIEVMRU1FTlRfUkVOREVSX1RJTUVPVVRfTVMpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEV4dHJhY3QgYWNjb3VudCBsYWJlbHMgZnJvbSB0aGUgZHJvcGRvd24gb3B0aW9uc1xyXG4gICAgY29uc3QgYWNjb3VudExhYmVscyA9IGF3YWl0IHBhZ2UuJCRldmFsKG9wdGlvblNlbGVjdG9yLCBvcHRpb25zID0+IHtcclxuICAgICAgcmV0dXJuIG9wdGlvbnMubWFwKG9wdGlvbiA9PiBvcHRpb24udGV4dENvbnRlbnQ/LnRyaW0oKSB8fCAnJykuZmlsdGVyKGxhYmVsID0+IGxhYmVsICE9PSAnJyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICByZXR1cm4gYWNjb3VudExhYmVscztcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgcmV0dXJuIFtdOyAvLyBHcmFjZWZ1bCBmYWxsYmFja1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZ2V0QWNjb3VudElkc0JvdGhVSXMocGFnZTogUGFnZSk6IFByb21pc2U8c3RyaW5nW10+IHtcclxuICBsZXQgYWNjb3VudHNJZHM6IHN0cmluZ1tdID0gYXdhaXQgY2xpY2tBY2NvdW50U2VsZWN0b3JHZXRBY2NvdW50SWRzKHBhZ2UpO1xyXG4gIGlmIChhY2NvdW50c0lkcy5sZW5ndGggPT09IDApIHtcclxuICAgIGFjY291bnRzSWRzID0gYXdhaXQgZ2V0QWNjb3VudElkc09sZFVJKHBhZ2UpO1xyXG4gIH1cclxuICByZXR1cm4gYWNjb3VudHNJZHM7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBTZWxlY3RzIGFuIGFjY291bnQgZnJvbSB0aGUgZHJvcGRvd24gYmFzZWQgb24gdGhlIHByb3ZpZGVkIGFjY291bnQgbGFiZWwuXHJcbiAqXHJcbiAqIFRoaXMgbWV0aG9kOlxyXG4gKiAtIENsaWNrcyB0aGUgYWNjb3VudCBzZWxlY3RvciBidXR0b24gdG8gb3BlbiB0aGUgZHJvcGRvd24uXHJcbiAqIC0gUmV0cmlldmVzIHRoZSBsaXN0IG9mIGF2YWlsYWJsZSBhY2NvdW50IGxhYmVscy5cclxuICogLSBDaGVja3MgaWYgdGhlIHByb3ZpZGVkIGFjY291bnQgbGFiZWwgZXhpc3RzIGluIHRoZSBsaXN0LlxyXG4gKiAtIEZpbmRzIGFuZCBjbGlja3MgdGhlIG1hdGNoaW5nIGFjY291bnQgb3B0aW9uIGlmIGZvdW5kLlxyXG4gKlxyXG4gKiBAcGFyYW0gcGFnZSBQdXBwZXRlZXIgUGFnZSBvYmplY3QuXHJcbiAqIEBwYXJhbSBhY2NvdW50TGFiZWwgVGhlIHRleHQgb2YgdGhlIGFjY291bnQgdG8gc2VsZWN0IChlLmcuLCBcIjEyNyB8IFhYWFhYXCIpLlxyXG4gKiBAcmV0dXJucyBUcnVlIGlmIHRoZSBhY2NvdW50IG9wdGlvbiB3YXMgZm91bmQgYW5kIGNsaWNrZWQ7IGZhbHNlIG90aGVyd2lzZS5cclxuICovXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzZWxlY3RBY2NvdW50RnJvbURyb3Bkb3duKHBhZ2U6IFBhZ2UsIGFjY291bnRMYWJlbDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XHJcbiAgLy8gQ2FsbCBjbGlja0FjY291bnRTZWxlY3RvciB0byBnZXQgdGhlIGF2YWlsYWJsZSBhY2NvdW50cyBhbmQgb3BlbiB0aGUgZHJvcGRvd25cclxuICBjb25zdCBhdmFpbGFibGVBY2NvdW50cyA9IGF3YWl0IGNsaWNrQWNjb3VudFNlbGVjdG9yR2V0QWNjb3VudElkcyhwYWdlKTtcclxuXHJcbiAgLy8gQ2hlY2sgaWYgdGhlIGFjY291bnQgbGFiZWwgZXhpc3RzIGluIHRoZSBhdmFpbGFibGUgYWNjb3VudHNcclxuICBpZiAoIWF2YWlsYWJsZUFjY291bnRzLmluY2x1ZGVzKGFjY291bnRMYWJlbCkpIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcblxyXG4gIC8vIFdhaXQgZm9yIHRoZSBkcm9wZG93biBvcHRpb25zIHRvIGJlIHJlbmRlcmVkXHJcbiAgY29uc3Qgb3B0aW9uU2VsZWN0b3IgPSAnbWF0LW9wdGlvbiAubWRjLWxpc3QtaXRlbV9fcHJpbWFyeS10ZXh0JztcclxuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgb3B0aW9uU2VsZWN0b3IsIHRydWUsIEVMRU1FTlRfUkVOREVSX1RJTUVPVVRfTVMpO1xyXG5cclxuICAvLyBRdWVyeSBhbGwgbWF0Y2hpbmcgb3B0aW9uc1xyXG4gIGNvbnN0IGFjY291bnRPcHRpb25zID0gYXdhaXQgcGFnZS4kJChvcHRpb25TZWxlY3Rvcik7XHJcblxyXG4gIC8vIEZpbmQgYW5kIGNsaWNrIHRoZSBvcHRpb24gbWF0Y2hpbmcgdGhlIGFjY291bnRMYWJlbFxyXG4gIGZvciAoY29uc3Qgb3B0aW9uIG9mIGFjY291bnRPcHRpb25zKSB7XHJcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcGFnZS5ldmFsdWF0ZShlbCA9PiBlbC50ZXh0Q29udGVudD8udHJpbSgpLCBvcHRpb24pO1xyXG5cclxuICAgIGlmICh0ZXh0ID09PSBhY2NvdW50TGFiZWwpIHtcclxuICAgICAgY29uc3Qgb3B0aW9uSGFuZGxlID0gYXdhaXQgb3B0aW9uLmV2YWx1YXRlSGFuZGxlKGVsID0+IGVsIGFzIEhUTUxFbGVtZW50KTtcclxuICAgICAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoZWw6IEhUTUxFbGVtZW50KSA9PiBlbC5jbGljaygpLCBvcHRpb25IYW5kbGUpO1xyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHJldHVybiBmYWxzZTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25zRnJhbWUocGFnZTogUGFnZSk6IFByb21pc2U8RnJhbWUgfCBudWxsPiB7XHJcbiAgLy8gVHJ5IGEgZmV3IHRpbWVzIHRvIGZpbmQgdGhlIGlmcmFtZSwgYXMgaXQgbWlnaHQgbm90IGJlIGltbWVkaWF0ZWx5IGF2YWlsYWJsZVxyXG4gIGZvciAobGV0IGF0dGVtcHQgPSAwOyBhdHRlbXB0IDwgMzsgYXR0ZW1wdCsrKSB7XHJcbiAgICBhd2FpdCBzbGVlcCgyMDAwKTtcclxuICAgIGNvbnN0IGZyYW1lcyA9IHBhZ2UuZnJhbWVzKCk7XHJcbiAgICBjb25zdCB0YXJnZXRGcmFtZSA9IGZyYW1lcy5maW5kKGYgPT4gZi5uYW1lKCkgPT09IElGUkFNRV9OQU1FKTtcclxuXHJcbiAgICBpZiAodGFyZ2V0RnJhbWUpIHtcclxuICAgICAgcmV0dXJuIHRhcmdldEZyYW1lO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHNlbGVjdEFjY291bnRCb3RoVUlzKHBhZ2U6IFBhZ2UsIGFjY291bnRJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc3QgYWNjb3VudFNlbGVjdGVkID0gYXdhaXQgc2VsZWN0QWNjb3VudEZyb21Ecm9wZG93bihwYWdlLCBhY2NvdW50SWQpO1xyXG4gIGlmICghYWNjb3VudFNlbGVjdGVkKSB7XHJcbiAgICAvLyBPbGQgVUkgZm9ybWF0XHJcbiAgICBhd2FpdCBwYWdlLnNlbGVjdCgnI2FjY291bnRfbnVtX3NlbGVjdCcsIGFjY291bnRJZCk7XHJcbiAgICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNhY2NvdW50X251bV9zZWxlY3QnLCB0cnVlKTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGZldGNoQWNjb3VudERhdGFCb3RoVUlzKHBhZ2U6IFBhZ2UsIHN0YXJ0RGF0ZTogTW9tZW50KSB7XHJcbiAgLy8gVHJ5IHRvIGdldCB0aGUgaWZyYW1lIGZvciB0aGUgbmV3IFVJXHJcbiAgY29uc3QgZnJhbWUgPSBhd2FpdCBnZXRUcmFuc2FjdGlvbnNGcmFtZShwYWdlKTtcclxuXHJcbiAgLy8gVXNlIHRoZSBmcmFtZSBpZiBhdmFpbGFibGUgKG5ldyBVSSksIG90aGVyd2lzZSB1c2UgdGhlIHBhZ2UgZGlyZWN0bHkgKG9sZCBVSSlcclxuICBjb25zdCB0YXJnZXRQYWdlID0gZnJhbWUgfHwgcGFnZTtcclxuICByZXR1cm4gZmV0Y2hBY2NvdW50RGF0YSh0YXJnZXRQYWdlLCBzdGFydERhdGUpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBmZXRjaEFjY291bnRzKHBhZ2U6IFBhZ2UsIHN0YXJ0RGF0ZTogTW9tZW50KTogUHJvbWlzZTxUcmFuc2FjdGlvbnNBY2NvdW50W10+IHtcclxuICBjb25zdCBhY2NvdW50c0lkcyA9IGF3YWl0IGdldEFjY291bnRJZHNCb3RoVUlzKHBhZ2UpO1xyXG5cclxuICBpZiAoYWNjb3VudHNJZHMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAvLyBJbiBjYXNlIGFjY291bnRzSWRzIGNvdWxkIG5vIGJlIHBhcnNlZCBqdXN0IHJldHVybiB0aGUgdHJhbnNhY3Rpb25zIG9mIHRoZSBjdXJyZW50bHkgc2VsZWN0ZWQgYWNjb3VudFxyXG4gICAgY29uc3QgYWNjb3VudERhdGEgPSBhd2FpdCBmZXRjaEFjY291bnREYXRhQm90aFVJcyhwYWdlLCBzdGFydERhdGUpO1xyXG4gICAgcmV0dXJuIFthY2NvdW50RGF0YV07XHJcbiAgfVxyXG5cclxuICBjb25zdCBhY2NvdW50czogVHJhbnNhY3Rpb25zQWNjb3VudFtdID0gW107XHJcbiAgZm9yIChjb25zdCBhY2NvdW50SWQgb2YgYWNjb3VudHNJZHMpIHtcclxuICAgIGF3YWl0IHNlbGVjdEFjY291bnRCb3RoVUlzKHBhZ2UsIGFjY291bnRJZCk7XHJcbiAgICBjb25zdCBhY2NvdW50RGF0YSA9IGF3YWl0IGZldGNoQWNjb3VudERhdGFCb3RoVUlzKHBhZ2UsIHN0YXJ0RGF0ZSk7XHJcbiAgICBhY2NvdW50cy5wdXNoKGFjY291bnREYXRhKTtcclxuICB9XHJcblxyXG4gIHJldHVybiBhY2NvdW50cztcclxufVxyXG5cclxudHlwZSBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscyA9IHsgdXNlcm5hbWU6IHN0cmluZzsgcGFzc3dvcmQ6IHN0cmluZyB9O1xyXG5cclxuY2xhc3MgQmVpbmxldW1pR3JvdXBCYXNlU2NyYXBlciBleHRlbmRzIEJhc2VTY3JhcGVyV2l0aEJyb3dzZXI8U2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHM+IHtcclxuICBCQVNFX1VSTCA9ICcnO1xyXG5cclxuICBMT0dJTl9VUkwgPSAnJztcclxuXHJcbiAgVFJBTlNBQ1RJT05TX1VSTCA9ICcnO1xyXG5cclxuICBnZXRMb2dpbk9wdGlvbnMoY3JlZGVudGlhbHM6IFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBsb2dpblVybDogYCR7dGhpcy5MT0dJTl9VUkx9YCxcclxuICAgICAgZmllbGRzOiBjcmVhdGVMb2dpbkZpZWxkcyhjcmVkZW50aWFscyksXHJcbiAgICAgIHN1Ym1pdEJ1dHRvblNlbGVjdG9yOiAnI2NvbnRpbnVlQnRuJyxcclxuICAgICAgcG9zdEFjdGlvbjogYXN5bmMgKCkgPT4gd2FpdEZvclBvc3RMb2dpbih0aGlzLnBhZ2UpLFxyXG4gICAgICBwb3NzaWJsZVJlc3VsdHM6IGdldFBvc3NpYmxlTG9naW5SZXN1bHRzKCksXHJcbiAgICAgIC8vIEhBQ0s6IEZvciBzb21lIHJlYXNvbiwgdGhvdWdoIHRoZSBsb2dpbiBidXR0b24gKCNjb250aW51ZUJ0bikgaXMgcHJlc2VudCBhbmQgdmlzaWJsZSwgdGhlIGNsaWNrIGFjdGlvbiBkb2VzIG5vdCBwZXJmb3JtLlxyXG4gICAgICAvLyBBZGRpbmcgdGhpcyBkZWxheSBmaXhlcyB0aGUgaXNzdWUuXHJcbiAgICAgIHByZUFjdGlvbjogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGF3YWl0IHNsZWVwKDEwMDApO1xyXG4gICAgICB9LFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGZldGNoRGF0YSgpIHtcclxuICAgIGNvbnN0IGRlZmF1bHRTdGFydE1vbWVudCA9IG1vbWVudCgpLnN1YnRyYWN0KDEsICd5ZWFycycpLmFkZCgxLCAnZGF5Jyk7XHJcbiAgICBjb25zdCBzdGFydE1vbWVudExpbWl0ID0gbW9tZW50KHsgeWVhcjogMTYwMCB9KTtcclxuICAgIGNvbnN0IHN0YXJ0RGF0ZSA9IHRoaXMub3B0aW9ucy5zdGFydERhdGUgfHwgZGVmYXVsdFN0YXJ0TW9tZW50LnRvRGF0ZSgpO1xyXG4gICAgY29uc3Qgc3RhcnRNb21lbnQgPSBtb21lbnQubWF4KHN0YXJ0TW9tZW50TGltaXQsIG1vbWVudChzdGFydERhdGUpKTtcclxuXHJcbiAgICBhd2FpdCB0aGlzLm5hdmlnYXRlVG8odGhpcy5UUkFOU0FDVElPTlNfVVJMKTtcclxuXHJcbiAgICBjb25zdCBhY2NvdW50cyA9IGF3YWl0IGZldGNoQWNjb3VudHModGhpcy5wYWdlLCBzdGFydE1vbWVudCk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgYWNjb3VudHMsXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQgQmVpbmxldW1pR3JvdXBCYXNlU2NyYXBlcjtcclxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7OztBQUFBLElBQUFBLE9BQUEsR0FBQUMsc0JBQUEsQ0FBQUMsT0FBQTtBQUVBLElBQUFDLFVBQUEsR0FBQUQsT0FBQTtBQUNBLElBQUFFLHFCQUFBLEdBQUFGLE9BQUE7QUFPQSxJQUFBRyxXQUFBLEdBQUFILE9BQUE7QUFDQSxJQUFBSSxRQUFBLEdBQUFKLE9BQUE7QUFDQSxJQUFBSyxhQUFBLEdBQUFMLE9BQUE7QUFDQSxJQUFBTSx1QkFBQSxHQUFBTixPQUFBO0FBQThHLFNBQUFELHVCQUFBUSxDQUFBLFdBQUFBLENBQUEsSUFBQUEsQ0FBQSxDQUFBQyxVQUFBLEdBQUFELENBQUEsS0FBQUUsT0FBQSxFQUFBRixDQUFBO0FBRTlHLE1BQU1HLFdBQVcsR0FBRyxZQUFZO0FBQ2hDLE1BQU1DLGlDQUFpQyxHQUFHLDhCQUE4QjtBQUN4RSxNQUFNQywyQkFBMkIsR0FBRyxZQUFZO0FBQ2hELE1BQU1DLHlCQUF5QixHQUFHLFlBQVk7QUFDOUMsTUFBTUMsa0NBQWtDLEdBQUcsdUJBQXVCO0FBQ2xFLE1BQU1DLGdDQUFnQyxHQUFHLHFCQUFxQjtBQUM5RCxNQUFNQyxzQkFBc0IsR0FBRyxTQUFTO0FBQ3hDLE1BQU1DLGtCQUFrQixHQUFHLE9BQU87QUFDbEMsTUFBTUMsbUJBQW1CLEdBQUcsUUFBUTtBQUNwQyxNQUFNQyxtQkFBbUIsR0FBRyxTQUFTO0FBQ3JDLE1BQU1DLGVBQWUsR0FBRywrQkFBK0I7QUFDdkQsTUFBTUMsa0NBQWtDLEdBQUcs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