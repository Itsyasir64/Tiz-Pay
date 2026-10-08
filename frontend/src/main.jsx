import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowDownLeft, ArrowDownRight, ArrowLeftRight, ArrowRight, ArrowUpRight,
  Bell, ChevronDown, CircleDollarSign, Clock3, Coffee, CreditCard, Ellipsis,
  FileText, Headphones, Home, Leaf, Search, Send, ShieldCheck,
  ShoppingBag, Sparkles, X,
} from 'lucide-react'
import './styles.css'

const API_URL = import.meta.env.VITE_API_URL || ''
const ranges = ['7D', '30D', '90D']
const chartValues = {
  '7D': '0,114 44,98 88,105 132,69 176,82 220,53 264,62 308,34 352,42 396,14',
  '30D': '0,115 44,103 88,112 132,77 176,84 220,58 264,66 308,43 352,50 396,16',
  '90D': '0,116 44,105 88,80 132,94 176,64 220,70 264,44 308,57 352,29 396,15',
}

function money(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: 2,
  }).format(cents / 100)
}

function App() {
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [range, setRange] = useState('30D')
  const [query, setQuery] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')

  async function loadOverview() {
    try {
      const response = await fetch(`${API_URL}/api/overview`)
      if (!response.ok) throw new Error('Could not load your wallet.')
      setOverview(await response.json())
      setError('')
    } catch {
      setError('Your wallet is offline. Start the API and database to see live data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadOverview() }, [])

  const transactions = useMemo(() => {
    const items = overview?.transactions || []
    return items.filter((item) =>
      `${item.title} ${item.category}`.toLowerCase().includes(query.toLowerCase()),
    )
  }, [overview, query])

  async function sendTransfer(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const amount = Math.round(Number(form.get('amount')) * 100)
    const recipient = String(form.get('recipient')).trim()
    if (!Number.isFinite(amount) || amount < 1) {
      setNotice('Enter an amount greater than $0.00.')
      return
    }
    setSending(true)
    setNotice('')
    try {
      const response = await fetch(`${API_URL}/api/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient, amount_cents: amount }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Transfer could not be sent.')
      setTransferOpen(false)
      setNotice(`Sent ${money(amount, overview?.currency)} to ${recipient}.`)
      await loadOverview()
    } catch (err) {
      setNotice(err.message || 'Could not reach the payment service.')
    } finally {
      setSending(false)
    }
  }

  const currency = overview?.currency || 'USD'
  const firstName = overview?.owner_name?.split(' ')[0] || 'Alex'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Tiz Pay home">
          <span className="brand-mark"><CircleDollarSign size={21} strokeWidth={2.2} /></span>
          <span>tiz<span className="brand-light">pay</span></span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          <a className="nav-link selected" href="#overview"><Home size={17} /> Overview</a>
          <a className="nav-link" href="#activity"><ArrowLeftRight size={17} /> Activity</a>
          <button className="nav-link" onClick={() => setNotice('Your virtual card is on its way.') }>
            <CreditCard size={17} /> Cards <span className="nav-tag">1</span>
          </button>
        </nav>

        <div className="workspace-label tools-label">YOUR TOOLS</div>
        <nav className="primary-nav" aria-label="Wallet tools">
          <button className="nav-link" onClick={() => setNotice('Spending insights are coming soon.')}>
            <Sparkles size={17} /> Insights
          </button>
          <button className="nav-link" onClick={() => setNotice('Statements are coming soon.')}>
            <FileText size={17} /> Statements
          </button>
        </nav>

        <div className="sidebar-spacer" />
        <div className="help-link"><Headphones size={17} /><span>Need a hand?</span><ArrowRight size={14} /></div>
        <div className="profile-row">
          <div className="avatar">{firstName.slice(0, 1)}M</div>
          <div className="profile-copy"><strong>{overview?.owner_name || 'Alex Morgan'}</strong><span>Personal account</span></div>
          <button className="icon-button profile-menu" title="Account options" onClick={() => setNotice('Account settings are coming soon.')}><Ellipsis size={19} /></button>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>Overview</strong></div>
          <div className="top-actions">
            <span className="secure-label"><ShieldCheck size={14} /> Secure space</span>
            <button className="icon-button notification-button" title="Notifications" onClick={() => setNotice('You are all caught up.')}>
              <Bell size={18} /><span className="notification-dot" />
            </button>
            <button className="top-avatar" title="Account menu" onClick={() => setNotice('Signed in as Alex Morgan.')}>AM<ChevronDown size={13} /></button>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow">YOUR MONEY, IN MOTION <span className="eyebrow-rule" /></div>
              <h1>Good morning, {firstName}<span className="heading-period">.</span></h1>
              <p className="welcome-subtitle">Here’s your financial snapshot for today.</p>
            </div>
            <button className="date-button"><Clock3 size={15} /> Today <ChevronDown size={14} /></button>
          </section>

          {error && <div className="connection-banner" role="status">{error}</div>}
          {notice && <div className="notice-banner" role="status"><span>{notice}</span><button className="icon-button" title="Dismiss" onClick={() => setNotice('')}><X size={16} /></button></div>}

          <section className="overview-grid" aria-label="Wallet overview">
            <div className="balance-panel">
              <div className="panel-kicker"><span>AVAILABLE BALANCE</span><span className="live-indicator"><i /> LIVE</span></div>
              <div className="balance-amount">{loading ? <span className="loading-dash">—</span> : money(overview?.balance_cents || 0, currency)}</div>
              <div className="balance-foot"><span><span className="balance-dot" /> Personal wallet</span><span>USD <ChevronDown size={13} /></span></div>
              <div className="balance-actions">
                <button className="send-button" onClick={() => setTransferOpen(true)}><Send size={15} /> Send money <ArrowUpRight size={15} /></button>
                <button className="request-button" onClick={() => setNotice('Payment requests are coming soon.')}><ArrowDownLeft size={16} /> Request</button>
              </div>
              <span className="balance-orbit orbit-one" /><span className="balance-orbit orbit-two" />
            </div>

            <div className="insight-panel">
              <div className="section-topline"><div><div className="panel-kicker dark-kicker">CASH FLOW <span className="trend-chip"><ArrowUpRight size={13} /> 12.8%</span></div><h2>Your money, at a glance</h2></div><button className="icon-button chart-menu" title="More chart options"><Ellipsis size={19} /></button></div>
              <div className="flow-legend"><span><i className="legend-in" /> In <strong>{money(overview?.income_cents || 0, currency)}</strong></span><span><i className="legend-out" /> Out <strong>{money(overview?.spending_cents || 0, currency)}</strong></span></div>
              <div className="chart-wrap" aria-label={`Balance trend for the last ${range}`}>
                <div className="chart-y-labels"><span>$5k</span><span>$3k</span><span>$1k</span></div>
                <svg className="balance-chart" viewBox="0 0 396 132" preserveAspectRatio="none" role="img" aria-label="Upward balance trend">
                  <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#c8f660" stopOpacity=".25" /><stop offset="100%" stopColor="#c8f660" stopOpacity="0" /></linearGradient></defs>
                  <path className="chart-gridline" d="M0 25H396 M0 65H396 M0 105H396" />
                  <polygon className="chart-area" points={`0,132 ${chartValues[range]} 396,132`} />
                  <polyline className="chart-line" points={chartValues[range]} />
                  <circle className="chart-point" cx="396" cy="14" r="4" />
                </svg>
                <div className="chart-x-labels"><span>01 Jun</span><span>08 Jun</span><span>15 Jun</span><span>22 Jun</span><span>Today</span></div>
              </div>
              <div className="range-switch" aria-label="Chart range">{ranges.map((item) => <button className={range === item ? 'range-active' : ''} key={item} onClick={() => setRange(item)}>{item}</button>)}</div>
            </div>
          </section>

          <section className="lower-grid">
            <div className="activity-panel" id="activity">
              <div className="activity-heading"><div><div className="panel-kicker dark-kicker">THE LATEST</div><h2>Recent activity</h2></div><div className="activity-controls"><label className="search-field"><Search size={15} /><input aria-label="Search activity" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="all-activity" onClick={() => document.getElementById('activity-list')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>See all <ArrowRight size={14} /></button></div></div>
              <div className="transaction-list" id="activity-list">
                {transactions.length ? transactions.map((transaction, index) => <TransactionRow key={transaction.id} transaction={transaction} currency={currency} index={index} />) : <div className="empty-state">{loading ? 'Loading activity…' : 'No matching activity.'}</div>}
              </div>
            </div>

            <aside className="side-stack">
              <div className="spending-panel">
                <div className="section-topline"><div><div className="panel-kicker dark-kicker">THIS MONTH</div><h2>Spending</h2></div><button className="icon-button" title="Spending options"><Ellipsis size={19} /></button></div>
                <div className="spending-total">{money(overview?.spending_cents || 0, currency)} <span>of $2,500</span></div>
                <div className="spend-track"><span /></div>
                <div className="spend-foot"><span><span className="spend-dot" /> 74% of monthly budget</span><span className="under-budget">On track</span></div>
              </div>
              <div className="savings-panel"><div className="savings-icon"><Leaf size={17} /></div><div className="savings-copy"><strong>Small steps add up.</strong><span>Set a savings goal for what’s next.</span></div><button className="icon-button savings-arrow" title="Explore savings" onClick={() => setNotice('Savings goals are coming soon.')}><ArrowRight size={17} /></button></div>
            </aside>
          </section>

          <footer className="page-footer"><span>© 2025 Tiz Pay, Inc.</span><span><ShieldCheck size={13} /> Your money is protected</span><button onClick={() => setNotice('Support: hello@tizpay.example')}>Help center</button></footer>
        </div>
      </main>

      {transferOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setTransferOpen(false) }}>
        <section className="transfer-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
          <div className="modal-top"><div className="modal-icon"><ArrowUpRight size={19} /></div><button className="icon-button" title="Close" onClick={() => setTransferOpen(false)}><X size={19} /></button></div>
          <div className="eyebrow">QUICK TRANSFER</div><h2 id="transfer-title">Send money</h2><p className="modal-description">Move money from your wallet in just a moment.</p>
          <form onSubmit={sendTransfer}>
            <label className="form-label" htmlFor="recipient">Send to</label><input className="form-input" id="recipient" name="recipient" placeholder="Name or email address" minLength="2" maxLength="100" required />
            <label className="form-label amount-label" htmlFor="amount">Amount</label><div className="amount-input-wrap"><span>$</span><input className="amount-input" id="amount" name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" required /></div>
            <div className="available-note">Available balance <strong>{money(overview?.balance_cents || 0, currency)}</strong></div>
            <button className="modal-submit" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Review transfer'} <ArrowRight size={16} /></button>
          </form>
        </section>
      </div>}
    </div>
  )
}

function TransactionRow({ transaction, currency, index }) {
  const icon = transaction.category === 'Income' ? <ArrowDownRight size={17} />
    : transaction.category === 'Transfer' ? <ArrowLeftRight size={16} />
      : transaction.category === 'Food & drink' ? <Coffee size={16} />
        : transaction.category === 'Subscriptions' ? <Headphones size={16} />
          : <ShoppingBag size={16} />
  const date = new Date(transaction.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return <div className="transaction-row" style={{ '--row-index': index }}>
    <div className={`transaction-icon ${transaction.direction === 'in' ? 'income-icon' : ''}`}>{icon}</div>
    <div className="transaction-copy"><strong>{transaction.title}</strong><span>{transaction.category}</span></div>
    <span className="transaction-date">{date}</span>
    <span className={`transaction-amount ${transaction.direction === 'in' ? 'amount-in' : ''}`}>{transaction.direction === 'in' ? '+' : '−'}{money(transaction.amount_cents, currency)}</span>
  </div>
}

export default App

createRoot(document.getElementById('root')).render(<App />)