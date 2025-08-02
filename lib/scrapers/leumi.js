"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _moment = _interopRequireDefault(require("moment"));
var _constants = require("../constants");
var _debug = require("../helpers/debug");
var _elementsInteractions = require("../helpers/elements-interactions");
var _navigation = require("../helpers/navigation");
var _transactions = require("../transactions");
var _baseScraperWithBrowser = require("./base-scraper-with-browser");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const debug = (0, _debug.getDebug)('leumi');
const BASE_URL = 'https://hb2.bankleumi.co.il';
const LOGIN_URL = 'https://www.leumi.co.il/';
const TRANSACTIONS_URL = `${BASE_URL}/eBanking/SO/SPA.aspx#/ts/BusinessAccountTrx?WidgetPar=1`;
const FILTERED_TRANSACTIONS_URL = `${BASE_URL}/ChannelWCF/Broker.svc/ProcessRequest?moduleName=UC_SO_27_GetBusinessAccountTrx`;
const DATE_FORMAT = 'DD.MM.YY';
const ACCOUNT_BLOCKED_MSG = 'המנוי חסום';
const INVALID_PASSWORD_MSG = 'אחד או יותר מפרטי ההזדהות שמסרת שגויים. ניתן לנסות שוב';
function getPossibleLoginResults() {
  const urls = {
    [_baseScraperWithBrowser.LoginResults.Success]: [/ebanking\/SO\/SPA.aspx/i, /staticcontent\/digitalfront\/he/i, /staticcontent\/gate-keeper\/he/i],
    [_baseScraperWithBrowser.LoginResults.InvalidPassword]: [async options => {
      if (!options || !options.page) {
        throw new Error('missing page options argument');
      }
      const errorMessage = await (0, _elementsInteractions.pageEvalAll)(options.page, 'svg#Capa_1', '', element => {
        return element[0]?.parentElement?.children[1]?.innerText;
      });
      return errorMessage?.startsWith(INVALID_PASSWORD_MSG);
    }],
    [_baseScraperWithBrowser.LoginResults.AccountBlocked]: [
    // NOTICE - might not be relevant starting the Leumi re-design during 2022 Sep
    async options => {
      if (!options || !options.page) {
        throw new Error('missing page options argument');
      }
      const errorMessage = await (0, _elementsInteractions.pageEvalAll)(options.page, '.errHeader', '', label => {
        return label[0]?.innerText;
      });
      return errorMessage?.startsWith(ACCOUNT_BLOCKED_MSG);
    }],
    [_baseScraperWithBrowser.LoginResults.ChangePassword]: ['https://hb2.bankleumi.co.il/authenticate'] // NOTICE - might not be relevant starting the Leumi re-design during 2022 Sep
  };
  return urls;
}
function createLoginFields(credentials) {
  return [{
    selector: 'input[placeholder="שם משתמש"]',
    value: credentials.username
  }, {
    selector: 'input[placeholder="סיסמה"]',
    value: credentials.password
  }];
}
function extractTransactionsFromPage(transactions, status) {
  if (transactions === null || transactions.length === 0) {
    return [];
  }
  const result = transactions.map(rawTransaction => {
    const date = (0, _moment.default)(rawTransaction.DateUTC).milliseconds(0).toISOString();
    const newTransaction = {
      status,
      type: _transactions.TransactionTypes.Normal,
      date,
      processedDate: date,
      description: rawTransaction.Description || '',
      identifier: rawTransaction.ReferenceNumberLong,
      memo: rawTransaction.AdditionalData || '',
      originalCurrency: _constants.SHEKEL_CURRENCY,
      chargedAmount: rawTransaction.Amount,
      originalAmount: rawTransaction.Amount
    };
    console.log(`Transaction: ${JSON.stringify(newTransaction)}`);
    return newTransaction;
  });
  return result;
}
function hangProcess(timeout) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, timeout);
  });
}
async function clickByXPath(page, xpath) {
  await page.waitForSelector(xpath, {
    timeout: 30000,
    visible: true
  });
  const elm = await page.$$(xpath);
  await elm[0].click();
}
function removeSpecialCharacters(str) {
  return str.replace(/[^0-9/-]/g, '');
}
async function fetchTransactionsForAccount(page, startDate, accountId) {
  // DEVELOPER NOTICE the account number received from the server is being altered at
  // runtime for some accounts after 1-2 seconds so we need to hang the process for a short while.
  await hangProcess(4000);
  await (0, _elementsInteractions.waitUntilElementFound)(page, 'button[title="חיפוש מתקדם"]', true);
  await (0, _elementsInteractions.clickButton)(page, 'button[title="חיפוש מתקדם"]');
  await (0, _elementsInteractions.waitUntilElementFound)(page, 'bll-radio-button', true);
  await (0, _elementsInteractions.clickButton)(page, 'bll-radio-button:not([checked])');
  await (0, _elementsInteractions.waitUntilElementFound)(page, 'input[formcontrolname="txtInputFrom"]', true);
  await (0, _elementsInteractions.fillInput)(page, 'input[formcontrolname="txtInputFrom"]', startDate.format(DATE_FORMAT));

  // we must blur the from control otherwise the search will use the previous value
  await page.focus("button[aria-label='סנן']");
  await (0, _elementsInteractions.clickButton)(page, "button[aria-label='סנן']");
  const finalResponse = await page.waitForResponse(response => {
    return response.url() === FILTERED_TRANSACTIONS_URL && response.request().method() === 'POST';
  });
  const responseJson = await finalResponse.json();
  const accountNumber = accountId.replace('/', '_').replace(/[^\d-_]/g, '');
  const response = JSON.parse(responseJson.jsonResp);
  const pendingTransactions = response.TodayTransactionsItems;
  const transactions = response.HistoryTransactionsItems;
  const balance = response.BalanceDisplay ? parseFloat(response.BalanceDisplay) : undefined;
  const pendingTxns = extractTransactionsFromPage(pendingTransactions, _transactions.TransactionStatuses.Pending);
  const completedTxns = extractTransactionsFromPage(transactions, _transactions.TransactionStatuses.Completed);
  const txns = [...pendingTxns, ...completedTxns];
  return {
    accountNumber,
    balance,
    txns
  };
}
async function fetchTransactions(page, startDate) {
  console.log('=== FETCHTRANSACTIONS DEBUG ===');
  const accounts = [];

  // DEVELOPER NOTICE the account number received from the server is being altered at
  // runtime for some accounts after 1-2 seconds so we need to hang the process for a short while.
  console.log('Waiting 4 seconds for account elements to stabilize...');
  await hangProcess(4000);
  console.log('Current URL in fetchTransactions:', page.url());
  console.log('Looking for account selector: app-masked-number-combo span.display-number-li');
  let accountsIds = [];
  try {
    console.log('Trying original selector: app-masked-number-combo span.display-number-li');
    accountsIds = await page.evaluate(() => Array.from(document.querySelectorAll('app-masked-number-combo span.display-number-li'), e => e.textContent));
    console.log('Original selector found account IDs:', accountsIds);
    if (accountsIds.length === 0) {
      console.log('Original selector failed, trying alternative selectors for new website...');

      // Try various selectors that might contain account numbers in the new website
      const selectors = ['[data-tid="account-selector-number"] span[aria-hidden="true"]',
      // New Leumi website specific selector
      '[data-tid*="account"] span[aria-hidden="true"]', '[data-tid*="account-selector"] span', 'div[data-tid*="account"] span', 'span[class*="account"]', 'span[class*="number"]', 'div[class*="account"]', 'div[class*="number"]', '[data-testid*="account"]', '[data-testid*="number"]', 'span:contains("/")',
      // Account numbers often contain slashes
      'div:contains("/")'];
      for (const selector of selectors) {
        console.log(`Trying selector: ${selector}`);
        try {
          const results = await page.evaluate(sel => {
            if (sel.includes(':contains')) {
              // Handle :contains pseudo-selector manually
              const elements = Array.from(document.querySelectorAll(sel.split(':contains')[0]));
              const containsText = sel.match(/contains\("([^"]+)"\)/)?.[1];
              return elements.filter(el => el.textContent && containsText && el.textContent.includes(containsText)).map(el => el.textContent.trim()).filter(text => text && text.length > 0);
            } else {
              return Array.from(document.querySelectorAll(sel), e => e.textContent?.trim()).filter(text => text && text.length > 0);
            }
          }, selector);
          if (results.length > 0) {
            console.log(`Selector ${selector} found results:`, results);
            // Filter for account-like patterns (containing digits and possibly slashes/dashes)
            const accountLike = results.filter(text => text != null && /\d/.test(text) && text.length >= 4);
            if (accountLike.length > 0) {
              accountsIds = accountLike;
              console.log(`Using account IDs from ${selector}:`, accountsIds);
              break;
            }
          }
        } catch (selectorError) {
          console.log(`Selector ${selector} failed:`, selectorError.message);
        }
      }

      // If still no accounts found, try a more general approach
      if (accountsIds.length === 0) {
        console.log('All specific selectors failed, trying general text content search...');
        accountsIds = await page.evaluate(() => {
          const allElements = Array.from(document.querySelectorAll('*'));
          const accountPatterns = [];
          for (const el of allElements) {
            const text = el.textContent?.trim();
            if (text && text.length > 4 && text.length < 20) {
              // Look for patterns like: 123/456789, 12-3456-789, etc.
              if (/^\d+[-\/]\d+/.test(text) || /^\d{4,}$/.test(text)) {
                accountPatterns.push(text);
              }
            }
          }

          // Remove duplicates and return unique account-like patterns
          return [...new Set(accountPatterns)].slice(0, 5); // Limit to 5 to avoid too many false positives
        });
        console.log('General search found potential account patterns:', accountsIds);
      }
    }
    if (accountsIds.length === 0) {
      console.log('No account selectors worked. The new website might require different navigation.');
      // Return a default account to continue with transaction extraction attempt
      accountsIds = ['DEFAULT-ACCOUNT'];
      console.log('Using default account to continue processing');
    }
  } catch (error) {
    console.log('Error extracting account IDs:', error.message);
    console.log('This suggests the DOM structure has changed in the new Leumi website.');
    throw error;
  }

  // due to a bug, the altered value might include undesired signs like & that should be removed

  if (!accountsIds.length) {
    throw new Error('Failed to extract or parse the account number');
  }
  for (const accountId of accountsIds) {
    if (accountsIds.length > 1) {
      // get list of accounts and check accountId
      await clickByXPath(page, 'xpath///*[contains(@class, "number") and contains(@class, "combo-inner")]');
      await clickByXPath(page, `xpath///span[contains(text(), '${accountId}')]`);
    }
    accounts.push(await fetchTransactionsForAccount(page, startDate, removeSpecialCharacters(accountId)));
  }
  return accounts;
}
async function navigateToLogin(page) {
  const loginButtonSelector = '.enter-account a[originaltitle="כניסה לחשבונך"]';
  debug('wait for homepage to click on login button');
  await (0, _elementsInteractions.waitUntilElementFound)(page, loginButtonSelector);
  debug('navigate to login page');
  const loginUrl = await (0, _elementsInteractions.pageEval)(page, loginButtonSelector, null, element => {
    return element.href;
  });
  debug(`navigating to page (${loginUrl})`);
  await page.goto(loginUrl);
  debug('waiting for page to be loaded (networkidle2)');
  await (0, _navigation.waitForNavigation)(page, {
    waitUntil: 'networkidle2'
  });
  debug('waiting for components of login to enter credentials');
  await Promise.all([(0, _elementsInteractions.waitUntilElementFound)(page, 'input[placeholder="שם משתמש"]', true), (0, _elementsInteractions.waitUntilElementFound)(page, 'input[placeholder="סיסמה"]', true), (0, _elementsInteractions.waitUntilElementFound)(page, 'button[type="submit"]', true)]);
}
async function waitForPostLogin(page) {
  debug('Waiting for post-login navigation...');
  console.log('[LEUMI DEBUG] Waiting for post-login navigation...');

  // Use URL-based detection instead of problematic XPath
  await Promise.race([
  // Wait for successful navigation to Leumi's authenticated pages
  page.waitForFunction(() => {
    const url = window.location.href;
    return url.includes('/ebanking/SO/SPA.aspx') || url.includes('/staticcontent/digitalfront/he') || url.includes('/staticcontent/gate-keeper/he');
  }, {
    timeout: 60000
  }),
  // Still check for error elements, but use more reliable selectors
  (0, _elementsInteractions.waitUntilElementFound)(page, 'a[title="דלג לחשבון"]', true, 60000), (0, _elementsInteractions.waitUntilElementFound)(page, 'div.main-content', false, 60000), (0, _elementsInteractions.waitUntilElementFound)(page, 'form[action="/changepassword"]', true, 60000)]);
  console.log('[LEUMI DEBUG] Post-login navigation completed, current URL:', page.url());
}
class LeumiScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  getLoginOptions(credentials) {
    return {
      loginUrl: LOGIN_URL,
      fields: createLoginFields(credentials),
      submitButtonSelector: "button[type='submit']",
      checkReadiness: async () => navigateToLogin(this.page),
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults()
    };
  }
  async fetchData() {
    const minimumStartMoment = (0, _moment.default)().subtract(3, 'years').add(1, 'day');
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = _moment.default.max(minimumStartMoment, (0, _moment.default)(startDate));

    // Wait for login session to be fully established
    debug('Waiting 5 seconds for login session to stabilize...');
    console.log('[LEUMI DEBUG] Waiting 5 seconds for login session to stabilize...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await this.navigateTo(TRANSACTIONS_URL);
    const accounts = await fetchTransactions(this.page, startMoment);
    return {
      success: true,
      accounts
    };
  }
}
var _default = exports.default = LeumiScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfY29uc3RhbnRzIiwiX2RlYnVnIiwiX2VsZW1lbnRzSW50ZXJhY3Rpb25zIiwiX25hdmlnYXRpb24iLCJfdHJhbnNhY3Rpb25zIiwiX2Jhc2VTY3JhcGVyV2l0aEJyb3dzZXIiLCJlIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJkZWJ1ZyIsImdldERlYnVnIiwiQkFTRV9VUkwiLCJMT0dJTl9VUkwiLCJUUkFOU0FDVElPTlNfVVJMIiwiRklMVEVSRURfVFJBTlNBQ1RJT05TX1VSTCIsIkRBVEVfRk9STUFUIiwiQUNDT1VOVF9CTE9DS0VEX01TRyIsIklOVkFMSURfUEFTU1dPUkRfTVNHIiwiZ2V0UG9zc2libGVMb2dpblJlc3VsdHMiLCJ1cmxzIiwiTG9naW5SZXN1bHRzIiwiU3VjY2VzcyIsIkludmFsaWRQYXNzd29yZCIsIm9wdGlvbnMiLCJwYWdlIiwiRXJyb3IiLCJlcnJvck1lc3NhZ2UiLCJwYWdlRXZhbEFsbCIsImVsZW1lbnQiLCJwYXJlbnRFbGVtZW50IiwiY2hpbGRyZW4iLCJpbm5lclRleHQiLCJzdGFydHNXaXRoIiwiQWNjb3VudEJsb2NrZWQiLCJsYWJlbCIsIkNoYW5nZVBhc3N3b3JkIiwiY3JlYXRlTG9naW5GaWVsZHMiLCJjcmVkZW50aWFscyIsInNlbGVjdG9yIiwidmFsdWUiLCJ1c2VybmFtZSIsInBhc3N3b3JkIiwiZXh0cmFjdFRyYW5zYWN0aW9uc0Zyb21QYWdlIiwidHJhbnNhY3Rpb25zIiwic3RhdHVzIiwibGVuZ3RoIiwicmVzdWx0IiwibWFwIiwicmF3VHJhbnNhY3Rpb24iLCJkYXRlIiwibW9tZW50IiwiRGF0ZVVUQyIsIm1pbGxpc2Vjb25kcyIsInRvSVNPU3RyaW5nIiwibmV3VHJhbnNhY3Rpb24iLCJ0eXBlIiwiVHJhbnNhY3Rpb25UeXBlcyIsIk5vcm1hbCIsInByb2Nlc3NlZERhdGUiLCJkZXNjcmlwdGlvbiIsIkRlc2NyaXB0aW9uIiwiaWRlbnRpZmllciIsIlJlZmVyZW5jZU51bWJlckxvbmciLCJtZW1vIiwiQWRkaXRpb25hbERhdGEiLCJvcmlnaW5hbEN1cnJlbmN5IiwiU0hFS0VMX0NVUlJFTkNZIiwiY2hhcmdlZEFtb3VudCIsIkFtb3VudCIsIm9yaWdpbmFsQW1vdW50IiwiY29uc29sZSIsImxvZyIsIkpTT04iLCJzdHJpbmdpZnkiLCJoYW5nUHJvY2VzcyIsInRpbWVvdXQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInNldFRpbWVvdXQiLCJjbGlja0J5WFBhdGgiLCJ4cGF0aCIsIndhaXRGb3JTZWxlY3RvciIsInZpc2libGUiLCJlbG0iLCIkJCIsImNsaWNrIiwicmVtb3ZlU3BlY2lhbENoYXJhY3RlcnMiLCJzdHIiLCJyZXBsYWNlIiwiZmV0Y2hUcmFuc2FjdGlvbnNGb3JBY2NvdW50Iiwic3RhcnREYXRlIiwiYWNjb3VudElkIiwid2FpdFVudGlsRWxlbWVudEZvdW5kIiwiY2xpY2tCdXR0b24iLCJmaWxsSW5wdXQiLCJmb3JtYXQiLCJmb2N1cyIsImZpbmFsUmVzcG9uc2UiLCJ3YWl0Rm9yUmVzcG9uc2UiLCJyZXNwb25zZSIsInVybCIsInJlcXVlc3QiLCJtZXRob2QiLCJyZXNwb25zZUpzb24iLCJqc29uIiwiYWNjb3VudE51bWJlciIsInBhcnNlIiwianNvblJlc3AiLCJwZW5kaW5nVHJhbnNhY3Rpb25zIiwiVG9kYXlUcmFuc2FjdGlvbnNJdGVtcyIsIkhpc3RvcnlUcmFuc2FjdGlvbnNJdGVtcyIsImJhbGFuY2UiLCJCYWxhbmNlRGlzcGxheSIsInBhcnNlRmxvYXQiLCJ1bmRlZmluZWQiLCJwZW5kaW5nVHhucyIsIlRyYW5zYWN0aW9uU3RhdHVzZXMiLCJQZW5kaW5nIiwiY29tcGxldGVkVHhucyIsIkNvbXBsZXRlZCIsInR4bnMiLCJmZXRjaFRyYW5zYWN0aW9ucyIsImFjY291bnRzIiwiYWNjb3VudHNJZHMiLCJldmFsdWF0ZSIsIkFycmF5IiwiZnJvbSIsImRvY3VtZW50IiwicXVlcnlTZWxlY3RvckFsbCIsInRleHRDb250ZW50Iiwic2VsZWN0b3JzIiwicmVzdWx0cyIsInNlbCIsImluY2x1ZGVzIiwiZWxlbWVudHMiLCJzcGxpdCIsImNvbnRhaW5zVGV4dCIsIm1hdGNoIiwiZmlsdGVyIiwiZWwiLCJ0cmltIiwidGV4dCIsImFjY291bnRMaWtlIiwidGVzdCIsInNlbGVjdG9yRXJyb3IiLCJtZXNzYWdlIiwiYWxsRWxlbWVudHMiLCJhY2NvdW50UGF0dGVybnMiLCJwdXNoIiwiU2V0Iiwic2xpY2UiLCJlcnJvciIsIm5hdmlnYXRlVG9Mb2dpbiIsImxvZ2luQnV0dG9uU2VsZWN0b3IiLCJsb2dpblVybCIsInBhZ2VFdmFsIiwiaHJlZiIsImdvdG8iLCJ3YWl0Rm9yTmF2aWdhdGlvbiIsIndhaXRVbnRpbCIsImFsbCIsIndhaXRGb3JQb3N0TG9naW4iLCJyYWNlIiwid2FpdEZvckZ1bmN0aW9uIiwid2luZG93IiwibG9jYXRpb24iLCJMZXVtaVNjcmFwZXIiLCJCYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiZ2V0TG9naW5PcHRpb25zIiwiZmllbGRzIiwic3VibWl0QnV0dG9uU2VsZWN0b3IiLCJjaGVja1JlYWRpbmVzcyIsInBvc3RBY3Rpb24iLCJwb3NzaWJsZVJlc3VsdHMiLCJmZXRjaERhdGEiLCJtaW5pbXVtU3RhcnRNb21lbnQiLCJzdWJ0cmFjdCIsImFkZCIsImRlZmF1bHRTdGFydE1vbWVudCIsInRvRGF0ZSIsInN0YXJ0TW9tZW50IiwibWF4IiwibmF2aWdhdGVUbyIsInN1Y2Nlc3MiLCJfZGVmYXVsdCIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi9zcmMvc2NyYXBlcnMvbGV1bWkudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IG1vbWVudCwgeyB0eXBlIE1vbWVudCB9IGZyb20gJ21vbWVudCc7XHJcbmltcG9ydCB7IHR5cGUgUGFnZSB9IGZyb20gJ3B1cHBldGVlcic7XHJcbmltcG9ydCB7IFNIRUtFTF9DVVJSRU5DWSB9IGZyb20gJy4uL2NvbnN0YW50cyc7XHJcbmltcG9ydCB7IGdldERlYnVnIH0gZnJvbSAnLi4vaGVscGVycy9kZWJ1Zyc7XHJcbmltcG9ydCB7IGNsaWNrQnV0dG9uLCBmaWxsSW5wdXQsIHBhZ2VFdmFsLCBwYWdlRXZhbEFsbCwgd2FpdFVudGlsRWxlbWVudEZvdW5kIH0gZnJvbSAnLi4vaGVscGVycy9lbGVtZW50cy1pbnRlcmFjdGlvbnMnO1xyXG5pbXBvcnQgeyB3YWl0Rm9yTmF2aWdhdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvbmF2aWdhdGlvbic7XHJcbmltcG9ydCB7IFRyYW5zYWN0aW9uU3RhdHVzZXMsIFRyYW5zYWN0aW9uVHlwZXMsIHR5cGUgVHJhbnNhY3Rpb24sIHR5cGUgVHJhbnNhY3Rpb25zQWNjb3VudCB9IGZyb20gJy4uL3RyYW5zYWN0aW9ucyc7XHJcbmltcG9ydCB7IEJhc2VTY3JhcGVyV2l0aEJyb3dzZXIsIExvZ2luUmVzdWx0cywgdHlwZSBMb2dpbk9wdGlvbnMgfSBmcm9tICcuL2Jhc2Utc2NyYXBlci13aXRoLWJyb3dzZXInO1xyXG5pbXBvcnQgeyB0eXBlIFNjcmFwZXJTY3JhcGluZ1Jlc3VsdCB9IGZyb20gJy4vaW50ZXJmYWNlJztcclxuXHJcbmNvbnN0IGRlYnVnID0gZ2V0RGVidWcoJ2xldW1pJyk7XHJcbmNvbnN0IEJBU0VfVVJMID0gJ2h0dHBzOi8vaGIyLmJhbmtsZXVtaS5jby5pbCc7XHJcbmNvbnN0IExPR0lOX1VSTCA9ICdodHRwczovL3d3dy5sZXVtaS5jby5pbC8nO1xyXG5jb25zdCBUUkFOU0FDVElPTlNfVVJMID0gYCR7QkFTRV9VUkx9L2VCYW5raW5nL1NPL1NQQS5hc3B4Iy90cy9CdXNpbmVzc0FjY291bnRUcng/V2lkZ2V0UGFyPTFgO1xyXG5jb25zdCBGSUxURVJFRF9UUkFOU0FDVElPTlNfVVJMID0gYCR7QkFTRV9VUkx9L0NoYW5uZWxXQ0YvQnJva2VyLnN2Yy9Qcm9jZXNzUmVxdWVzdD9tb2R1bGVOYW1lPVVDX1NPXzI3X0dldEJ1c2luZXNzQWNjb3VudFRyeGA7XHJcblxyXG5jb25zdCBEQVRFX0ZPUk1BVCA9ICdERC5NTS5ZWSc7XHJcbmNvbnN0IEFDQ09VTlRfQkxPQ0tFRF9NU0cgPSAn15TXnteg15XXmSDXl9eh15XXnSc7XHJcbmNvbnN0IElOVkFMSURfUEFTU1dPUkRfTVNHID0gJ9eQ15fXkyDXkNeVINeZ15XXqteoINee16TXqNeY15kg15TXlNeW15PXlNeV16og16nXnteh16jXqiDXqdeS15XXmdeZ150uINeg15nXqtefINec16DXodeV16og16nXldeRJztcclxuXHJcbmZ1bmN0aW9uIGdldFBvc3NpYmxlTG9naW5SZXN1bHRzKCkge1xyXG4gIGNvbnN0IHVybHM6IExvZ2luT3B0aW9uc1sncG9zc2libGVSZXN1bHRzJ10gPSB7XHJcbiAgICBbTG9naW5SZXN1bHRzLlN1Y2Nlc3NdOiBbXHJcbiAgICAgIC9lYmFua2luZ1xcL1NPXFwvU1BBLmFzcHgvaSxcclxuICAgICAgL3N0YXRpY2NvbnRlbnRcXC9kaWdpdGFsZnJvbnRcXC9oZS9pLFxyXG4gICAgICAvc3RhdGljY29udGVudFxcL2dhdGUta2VlcGVyXFwvaGUvaSxcclxuICAgIF0sXHJcbiAgICBbTG9naW5SZXN1bHRzLkludmFsaWRQYXNzd29yZF06IFtcclxuICAgICAgYXN5bmMgb3B0aW9ucyA9PiB7XHJcbiAgICAgICAgaWYgKCFvcHRpb25zIHx8ICFvcHRpb25zLnBhZ2UpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignbWlzc2luZyBwYWdlIG9wdGlvbnMgYXJndW1lbnQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYXdhaXQgcGFnZUV2YWxBbGwob3B0aW9ucy5wYWdlLCAnc3ZnI0NhcGFfMScsICcnLCBlbGVtZW50ID0+IHtcclxuICAgICAgICAgIHJldHVybiAoZWxlbWVudFswXT8ucGFyZW50RWxlbWVudD8uY2hpbGRyZW5bMV0gYXMgSFRNTERpdkVsZW1lbnQpPy5pbm5lclRleHQ7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIHJldHVybiBlcnJvck1lc3NhZ2U/LnN0YXJ0c1dpdGgoSU5WQUxJRF9QQVNTV09SRF9NU0cpO1xyXG4gICAgICB9LFxyXG4gICAgXSxcclxuICAgIFtMb2dpblJlc3VsdHMuQWNjb3VudEJsb2NrZWRdOiBbXHJcbiAgICAgIC8vIE5PVElDRSAtIG1pZ2h0IG5vdCBiZSByZWxldmFudCBzdGFydGluZyB0aGUgTGV1bWkgcmUtZGVzaWduIGR1cmluZyAyMDIyIFNlcFxyXG4gICAgICBhc3luYyBvcHRpb25zID0+IHtcclxuICAgICAgICBpZiAoIW9wdGlvbnMgfHwgIW9wdGlvbnMucGFnZSkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdtaXNzaW5nIHBhZ2Ugb3B0aW9ucyBhcmd1bWVudCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBhd2FpdCBwYWdlRXZhbEFsbChvcHRpb25zLnBhZ2UsICcuZXJySGVhZGVyJywgJycsIGxhYmVsID0+IHtcclxuICAgICAgICAgIHJldHVybiAobGFiZWxbMF0gYXMgSFRNTEVsZW1lbnQpPy5pbm5lclRleHQ7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIHJldHVybiBlcnJvck1lc3NhZ2U/LnN0YXJ0c1dpdGgoQUNDT1VOVF9CTE9DS0VEX01TRyk7XHJcbiAgICAgIH0sXHJcbiAgICBdLFxyXG4gICAgW0xvZ2luUmVzdWx0cy5DaGFuZ2VQYXNzd29yZF06IFsnaHR0cHM6Ly9oYjIuYmFua2xldW1pLmNvLmlsL2F1dGhlbnRpY2F0ZSddLCAvLyBOT1RJQ0UgLSBtaWdodCBub3QgYmUgcmVsZXZhbnQgc3RhcnRpbmcgdGhlIExldW1pIHJlLWRlc2lnbiBkdXJpbmcgMjAyMiBTZXBcclxuICB9O1xyXG4gIHJldHVybiB1cmxzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVMb2dpbkZpZWxkcyhjcmVkZW50aWFsczogU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMpIHtcclxuICByZXR1cm4gW1xyXG4gICAgeyBzZWxlY3RvcjogJ2lucHV0W3BsYWNlaG9sZGVyPVwi16nXnSDXntep16rXntepXCJdJywgdmFsdWU6IGNyZWRlbnRpYWxzLnVzZXJuYW1lIH0sXHJcbiAgICB7IHNlbGVjdG9yOiAnaW5wdXRbcGxhY2Vob2xkZXI9XCLXodeZ16HXnteUXCJdJywgdmFsdWU6IGNyZWRlbnRpYWxzLnBhc3N3b3JkIH0sXHJcbiAgXTtcclxufVxyXG5cclxuZnVuY3Rpb24gZXh0cmFjdFRyYW5zYWN0aW9uc0Zyb21QYWdlKHRyYW5zYWN0aW9uczogYW55W10sIHN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcyk6IFRyYW5zYWN0aW9uW10ge1xyXG4gIGlmICh0cmFuc2FjdGlvbnMgPT09IG51bGwgfHwgdHJhbnNhY3Rpb25zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgcmV0dXJuIFtdO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgcmVzdWx0OiBUcmFuc2FjdGlvbltdID0gdHJhbnNhY3Rpb25zLm1hcChyYXdUcmFuc2FjdGlvbiA9PiB7XHJcbiAgICBjb25zdCBkYXRlID0gbW9tZW50KHJhd1RyYW5zYWN0aW9uLkRhdGVVVEMpLm1pbGxpc2Vjb25kcygwKS50b0lTT1N0cmluZygpO1xyXG4gICAgY29uc3QgbmV3VHJhbnNhY3Rpb246IFRyYW5zYWN0aW9uID0ge1xyXG4gICAgICBzdGF0dXMsXHJcbiAgICAgIHR5cGU6IFRyYW5zYWN0aW9uVHlwZXMuTm9ybWFsLFxyXG4gICAgICBkYXRlLFxyXG4gICAgICBwcm9jZXNzZWREYXRlOiBkYXRlLFxyXG4gICAgICBkZXNjcmlwdGlvbjogcmF3VHJhbnNhY3Rpb24uRGVzY3JpcHRpb24gfHwgJycsXHJcbiAgICAgIGlkZW50aWZpZXI6IHJhd1RyYW5zYWN0aW9uLlJlZmVyZW5jZU51bWJlckxvbmcsXHJcbiAgICAgIG1lbW86IHJhd1RyYW5zYWN0aW9uLkFkZGl0aW9uYWxEYXRhIHx8ICcnLFxyXG4gICAgICBvcmlnaW5hbEN1cnJlbmN5OiBTSEVLRUxfQ1VSUkVOQ1ksXHJcbiAgICAgIGNoYXJnZWRBbW91bnQ6IHJhd1RyYW5zYWN0aW9uLkFtb3VudCxcclxuICAgICAgb3JpZ2luYWxBbW91bnQ6IHJhd1RyYW5zYWN0aW9uLkFtb3VudCxcclxuICAgIH07XHJcblxyXG4gICAgY29uc29sZS5sb2coYFRyYW5zYWN0aW9uOiAke0pTT04uc3RyaW5naWZ5KG5ld1RyYW5zYWN0aW9uKX1gKTtcclxuICAgIHJldHVybiBuZXdUcmFuc2FjdGlvbjtcclxuICB9KTtcclxuXHJcbiAgcmV0dXJuIHJlc3VsdDtcclxufVxyXG5cclxuZnVuY3Rpb24gaGFuZ1Byb2Nlc3ModGltZW91dDogbnVtYmVyKSB7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlPHZvaWQ+KHJlc29sdmUgPT4ge1xyXG4gICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgIHJlc29sdmUoKTtcclxuICAgIH0sIHRpbWVvdXQpO1xyXG4gIH0pO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBjbGlja0J5WFBhdGgocGFnZTogUGFnZSwgeHBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gIGF3YWl0IHBhZ2Uud2FpdEZvclNlbGVjdG9yKHhwYXRoLCB7IHRpbWVvdXQ6IDMwMDAwLCB2aXNpYmxlOiB0cnVlIH0pO1xyXG4gIGNvbnN0IGVsbSA9IGF3YWl0IHBhZ2UuJCQoeHBhdGgpO1xyXG4gIGF3YWl0IGVsbVswXS5jbGljaygpO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZW1vdmVTcGVjaWFsQ2hhcmFjdGVycyhzdHI6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC9bXjAtOS8tXS9nLCAnJyk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGZldGNoVHJhbnNhY3Rpb25zRm9yQWNjb3VudChcclxuICBwYWdlOiBQYWdlLFxyXG4gIHN0YXJ0RGF0ZTogTW9tZW50LFxyXG4gIGFjY291bnRJZDogc3RyaW5nLFxyXG4pOiBQcm9taXNlPFRyYW5zYWN0aW9uc0FjY291bnQ+IHtcclxuICAvLyBERVZFTE9QRVIgTk9USUNFIHRoZSBhY2NvdW50IG51bWJlciByZWNlaXZlZCBmcm9tIHRoZSBzZXJ2ZXIgaXMgYmVpbmcgYWx0ZXJlZCBhdFxyXG4gIC8vIHJ1bnRpbWUgZm9yIHNvbWUgYWNjb3VudHMgYWZ0ZXIgMS0yIHNlY29uZHMgc28gd2UgbmVlZCB0byBoYW5nIHRoZSBwcm9jZXNzIGZvciBhIHNob3J0IHdoaWxlLlxyXG4gIGF3YWl0IGhhbmdQcm9jZXNzKDQwMDApO1xyXG5cclxuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJ2J1dHRvblt0aXRsZT1cIteX15nXpNeV16kg157Xqten15PXnVwiXScsIHRydWUpO1xyXG4gIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsICdidXR0b25bdGl0bGU9XCLXl9eZ16TXldepINee16rXp9eT151cIl0nKTtcclxuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJ2JsbC1yYWRpby1idXR0b24nLCB0cnVlKTtcclxuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCAnYmxsLXJhZGlvLWJ1dHRvbjpub3QoW2NoZWNrZWRdKScpO1xyXG5cclxuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJ2lucHV0W2Zvcm1jb250cm9sbmFtZT1cInR4dElucHV0RnJvbVwiXScsIHRydWUpO1xyXG5cclxuICBhd2FpdCBmaWxsSW5wdXQocGFnZSwgJ2lucHV0W2Zvcm1jb250cm9sbmFtZT1cInR4dElucHV0RnJvbVwiXScsIHN0YXJ0RGF0ZS5mb3JtYXQoREFURV9GT1JNQVQpKTtcclxuXHJcbiAgLy8gd2UgbXVzdCBibHVyIHRoZSBmcm9tIGNvbnRyb2wgb3RoZXJ3aXNlIHRoZSBzZWFyY2ggd2lsbCB1c2UgdGhlIHByZXZpb3VzIHZhbHVlXHJcbiAgYXdhaXQgcGFnZS5mb2N1cyhcImJ1dHRvblthcmlhLWxhYmVsPSfXodeg158nXVwiKTtcclxuXHJcbiAgYXdhaXQgY2xpY2tCdXR0b24ocGFnZSwgXCJidXR0b25bYXJpYS1sYWJlbD0n16HXoNefJ11cIik7XHJcbiAgY29uc3QgZmluYWxSZXNwb25zZSA9IGF3YWl0IHBhZ2Uud2FpdEZvclJlc3BvbnNlKHJlc3BvbnNlID0+IHtcclxuICAgIHJldHVybiByZXNwb25zZS51cmwoKSA9PT0gRklMVEVSRURfVFJBTlNBQ1RJT05TX1VSTCAmJiByZXNwb25zZS5yZXF1ZXN0KCkubWV0aG9kKCkgPT09ICdQT1NUJztcclxuICB9KTtcclxuXHJcbiAgY29uc3QgcmVzcG9uc2VKc29uOiBhbnkgPSBhd2FpdCBmaW5hbFJlc3BvbnNlLmpzb24oKTtcclxuXHJcbiAgY29uc3QgYWNjb3VudE51bWJlciA9IGFjY291bnRJZC5yZXBsYWNlKCcvJywgJ18nKS5yZXBsYWNlKC9bXlxcZC1fXS9nLCAnJyk7XHJcblxyXG4gIGNvbnN0IHJlc3BvbnNlID0gSlNPTi5wYXJzZShyZXNwb25zZUpzb24uanNvblJlc3ApO1xyXG5cclxuICBjb25zdCBwZW5kaW5nVHJhbnNhY3Rpb25zID0gcmVzcG9uc2UuVG9kYXlUcmFuc2FjdGlvbnNJdGVtcztcclxuICBjb25zdCB0cmFuc2FjdGlvbnMgPSByZXNwb25zZS5IaXN0b3J5VHJhbnNhY3Rpb25zSXRlbXM7XHJcbiAgY29uc3QgYmFsYW5jZSA9IHJlc3BvbnNlLkJhbGFuY2VEaXNwbGF5ID8gcGFyc2VGbG9hdChyZXNwb25zZS5CYWxhbmNlRGlzcGxheSkgOiB1bmRlZmluZWQ7XHJcblxyXG4gIGNvbnN0IHBlbmRpbmdUeG5zID0gZXh0cmFjdFRyYW5zYWN0aW9uc0Zyb21QYWdlKHBlbmRpbmdUcmFuc2FjdGlvbnMsIFRyYW5zYWN0aW9uU3RhdHVzZXMuUGVuZGluZyk7XHJcbiAgY29uc3QgY29tcGxldGVkVHhucyA9IGV4dHJhY3RUcmFuc2FjdGlvbnNGcm9tUGFnZSh0cmFuc2FjdGlvbnMsIFRyYW5zYWN0aW9uU3RhdHVzZXMuQ29tcGxldGVkKTtcclxuICBjb25zdCB0eG5zID0gWy4uLnBlbmRpbmdUeG5zLCAuLi5jb21wbGV0ZWRUeG5zXTtcclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIGFjY291bnROdW1iZXIsXHJcbiAgICBiYWxhbmNlLFxyXG4gICAgdHhucyxcclxuICB9O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBmZXRjaFRyYW5zYWN0aW9ucyhwYWdlOiBQYWdlLCBzdGFydERhdGU6IE1vbWVudCk6IFByb21pc2U8VHJhbnNhY3Rpb25zQWNjb3VudFtdPiB7XHJcbiAgY29uc29sZS5sb2coJz09PSBGRVRDSFRSQU5TQUNUSU9OUyBERUJVRyA9PT0nKTtcclxuICBjb25zdCBhY2NvdW50czogVHJhbnNhY3Rpb25zQWNjb3VudFtdID0gW107XHJcblxyXG4gIC8vIERFVkVMT1BFUiBOT1RJQ0UgdGhlIGFjY291bnQgbnVtYmVyIHJlY2VpdmVkIGZyb20gdGhlIHNlcnZlciBpcyBiZWluZyBhbHRlcmVkIGF0XHJcbiAgLy8gcnVudGltZSBmb3Igc29tZSBhY2NvdW50cyBhZnRlciAxLTIgc2Vjb25kcyBzbyB3ZSBuZWVkIHRvIGhhbmcgdGhlIHByb2Nlc3MgZm9yIGEgc2hvcnQgd2hpbGUuXHJcbiAgY29uc29sZS5sb2coJ1dhaXRpbmcgNCBzZWNvbmRzIGZvciBhY2NvdW50IGVsZW1lbnRzIHRvIHN0YWJpbGl6ZS4uLicpO1xyXG4gIGF3YWl0IGhhbmdQcm9jZXNzKDQwMDApO1xyXG5cclxuICBjb25zb2xlLmxvZygnQ3VycmVudCBVUkwgaW4gZmV0Y2hUcmFuc2FjdGlvbnM6JywgcGFnZS51cmwoKSk7XHJcbiAgY29uc29sZS5sb2coJ0xvb2tpbmcgZm9yIGFjY291bnQgc2VsZWN0b3I6IGFwcC1tYXNrZWQtbnVtYmVyLWNvbWJvIHNwYW4uZGlzcGxheS1udW1iZXItbGknKTtcclxuXHJcbiAgbGV0IGFjY291bnRzSWRzOiBzdHJpbmdbXSA9IFtdO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zb2xlLmxvZygnVHJ5aW5nIG9yaWdpbmFsIHNlbGVjdG9yOiBhcHAtbWFza2VkLW51bWJlci1jb21ibyBzcGFuLmRpc3BsYXktbnVtYmVyLWxpJyk7XHJcbiAgICBhY2NvdW50c0lkcyA9IChhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+XHJcbiAgICAgIEFycmF5LmZyb20oZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnYXBwLW1hc2tlZC1udW1iZXItY29tYm8gc3Bhbi5kaXNwbGF5LW51bWJlci1saScpLCBlID0+IGUudGV4dENvbnRlbnQpLFxyXG4gICAgKSkgYXMgc3RyaW5nW107XHJcbiAgICBjb25zb2xlLmxvZygnT3JpZ2luYWwgc2VsZWN0b3IgZm91bmQgYWNjb3VudCBJRHM6JywgYWNjb3VudHNJZHMpO1xyXG5cclxuICAgIGlmIChhY2NvdW50c0lkcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgY29uc29sZS5sb2coJ09yaWdpbmFsIHNlbGVjdG9yIGZhaWxlZCwgdHJ5aW5nIGFsdGVybmF0aXZlIHNlbGVjdG9ycyBmb3IgbmV3IHdlYnNpdGUuLi4nKTtcclxuXHJcbiAgICAgIC8vIFRyeSB2YXJpb3VzIHNlbGVjdG9ycyB0aGF0IG1pZ2h0IGNvbnRhaW4gYWNjb3VudCBudW1iZXJzIGluIHRoZSBuZXcgd2Vic2l0ZVxyXG4gICAgICBjb25zdCBzZWxlY3RvcnMgPSBbXHJcbiAgICAgICAgJ1tkYXRhLXRpZD1cImFjY291bnQtc2VsZWN0b3ItbnVtYmVyXCJdIHNwYW5bYXJpYS1oaWRkZW49XCJ0cnVlXCJdJywgLy8gTmV3IExldW1pIHdlYnNpdGUgc3BlY2lmaWMgc2VsZWN0b3JcclxuICAgICAgICAnW2RhdGEtdGlkKj1cImFjY291bnRcIl0gc3BhblthcmlhLWhpZGRlbj1cInRydWVcIl0nLFxyXG4gICAgICAgICdbZGF0YS10aWQqPVwiYWNjb3VudC1zZWxlY3RvclwiXSBzcGFuJyxcclxuICAgICAgICAnZGl2W2RhdGEtdGlkKj1cImFjY291bnRcIl0gc3BhbicsXHJcbiAgICAgICAgJ3NwYW5bY2xhc3MqPVwiYWNjb3VudFwiXScsXHJcbiAgICAgICAgJ3NwYW5bY2xhc3MqPVwibnVtYmVyXCJdJyxcclxuICAgICAgICAnZGl2W2NsYXNzKj1cImFjY291bnRcIl0nLFxyXG4gICAgICAgICdkaXZbY2xhc3MqPVwibnVtYmVyXCJdJyxcclxuICAgICAgICAnW2RhdGEtdGVzdGlkKj1cImFjY291bnRcIl0nLFxyXG4gICAgICAgICdbZGF0YS10ZXN0aWQqPVwibnVtYmVyXCJdJyxcclxuICAgICAgICAnc3Bhbjpjb250YWlucyhcIi9cIiknLCAvLyBBY2NvdW50IG51bWJlcnMgb2Z0ZW4gY29udGFpbiBzbGFzaGVzXHJcbiAgICAgICAgJ2Rpdjpjb250YWlucyhcIi9cIiknLFxyXG4gICAgICBdO1xyXG5cclxuICAgICAgZm9yIChjb25zdCBzZWxlY3RvciBvZiBzZWxlY3RvcnMpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgVHJ5aW5nIHNlbGVjdG9yOiAke3NlbGVjdG9yfWApO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgcGFnZS5ldmFsdWF0ZShzZWwgPT4ge1xyXG4gICAgICAgICAgICBpZiAoc2VsLmluY2x1ZGVzKCc6Y29udGFpbnMnKSkge1xyXG4gICAgICAgICAgICAgIC8vIEhhbmRsZSA6Y29udGFpbnMgcHNldWRvLXNlbGVjdG9yIG1hbnVhbGx5XHJcbiAgICAgICAgICAgICAgY29uc3QgZWxlbWVudHMgPSBBcnJheS5mcm9tKGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoc2VsLnNwbGl0KCc6Y29udGFpbnMnKVswXSkpO1xyXG4gICAgICAgICAgICAgIGNvbnN0IGNvbnRhaW5zVGV4dCA9IHNlbC5tYXRjaCgvY29udGFpbnNcXChcIihbXlwiXSspXCJcXCkvKT8uWzFdO1xyXG4gICAgICAgICAgICAgIHJldHVybiBlbGVtZW50c1xyXG4gICAgICAgICAgICAgICAgLmZpbHRlcihlbCA9PiBlbC50ZXh0Q29udGVudCAmJiBjb250YWluc1RleHQgJiYgZWwudGV4dENvbnRlbnQuaW5jbHVkZXMoY29udGFpbnNUZXh0KSlcclxuICAgICAgICAgICAgICAgIC5tYXAoZWwgPT4gZWwudGV4dENvbnRlbnQhLnRyaW0oKSlcclxuICAgICAgICAgICAgICAgIC5maWx0ZXIodGV4dCA9PiB0ZXh0ICYmIHRleHQubGVuZ3RoID4gMCk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgcmV0dXJuIEFycmF5LmZyb20oZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbChzZWwpLCBlID0+IGUudGV4dENvbnRlbnQ/LnRyaW0oKSkuZmlsdGVyKFxyXG4gICAgICAgICAgICAgICAgdGV4dCA9PiB0ZXh0ICYmIHRleHQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgICApIGFzIHN0cmluZ1tdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9LCBzZWxlY3Rvcik7XHJcblxyXG4gICAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgU2VsZWN0b3IgJHtzZWxlY3Rvcn0gZm91bmQgcmVzdWx0czpgLCByZXN1bHRzKTtcclxuICAgICAgICAgICAgLy8gRmlsdGVyIGZvciBhY2NvdW50LWxpa2UgcGF0dGVybnMgKGNvbnRhaW5pbmcgZGlnaXRzIGFuZCBwb3NzaWJseSBzbGFzaGVzL2Rhc2hlcylcclxuICAgICAgICAgICAgY29uc3QgYWNjb3VudExpa2UgPSByZXN1bHRzLmZpbHRlcihcclxuICAgICAgICAgICAgICAodGV4dCk6IHRleHQgaXMgc3RyaW5nID0+IHRleHQgIT0gbnVsbCAmJiAvXFxkLy50ZXN0KHRleHQpICYmIHRleHQubGVuZ3RoID49IDQsXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIGlmIChhY2NvdW50TGlrZS5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgYWNjb3VudHNJZHMgPSBhY2NvdW50TGlrZTtcclxuICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgVXNpbmcgYWNjb3VudCBJRHMgZnJvbSAke3NlbGVjdG9yfTpgLCBhY2NvdW50c0lkcyk7XHJcbiAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuICAgICAgICB9IGNhdGNoIChzZWxlY3RvckVycm9yOiBhbnkpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBTZWxlY3RvciAke3NlbGVjdG9yfSBmYWlsZWQ6YCwgc2VsZWN0b3JFcnJvci5tZXNzYWdlKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIElmIHN0aWxsIG5vIGFjY291bnRzIGZvdW5kLCB0cnkgYSBtb3JlIGdlbmVyYWwgYXBwcm9hY2hcclxuICAgICAgaWYgKGFjY291bnRzSWRzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdBbGwgc3BlY2lmaWMgc2VsZWN0b3JzIGZhaWxlZCwgdHJ5aW5nIGdlbmVyYWwgdGV4dCBjb250ZW50IHNlYXJjaC4uLicpO1xyXG4gICAgICAgIGFjY291bnRzSWRzID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB7XHJcbiAgICAgICAgICBjb25zdCBhbGxFbGVtZW50cyA9IEFycmF5LmZyb20oZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnKicpKTtcclxuICAgICAgICAgIGNvbnN0IGFjY291bnRQYXR0ZXJuczogc3RyaW5nW10gPSBbXTtcclxuXHJcbiAgICAgICAgICBmb3IgKGNvbnN0IGVsIG9mIGFsbEVsZW1lbnRzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHRleHQgPSBlbC50ZXh0Q29udGVudD8udHJpbSgpO1xyXG4gICAgICAgICAgICBpZiAodGV4dCAmJiB0ZXh0Lmxlbmd0aCA+IDQgJiYgdGV4dC5sZW5ndGggPCAyMCkge1xyXG4gICAgICAgICAgICAgIC8vIExvb2sgZm9yIHBhdHRlcm5zIGxpa2U6IDEyMy80NTY3ODksIDEyLTM0NTYtNzg5LCBldGMuXHJcbiAgICAgICAgICAgICAgaWYgKC9eXFxkK1stXFwvXVxcZCsvLnRlc3QodGV4dCkgfHwgL15cXGR7NCx9JC8udGVzdCh0ZXh0KSkge1xyXG4gICAgICAgICAgICAgICAgYWNjb3VudFBhdHRlcm5zLnB1c2godGV4dCk7XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgLy8gUmVtb3ZlIGR1cGxpY2F0ZXMgYW5kIHJldHVybiB1bmlxdWUgYWNjb3VudC1saWtlIHBhdHRlcm5zXHJcbiAgICAgICAgICByZXR1cm4gWy4uLm5ldyBTZXQoYWNjb3VudFBhdHRlcm5zKV0uc2xpY2UoMCwgNSk7IC8vIExpbWl0IHRvIDUgdG8gYXZvaWQgdG9vIG1hbnkgZmFsc2UgcG9zaXRpdmVzXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKCdHZW5lcmFsIHNlYXJjaCBmb3VuZCBwb3RlbnRpYWwgYWNjb3VudCBwYXR0ZXJuczonLCBhY2NvdW50c0lkcyk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoYWNjb3VudHNJZHMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdObyBhY2NvdW50IHNlbGVjdG9ycyB3b3JrZWQuIFRoZSBuZXcgd2Vic2l0ZSBtaWdodCByZXF1aXJlIGRpZmZlcmVudCBuYXZpZ2F0aW9uLicpO1xyXG4gICAgICAvLyBSZXR1cm4gYSBkZWZhdWx0IGFjY291bnQgdG8gY29udGludWUgd2l0aCB0cmFuc2FjdGlvbiBleHRyYWN0aW9uIGF0dGVtcHRcclxuICAgICAgYWNjb3VudHNJZHMgPSBbJ0RFRkFVTFQtQUNDT1VOVCddO1xyXG4gICAgICBjb25zb2xlLmxvZygnVXNpbmcgZGVmYXVsdCBhY2NvdW50IHRvIGNvbnRpbnVlIHByb2Nlc3NpbmcnKTtcclxuICAgIH1cclxuICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICBjb25zb2xlLmxvZygnRXJyb3IgZXh0cmFjdGluZyBhY2NvdW50IElEczonLCBlcnJvci5tZXNzYWdlKTtcclxuICAgIGNvbnNvbGUubG9nKCdUaGlzIHN1Z2dlc3RzIHRoZSBET00gc3RydWN0dXJlIGhhcyBjaGFuZ2VkIGluIHRoZSBuZXcgTGV1bWkgd2Vic2l0ZS4nKTtcclxuICAgIHRocm93IGVycm9yO1xyXG4gIH1cclxuXHJcbiAgLy8gZHVlIHRvIGEgYnVnLCB0aGUgYWx0ZXJlZCB2YWx1ZSBtaWdodCBpbmNsdWRlIHVuZGVzaXJlZCBzaWducyBsaWtlICYgdGhhdCBzaG91bGQgYmUgcmVtb3ZlZFxyXG5cclxuICBpZiAoIWFjY291bnRzSWRzLmxlbmd0aCkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gZXh0cmFjdCBvciBwYXJzZSB0aGUgYWNjb3VudCBudW1iZXInKTtcclxuICB9XHJcblxyXG4gIGZvciAoY29uc3QgYWNjb3VudElkIG9mIGFjY291bnRzSWRzKSB7XHJcbiAgICBpZiAoYWNjb3VudHNJZHMubGVuZ3RoID4gMSkge1xyXG4gICAgICAvLyBnZXQgbGlzdCBvZiBhY2NvdW50cyBhbmQgY2hlY2sgYWNjb3VudElkXHJcbiAgICAgIGF3YWl0IGNsaWNrQnlYUGF0aChwYWdlLCAneHBhdGgvLy8qW2NvbnRhaW5zKEBjbGFzcywgXCJudW1iZXJcIikgYW5kIGNvbnRhaW5zKEBjbGFzcywgXCJjb21iby1pbm5lclwiKV0nKTtcclxuICAgICAgYXdhaXQgY2xpY2tCeVhQYXRoKHBhZ2UsIGB4cGF0aC8vL3NwYW5bY29udGFpbnModGV4dCgpLCAnJHthY2NvdW50SWR9JyldYCk7XHJcbiAgICB9XHJcblxyXG4gICAgYWNjb3VudHMucHVzaChhd2FpdCBmZXRjaFRyYW5zYWN0aW9uc0ZvckFjY291bnQocGFnZSwgc3RhcnREYXRlLCByZW1vdmVTcGVjaWFsQ2hhcmFjdGVycyhhY2NvdW50SWQpKSk7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gYWNjb3VudHM7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIG5hdmlnYXRlVG9Mb2dpbihwYWdlOiBQYWdlKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc3QgbG9naW5CdXR0b25TZWxlY3RvciA9ICcuZW50ZXItYWNjb3VudCBhW29yaWdpbmFsdGl0bGU9XCLXm9eg15nXodeUINec15fXqdeR15XXoNeaXCJdJztcclxuICBkZWJ1Zygnd2FpdCBmb3IgaG9tZXBhZ2UgdG8gY2xpY2sgb24gbG9naW4gYnV0dG9uJyk7XHJcbiAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIGxvZ2luQnV0dG9uU2VsZWN0b3IpO1xyXG4gIGRlYnVnKCduYXZpZ2F0ZSB0byBsb2dpbiBwYWdlJyk7XHJcbiAgY29uc3QgbG9naW5VcmwgPSBhd2FpdCBwYWdlRXZhbChwYWdlLCBsb2dpbkJ1dHRvblNlbGVjdG9yLCBudWxsLCBlbGVtZW50ID0+IHtcclxuICAgIHJldHVybiAoZWxlbWVudCBhcyBhbnkpLmhyZWY7XHJcbiAgfSk7XHJcbiAgZGVidWcoYG5hdmlnYXRpbmcgdG8gcGFnZSAoJHtsb2dpblVybH0pYCk7XHJcbiAgYXdhaXQgcGFnZS5nb3RvKGxvZ2luVXJsKTtcclxuICBkZWJ1Zygnd2FpdGluZyBmb3IgcGFnZSB0byBiZSBsb2FkZWQgKG5ldHdvcmtpZGxlMiknKTtcclxuICBhd2FpdCB3YWl0Rm9yTmF2aWdhdGlvbihwYWdlLCB7IHdhaXRVbnRpbDogJ25ldHdvcmtpZGxlMicgfSk7XHJcbiAgZGVidWcoJ3dhaXRpbmcgZm9yIGNvbXBvbmVudHMgb2YgbG9naW4gdG8gZW50ZXIgY3JlZGVudGlhbHMnKTtcclxuICBhd2FpdCBQcm9taXNlLmFsbChbXHJcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJ2lucHV0W3BsYWNlaG9sZGVyPVwi16nXnSDXntep16rXntepXCJdJywgdHJ1ZSksXHJcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJ2lucHV0W3BsYWNlaG9sZGVyPVwi16HXmdeh157XlFwiXScsIHRydWUpLFxyXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICdidXR0b25bdHlwZT1cInN1Ym1pdFwiXScsIHRydWUpLFxyXG4gIF0pO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiB3YWl0Rm9yUG9zdExvZ2luKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBkZWJ1ZygnV2FpdGluZyBmb3IgcG9zdC1sb2dpbiBuYXZpZ2F0aW9uLi4uJyk7XHJcbiAgY29uc29sZS5sb2coJ1tMRVVNSSBERUJVR10gV2FpdGluZyBmb3IgcG9zdC1sb2dpbiBuYXZpZ2F0aW9uLi4uJyk7XHJcblxyXG4gIC8vIFVzZSBVUkwtYmFzZWQgZGV0ZWN0aW9uIGluc3RlYWQgb2YgcHJvYmxlbWF0aWMgWFBhdGhcclxuICBhd2FpdCBQcm9taXNlLnJhY2UoW1xyXG4gICAgLy8gV2FpdCBmb3Igc3VjY2Vzc2Z1bCBuYXZpZ2F0aW9uIHRvIExldW1pJ3MgYXV0aGVudGljYXRlZCBwYWdlc1xyXG4gICAgcGFnZS53YWl0Rm9yRnVuY3Rpb24oXHJcbiAgICAgICgpID0+IHtcclxuICAgICAgICBjb25zdCB1cmwgPSB3aW5kb3cubG9jYXRpb24uaHJlZjtcclxuICAgICAgICByZXR1cm4gKFxyXG4gICAgICAgICAgdXJsLmluY2x1ZGVzKCcvZWJhbmtpbmcvU08vU1BBLmFzcHgnKSB8fFxyXG4gICAgICAgICAgdXJsLmluY2x1ZGVzKCcvc3RhdGljY29udGVudC9kaWdpdGFsZnJvbnQvaGUnKSB8fFxyXG4gICAgICAgICAgdXJsLmluY2x1ZGVzKCcvc3RhdGljY29udGVudC9nYXRlLWtlZXBlci9oZScpXHJcbiAgICAgICAgKTtcclxuICAgICAgfSxcclxuICAgICAgeyB0aW1lb3V0OiA2MDAwMCB9LFxyXG4gICAgKSxcclxuICAgIC8vIFN0aWxsIGNoZWNrIGZvciBlcnJvciBlbGVtZW50cywgYnV0IHVzZSBtb3JlIHJlbGlhYmxlIHNlbGVjdG9yc1xyXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICdhW3RpdGxlPVwi15PXnNeSINec15fXqdeR15XXn1wiXScsIHRydWUsIDYwMDAwKSxcclxuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnZGl2Lm1haW4tY29udGVudCcsIGZhbHNlLCA2MDAwMCksXHJcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJ2Zvcm1bYWN0aW9uPVwiL2NoYW5nZXBhc3N3b3JkXCJdJywgdHJ1ZSwgNjAwMDApLFxyXG4gIF0pO1xyXG5cclxuICBjb25zb2xlLmxvZygnW0xFVU1JIERFQlVHXSBQb3N0LWxvZ2luIG5hdmlnYXRpb24gY29tcGxldGVkLCBjdXJyZW50IFVSTDonLCBwYWdlLnVybCgpKTtcclxufVxyXG5cclxudHlwZSBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscyA9IHsgdXNlcm5hbWU6IHN0cmluZzsgcGFzc3dvcmQ6IHN0cmluZyB9O1xyXG5cclxuY2xhc3MgTGV1bWlTY3JhcGVyIGV4dGVuZHMgQmFzZVNjcmFwZXJXaXRoQnJvd3NlcjxTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscz4ge1xyXG4gIGdldExvZ2luT3B0aW9ucyhjcmVkZW50aWFsczogU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGxvZ2luVXJsOiBMT0dJTl9VUkwsXHJcbiAgICAgIGZpZWxkczogY3JlYXRlTG9naW5GaWVsZHMoY3JlZGVudGlhbHMpLFxyXG4gICAgICBzdWJtaXRCdXR0b25TZWxlY3RvcjogXCJidXR0b25bdHlwZT0nc3VibWl0J11cIixcclxuICAgICAgY2hlY2tSZWFkaW5lc3M6IGFzeW5jICgpID0+IG5hdmlnYXRlVG9Mb2dpbih0aGlzLnBhZ2UpLFxyXG4gICAgICBwb3N0QWN0aW9uOiBhc3luYyAoKSA9PiB3YWl0Rm9yUG9zdExvZ2luKHRoaXMucGFnZSksXHJcbiAgICAgIHBvc3NpYmxlUmVzdWx0czogZ2V0UG9zc2libGVMb2dpblJlc3VsdHMoKSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBhc3luYyBmZXRjaERhdGEoKTogUHJvbWlzZTxTY3JhcGVyU2NyYXBpbmdSZXN1bHQ+IHtcclxuICAgIGNvbnN0IG1pbmltdW1TdGFydE1vbWVudCA9IG1vbWVudCgpLnN1YnRyYWN0KDMsICd5ZWFycycpLmFkZCgxLCAnZGF5Jyk7XHJcbiAgICBjb25zdCBkZWZhdWx0U3RhcnRNb21lbnQgPSBtb21lbnQoKS5zdWJ0cmFjdCgxLCAneWVhcnMnKS5hZGQoMSwgJ2RheScpO1xyXG4gICAgY29uc3Qgc3RhcnREYXRlID0gdGhpcy5vcHRpb25zLnN0YXJ0RGF0ZSB8fCBkZWZhdWx0U3RhcnRNb21lbnQudG9EYXRlKCk7XHJcbiAgICBjb25zdCBzdGFydE1vbWVudCA9IG1vbWVudC5tYXgobWluaW11bVN0YXJ0TW9tZW50LCBtb21lbnQoc3RhcnREYXRlKSk7XHJcblxyXG4gICAgLy8gV2FpdCBmb3IgbG9naW4gc2Vzc2lvbiB0byBiZSBmdWxseSBlc3RhYmxpc2hlZFxyXG4gICAgZGVidWcoJ1dhaXRpbmcgNSBzZWNvbmRzIGZvciBsb2dpbiBzZXNzaW9uIHRvIHN0YWJpbGl6ZS4uLicpO1xyXG4gICAgY29uc29sZS5sb2coJ1tMRVVNSSBERUJVR10gV2FpdGluZyA1IHNlY29uZHMgZm9yIGxvZ2luIHNlc3Npb24gdG8gc3RhYmlsaXplLi4uJyk7XHJcbiAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNTAwMCkpO1xyXG5cclxuICAgIGF3YWl0IHRoaXMubmF2aWdhdGVUbyhUUkFOU0FDVElPTlNfVVJMKTtcclxuXHJcbiAgICBjb25zdCBhY2NvdW50cyA9IGF3YWl0IGZldGNoVHJhbnNhY3Rpb25zKHRoaXMucGFnZSwgc3RhcnRNb21lbnQpO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgIGFjY291bnRzLFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBkZWZhdWx0IExldW1pU2NyYXBlcjtcclxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxJQUFBQSxPQUFBLEdBQUFDLHNCQUFBLENB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