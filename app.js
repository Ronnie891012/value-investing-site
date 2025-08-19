/**
 * Fetch quote data for a given ticker using Alpha Vantage's GLOBAL_QUOTE function.
 * Returns an object containing the API response or throws on failure.
 * @param {string} ticker
 * @param {string} apiKey
 */
async function getQuote(ticker, apiKey) {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(
    ticker
  )}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch quote');
  return res.json();
}

/**
 * Fetch company overview data for a given ticker using Alpha Vantage's OVERVIEW function.
 * Returns an object with company fundamentals such as EPS, PE ratio and PEG ratio.
 * @param {string} ticker
 * @param {string} apiKey
 */
async function getOverview(ticker, apiKey) {
  const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(
    ticker
  )}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch overview');
  return res.json();
}

/**
 * Fetch earnings data for a given ticker to compute growth rates.
 * Uses Alpha Vantage's EARNINGS function.
 * @param {string} ticker
 * @param {string} apiKey
 */
async function getEarnings(ticker, apiKey) {
  const url = `https://www.alphavantage.co/query?function=EARNINGS&symbol=${encodeURIComponent(
    ticker
  )}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch earnings');
  return res.json();
}

/**
 * Compute the compound annual growth rate (CAGR) for EPS using annual earnings.
 * EPS should be positive; if not enough data, returns null.
 * @param {Array<{fiscalDateEnding: string, reportedEPS: string}>} earnings
 */
function computeCAGR(earnings) {
  if (!Array.isArray(earnings) || earnings.length < 3) return null;
  // Sort earnings from oldest to newest based on date
  const sorted = earnings
    .map((e) => ({
      date: new Date(e.fiscalDateEnding),
      eps: parseFloat(e.reportedEPS),
    }))
    .filter((e) => !isNaN(e.eps) && e.eps > 0)
    .sort((a, b) => a.date - b.date);
  if (sorted.length < 2) return null;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const years = (last.date - first.date) / (365.25 * 24 * 3600 * 1000);
  if (years <= 0) return null;
  const cagr = Math.pow(last.eps / first.eps, 1 / years) - 1;
  return cagr;
}

/**
 * Compute the discounted cash flow (DCF) intrinsic value per share using an
 * approximation based on EPS. This function projects EPS as a proxy for free
 * cash flow and discounts it back to the present using a given discount rate.
 * @param {number} eps Current trailing EPS
 * @param {number} growthRate Expected annual growth rate (e.g. 0.1 for 10%)
 * @param {number} discountRate Discount rate used for DCF (default 10%)
 * @param {number} years Number of years to project (default 10)
 * @param {number} terminalGrowthRate Terminal growth rate after projection period (default 3%)
 */
function computeDCF(
  eps,
  growthRate,
  discountRate = 0.1,
  years = 10,
  terminalGrowthRate = 0.03
) {
  let fcf = eps;
  let pvSum = 0;
  for (let i = 1; i <= years; i++) {
    fcf *= 1 + growthRate;
    pvSum += fcf / Math.pow(1 + discountRate, i);
  }
  // Terminal value using Gordon growth model
  const terminalValue = (fcf * (1 + terminalGrowthRate)) / (discountRate - terminalGrowthRate);
  const pvTerminal = terminalValue / Math.pow(1 + discountRate, years);
  return pvSum + pvTerminal;
}

/**
 * Display an alert message and optionally hide results.
 */
function showAlert(msg) {
  const alertBox = document.getElementById('alertBox');
  alertBox.textContent = msg;
  alertBox.classList.remove('d-none');
  // hide results
  document.getElementById('results').classList.add('d-none');
}

/**
 * Hide alert box.
 */
function hideAlert() {
  document.getElementById('alertBox').classList.add('d-none');
}

/**
 * Format number as currency with two decimals.
 */
function formatCurrency(num) {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  return '$' + num.toFixed(2);
}

/**
 * Main function to fetch data and compute valuations.
 */
async function fetchData() {
  const ticker = document.getElementById('tickerInput').value.trim().toUpperCase();
  const apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!ticker) {
    showAlert('Please enter a ticker symbol.');
    return;
  }
  if (!apiKey) {
    showAlert('Please enter your Alpha Vantage API key. You can obtain a free key from https://www.alphavantage.co/support/');
    return;
  }
  hideAlert();
  try {
    // Fetch quote, overview and earnings concurrently
    const [quoteData, overviewData, earningsData] = await Promise.all([
      getQuote(ticker, apiKey),
      getOverview(ticker, apiKey),
      getEarnings(ticker, apiKey),
    ]);
    // Parse quote
    const quote = quoteData['Global Quote'];
    if (!quote || !quote['05. price']) {
      showAlert('Could not retrieve quote data for the ticker. Please check the ticker symbol and your API key.');
      return;
    }
    const price = parseFloat(quote['05. price']);
    // Parse overview
    const eps = parseFloat(overviewData.EPS || overviewData['EPS']);
    const pegRatio = parseFloat(overviewData.PEGRatio || overviewData['PEGRatio']);
    const peRatio = parseFloat(overviewData.PERatio || overviewData['PERatio']);
    // Compute growth rate from earnings
    let growthRate = null;
    if (earningsData && earningsData.annualEarnings) {
      growthRate = computeCAGR(earningsData.annualEarnings);
    }
    // Fallback: compute growth rate using PEG and PE if CAGR not available
    if ((growthRate === null || isNaN(growthRate)) && !isNaN(pegRatio) && !isNaN(peRatio) && peRatio > 0) {
      // growth rate expressed as decimal (PE / PEG) / 100
      growthRate = peRatio / pegRatio / 100;
    }
    if (growthRate === null || isNaN(growthRate) || growthRate <= 0) {
      showAlert('Could not compute a growth rate for the company. The valuations may not be meaningful.');
    }
    // Compute valuations
    const gPercent = growthRate ? growthRate * 100 : null;
    // Peter Lynch fair value
    let lynchValue = null;
    if (!isNaN(pegRatio) && !isNaN(eps) && growthRate !== null) {
      lynchValue = pegRatio * (gPercent ?? 0) * eps;
    }
    // Benjamin Graham original
    let grahamOriginal = null;
    if (!isNaN(eps) && gPercent !== null) {
      grahamOriginal = eps * (8.5 + 2 * gPercent);
    }
    // Benjamin Graham revised (using AAA bond yield). We'll use 4.7% as approximate current yield.
    let grahamRevised = null;
    const aaaYield = 4.7;
    if (!isNaN(eps) && gPercent !== null) {
      grahamRevised = (eps * (8.5 + 2 * gPercent) * 4.4) / aaaYield;
    }
    // Buffett DCF value
    let dcfValue = null;
    if (!isNaN(eps) && growthRate !== null) {
      dcfValue = computeDCF(eps, growthRate);
    }
    // Update UI
    document.getElementById('resultTicker').textContent = ticker;
    document.getElementById('currentPrice').textContent = formatCurrency(price);
    document.getElementById('eps').textContent = eps ? eps.toFixed(2) : 'N/A';
    document.getElementById('pegRatio').textContent = !isNaN(pegRatio) ? pegRatio.toFixed(2) : 'N/A';
    document.getElementById('growthRate').textContent = gPercent !== null && !isNaN(gPercent)
      ? gPercent.toFixed(2) + '%'
      : 'N/A';
    document.getElementById('lynchValue').textContent = lynchValue !== null && !isNaN(lynchValue)
      ? formatCurrency(lynchValue)
      : 'N/A';
    document.getElementById('grahamOriginal').textContent = grahamOriginal !== null && !isNaN(grahamOriginal)
      ? formatCurrency(grahamOriginal)
      : 'N/A';
    document.getElementById('grahamRevised').textContent = grahamRevised !== null && !isNaN(grahamRevised)
      ? formatCurrency(grahamRevised)
      : 'N/A';
    document.getElementById('dcfValue').textContent = dcfValue !== null && !isNaN(dcfValue)
      ? formatCurrency(dcfValue)
      : 'N/A';
    document.getElementById('results').classList.remove('d-none');
  } catch (err) {
    console.error(err);
    showAlert('Error fetching data. Please ensure your API key is valid and you have not exceeded your rate limit.');
  }
}

document.getElementById('searchBtn').addEventListener('click', fetchData);
