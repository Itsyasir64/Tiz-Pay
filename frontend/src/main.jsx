import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowDownLeft, ArrowDownRight, ArrowLeftRight, ArrowRight, ArrowUpRight,
  AtSign, Bell, Bot, CalendarDays, ChevronDown, CircleDollarSign, Coffee, Copy,
  CreditCard, Download, Ellipsis, Eye, EyeOff, FileText, Headphones, Home, Leaf, Mail,
  KeyRound, LockKeyhole, MessageCircle, Search, Send, ShieldCheck, ShoppingBag, Snowflake, Sparkles,
  UserRound, X,
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

function dateInputValue(date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

function displayDate(value) {
  if (!value) return '—'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function App() {
  const [experience, setExperience] = useState('splash')
  const [authView, setAuthView] = useState('login')
  const [authNotice, setAuthNotice] = useState('')
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [range, setRange] = useState('30D')
  const [query, setQuery] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [cardsOpen, setCardsOpen] = useState(false)
  const [cardFrozen, setCardFrozen] = useState(false)
  const [cardDetailsVisible, setCardDetailsVisible] = useState(false)
  const [statementOpen, setStatementOpen] = useState(false)
  const [statementEndDate, setStatementEndDate] = useState(() => dateInputValue(new Date()))
  const [statementStartDate, setStatementStartDate] = useState(() => {
    const start = new Date()
    start.setDate(start.getDate() - 29)
    return dateInputValue(start)
  })
  const [statementTransactions, setStatementTransactions] = useState([])
  const [statementLoading, setStatementLoading] = useState(false)
  const [statementError, setStatementError] = useState('')
  const [statementDownloadStatus, setStatementDownloadStatus] = useState('')
  const [statementDownloading, setStatementDownloading] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatDraft, setChatDraft] = useState('')
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', text: 'Hi Yasir! I’m TizChat. What can I help you with today?' },
  ])
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const chatEndRef = useRef(null)

  function transitionToAuth() {
    if (document.startViewTransition) {
      document.startViewTransition(() => setExperience('auth'))
      return
    }
    setExperience('auth')
  }

  useEffect(() => {
    const timer = window.setTimeout(transitionToAuth, 5000)
    return () => window.clearTimeout(timer)
  }, [])

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

  useEffect(() => {
    if (!statementOpen) return undefined
    if (!statementStartDate || !statementEndDate || statementStartDate > statementEndDate) {
      setStatementTransactions([])
      setStatementError('Choose a valid date range.')
      setStatementLoading(false)
      return undefined
    }

    const controller = new AbortController()
    async function loadStatement() {
      setStatementLoading(true)
      setStatementError('')
      setStatementDownloadStatus('')
      try {
        const params = new URLSearchParams({ start_date: statementStartDate, end_date: statementEndDate })
        const response = await fetch(`${API_URL}/api/transactions?${params}`, { signal: controller.signal })
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || 'Could not load the statement.')
        setStatementTransactions(result)
      } catch (err) {
        if (!controller.signal.aborted) {
          setStatementError(err.message || 'Could not load the statement.')
          setStatementTransactions([])
        }
      } finally {
        if (!controller.signal.aborted) setStatementLoading(false)
      }
    }
    loadStatement()
    return () => controller.abort()
  }, [statementOpen, statementStartDate, statementEndDate])

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

  async function copyWalletName() {
    try {
      await navigator.clipboard.writeText(ownerName)
      setNotice('Wallet name copied to clipboard.')
    } catch {
      setNotice(`Share this wallet name with the sender: ${ownerName}`)
    }
    setReceiveOpen(false)
  }

  const currency = overview?.currency || 'USD'
  const ownerName = overview?.owner_name || 'Yasir Ali'
  const firstName = ownerName.split(' ')[0]
  const initials = ownerName.split(/\s+/).map((name) => name[0]).slice(0, 2).join('').toUpperCase()
  const username = `@${ownerName.toLowerCase().replace(/[^a-z0-9]+/g, '')}`
  const todayDate = dateInputValue(new Date())
  const statementTotals = statementTransactions.reduce((totals, transaction) => {
    if (transaction.direction === 'in') totals.income += transaction.amount_cents
    else totals.spending += transaction.amount_cents
    return totals
  }, { income: 0, spending: 0 })

  async function downloadStatementPdf() {
    setStatementDownloading(true)
    setStatementDownloadStatus('')
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ])
      const document = new jsPDF()
      const pageWidth = document.internal.pageSize.getWidth()
      document.setFillColor(35, 41, 31)
      document.roundedRect(15, 15, pageWidth - 30, 34, 4, 4, 'F')
      document.setTextColor(201, 247, 101)
      document.setFontSize(9)
      document.setFont('helvetica', 'bold')
      document.text('TIZPAY', 22, 24)
      document.setTextColor(255, 255, 255)
      document.setFontSize(17)
      document.text('Account statement', 22, 40)
      document.setTextColor(54, 61, 49)
      document.setFontSize(10)
      document.text(`Account holder: ${ownerName}`, 15, 60)
      document.setTextColor(115, 122, 109)
      document.setFontSize(9)
      document.text(`Statement period: ${displayDate(statementStartDate)} – ${displayDate(statementEndDate)}`, 15, 67)

      const summaryY = 76
      const summaryGap = 4
      const summaryWidth = (pageWidth - 30 - summaryGap * 2) / 3
      const summaryCards = [
        ['MONEY IN', money(statementTotals.income, currency)],
        ['MONEY OUT', money(statementTotals.spending, currency)],
        ['TRANSACTIONS', String(statementTransactions.length)],
      ]
      summaryCards.forEach(([label, value], index) => {
        const x = 15 + index * (summaryWidth + summaryGap)
        document.setFillColor(246, 248, 242)
        document.roundedRect(x, summaryY, summaryWidth, 25, 2, 2, 'F')
        document.setTextColor(119, 128, 109)
        document.setFontSize(7)
        document.text(label, x + 4, summaryY + 8)
        document.setTextColor(49, 57, 44)
        document.setFontSize(index === 2 ? 11 : 9)
        document.text(value, x + 4, summaryY + 18)
      })

      const rows = statementTransactions.map((transaction) => [
        displayDate(transaction.created_at.slice(0, 10)),
        transaction.title,
        transaction.category,
        transaction.status,
        `${transaction.direction === 'in' ? '+' : '−'}${money(transaction.amount_cents, currency)}`,
      ])
      autoTable(document, {
        startY: 110,
        head: [['Date', 'Description', 'Category', 'Status', 'Amount']],
        body: rows.length ? rows : [['—', 'No activity during this period', '—', '—', '—']],
        theme: 'grid',
        margin: { left: 15, right: 15 },
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: [62, 69, 58], lineColor: [231, 234, 226] },
        headStyles: { fillColor: [239, 244, 231], textColor: [68, 82, 53], fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 29 }, 2: { cellWidth: 30 }, 3: { cellWidth: 25 }, 4: { halign: 'right', cellWidth: 32 } },
      })
      document.save(`tizpay-statement-${statementStartDate}-to-${statementEndDate}.pdf`)
      setStatementDownloadStatus('Your PDF statement is ready.')
    } catch {
      setStatementDownloadStatus('Could not create the PDF. Please try again.')
    } finally {
      setStatementDownloading(false)
    }
  }

  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chatMessages, chatOpen])

  function getChatReply(message) {
    const text = message.toLowerCase()
    if (/balance|funds|money do i have/.test(text)) {
      return `Your available balance is ${money(overview?.balance_cents || 0, currency)}.`
    }
    if (/send|transfer|pay someone/.test(text)) {
      return 'To send money, use the Send money button in the top bar or on your wallet card. You’ll need the recipient’s name and an amount.'
    }
    if (/receive|request|get paid/.test(text)) {
      return `To receive money, share your TizPay username ${username}. Incoming payments aren’t processed in this demo.`
    }
    if (/username|account|profile|password|personal detail/.test(text)) {
      return `Your TizPay username is ${username}. Click your profile avatar to see your personal account details. Your password is not stored in this demo.`
    }
    if (/activity|transaction|recent|history/.test(text)) {
      const recent = overview?.transactions?.slice(0, 3) || []
      return recent.length
        ? `Your latest activity includes ${recent.map((item) => item.title).join(', ')}. See the Recent activity section for amounts and dates.`
        : 'There are no recent transactions to show yet.'
    }
    if (/help|support|contact/.test(text)) {
      return 'I can help with your balance, transfers, receiving money, profile details, and recent activity. TizChat is an automated demo helper.'
    }
    return 'I can help with your balance, sending or receiving money, account details, and recent activity. What would you like to know?'
  }

  function sendChatMessage(event) {
    event.preventDefault()
    const message = chatDraft.trim()
    if (!message) return
    setChatMessages((messages) => [
      ...messages,
      { role: 'user', text: message },
      { role: 'assistant', text: getChatReply(message) },
    ])
    setChatDraft('')
  }

  function handleAuthSubmit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') || '').trim()
    if (authView === 'forgot') {
      setAuthNotice(`If an account exists for ${email}, password reset instructions would be sent.`)
      return
    }
    setExperience('dashboard')
    setNotice(authView === 'signup' ? 'Welcome to the TizPay demo.' : 'Signed in to the TizPay demo.')
  }

  return (
    experience === 'splash' ? <main className="tiz-splash" aria-label="TizPay loading screen">
      <div className="splash-glow splash-glow-one" /><div className="splash-glow splash-glow-two" />
      <div className="splash-content">
        <div className="splash-logo"><span className="splash-mark"><CircleDollarSign size={27} strokeWidth={2.2} /></span><span>tiz<span>pay</span></span></div>
        <div className="splash-orbit" aria-hidden="true"><span className="splash-orbit-core"><CircleDollarSign size={42} /></span><i /><i /><i /></div>
        <p className="splash-kicker">MONEY, MADE CLEAR</p>
        <h1>Your money,<br /><span>at a glance.</span></h1>
        <p className="splash-caption">A calmer way to see, send, and manage your money.</p>
        <div className="splash-progress" role="progressbar" aria-label="Loading TizPay"><span /></div>
      </div>
      <div className="splash-footer"><span>SMARTER MONEY MOMENTS</span><span>01 <i /> 03</span></div>
    </main> : experience === 'auth' ? <main className="auth-page">
      <nav className="auth-nav" aria-label="Authentication navigation">
        <a className="auth-brand" href="#signin" aria-label="TizPay"><span><CircleDollarSign size={20} /></span>tiz<span>pay</span></a>
        <div className="auth-nav-trust"><ShieldCheck size={15} /> A little more clarity, every day</div>
      </nav>
      <div className="auth-layout">
        <section className="auth-intro">
          <div className="auth-intro-orb"><span><CircleDollarSign size={38} /></span><i /><i /><i /></div>
          <p className="auth-eyebrow">YOUR MONEY, AT A GLANCE</p>
          <h1>Make room for<br /><span>what matters.</span></h1>
          <p className="auth-intro-copy">One thoughtful place for your everyday money. See your balance, follow your activity, and feel more in control.</p>
          <div className="auth-benefits"><span><i /> A clear view of your wallet</span><span><i /> Your activity, all in one place</span></div>
          <div className="auth-trust-card"><ShieldCheck size={17} /><span><strong>Your money, your view.</strong><small>A simple, private-feeling space to stay on top of things.</small></span></div>
        </section>
        <section className="auth-card" aria-labelledby="auth-title">
          {authView !== 'forgot' && <div className="auth-tabs" role="tablist" aria-label="Account access">
            <button className={authView === 'login' ? 'auth-tab active' : 'auth-tab'} role="tab" aria-selected={authView === 'login'} onClick={() => { setAuthView('login'); setAuthNotice('') }}>Sign in</button>
            <button className={authView === 'signup' ? 'auth-tab active' : 'auth-tab'} role="tab" aria-selected={authView === 'signup'} onClick={() => { setAuthView('signup'); setAuthNotice('') }}>Create account</button>
          </div>}
          <div className="auth-card-heading">
            <span className="auth-heading-icon">{authView === 'forgot' ? <KeyRound size={19} /> : authView === 'signup' ? <UserRound size={19} /> : <LockKeyhole size={19} />}</span>
            <p className="auth-eyebrow">{authView === 'forgot' ? 'ACCOUNT RECOVERY' : authView === 'signup' ? 'A FRESH START' : 'WELCOME BACK'}</p>
            <h2 id="auth-title">{authView === 'forgot' ? 'Reset your password' : authView === 'signup' ? 'Create your account' : 'Good to see you.'}</h2>
            <p>{authView === 'forgot' ? 'Enter the email linked to your account and we’ll help you get back in.' : authView === 'signup' ? 'A clearer view of your money starts here.' : 'Sign in to your personal money space.'}</p>
          </div>
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {authView === 'signup' && <label>Full name<span className="auth-input"><UserRound size={16} /><input autoComplete="name" name="name" placeholder="Your full name" minLength="2" required /></span></label>}
            <label>Email address<span className="auth-input"><Mail size={16} /><input autoComplete="email" name="email" type="email" placeholder="you@example.com" required /></span></label>
            {authView !== 'forgot' && <label>Password<span className="auth-input"><LockKeyhole size={16} /><input autoComplete={authView === 'signup' ? 'new-password' : 'current-password'} name="password" type="password" placeholder="At least 8 characters" minLength={authView === 'signup' ? 8 : undefined} required /></span></label>}
            {authView === 'login' && <div className="auth-form-options"><label className="auth-remember"><input type="checkbox" name="remember" /> <span>Remember me</span></label><button type="button" onClick={() => { setAuthView('forgot'); setAuthNotice('') }}>Forgot password?</button></div>}
            {authNotice && <p className="auth-feedback" role="status">{authNotice}</p>}
            <button className="auth-submit" type="submit">{authView === 'forgot' ? 'Send reset instructions' : authView === 'signup' ? 'Create account' : 'Sign in'} <ArrowRight size={17} /></button>
          </form>
          {authView === 'forgot' ? <button className="auth-back" onClick={() => { setAuthView('login'); setAuthNotice('') }}>Back to sign in</button>
            : <p className="auth-switch">{authView === 'signup' ? 'Already have an account?' : 'New to TizPay?'} <button onClick={() => { setAuthView(authView === 'signup' ? 'login' : 'signup'); setAuthNotice('') }}>{authView === 'signup' ? 'Sign in' : 'Create an account'}</button></p>}
          <p className="auth-demo-note">Demo access only. Sign-in, account creation, and password recovery are not connected to a real authentication service.</p>
        </section>
      </div>
      <footer className="auth-footer"><span>© 2025 TizPay</span><span>Built for everyday clarity</span><button type="button" onClick={() => { setExperience('dashboard'); setNotice('Opened the TizPay local demo.') }}>Explore demo <ArrowRight size={13} /></button></footer>
    </main> : (
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
          <button className={`nav-link ${cardsOpen ? 'selected' : ''}`} onClick={() => setCardsOpen(true)}>
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
          <button className="profile-account" aria-label="Open personal account details" onClick={() => setAccountOpen(true)}>
            <span className="avatar">{initials}</span>
            <span className="profile-copy"><strong>{ownerName}</strong><span>Personal account</span></span>
          </button>
          <button className="icon-button profile-menu" title="Account options" onClick={() => setNotice('Account settings are coming soon.')}><Ellipsis size={19} /></button>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>Overview</strong></div>
          <div className="top-actions">
            <button className="header-action header-send" aria-label="Send money" onClick={() => setTransferOpen(true)}><Send size={14} /><span>Send money</span></button>
            <button className="header-action header-receive" aria-label="Receive money" onClick={() => setReceiveOpen(true)}><ArrowDownLeft size={15} /><span>Receive money</span></button>
            <span className="secure-label"><ShieldCheck size={14} /> Secure space</span>
            <button className="icon-button notification-button" title="Notifications" onClick={() => setNotice('You are all caught up.')}>
              <Bell size={18} /><span className="notification-dot" />
            </button>
            <button className="top-avatar" title="Personal account details" onClick={() => setAccountOpen(true)}>{initials}<ChevronDown size={13} /></button>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow">YOUR MONEY, IN MOTION <span className="eyebrow-rule" /></div>
              <h1>Good morning, {firstName}<span className="heading-period">.</span></h1>
              <p className="welcome-subtitle">Here’s your financial snapshot for today.</p>
            </div>
            <button className="date-button" onClick={() => setStatementOpen(true)} aria-label="Choose statement date range"><CalendarDays size={15} /> Statement <ChevronDown size={14} /></button>
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
                <button className="request-button" onClick={() => setReceiveOpen(true)}><ArrowDownLeft size={16} /> Receive money</button>
              </div>
              <button className="manage-card-link" onClick={() => setCardsOpen(true)}><CreditCard size={14} /> Manage Visa card <ArrowRight size={13} /></button>
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
      {receiveOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setReceiveOpen(false) }}>
        <section className="transfer-modal" role="dialog" aria-modal="true" aria-labelledby="receive-title">
          <div className="modal-top"><div className="modal-icon"><ArrowDownLeft size={19} /></div><button className="icon-button" title="Close" onClick={() => setReceiveOpen(false)}><X size={19} /></button></div>
          <div className="eyebrow">GET PAID</div><h2 id="receive-title">Receive money</h2><p className="modal-description">Share your wallet name with the sender. Incoming payments aren’t processed in this demo.</p>
          <div className="wallet-share"><span>Wallet name</span><strong>{ownerName}</strong></div>
          <button className="modal-submit" type="button" onClick={copyWalletName}>Copy wallet name <Copy size={16} /></button>
        </section>
      </div>}
      {accountOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAccountOpen(false) }}>
        <section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-title">
          <div className="account-modal-top"><div><div className="eyebrow">YOUR PROFILE</div><h2 id="account-title">Personal account</h2></div><button className="icon-button" title="Close" onClick={() => setAccountOpen(false)}><X size={19} /></button></div>
          <div className="account-identity"><span className="account-avatar">{initials}</span><div><strong>{ownerName}</strong><span>Personal wallet · {currency}</span></div><ShieldCheck size={19} /></div>
          <div className="account-details">
            <div className="account-detail"><span className="account-detail-icon"><CircleDollarSign size={16} /></span><div><small>Full name</small><strong>{ownerName}</strong></div></div>
            <div className="account-detail"><span className="account-detail-icon"><AtSign size={16} /></span><div><small>TizPay username</small><strong>{username}</strong></div></div>
            <div className="account-detail"><span className="account-detail-icon"><LockKeyhole size={16} /></span><div><small>Password</small><strong className="masked-password" aria-label="Password hidden">••••••••••••</strong><small className="password-note">Hidden for your security</small></div></div>
            <div className="account-detail"><span className="account-detail-icon"><ShieldCheck size={16} /></span><div><small>Account type</small><strong>Personal account</strong></div></div>
          </div>
          <button className="account-done" onClick={() => setAccountOpen(false)}>Done</button>
          <p className="account-demo-note">Demo profile details. No password is stored or displayed here.</p>
        </section>
      </div>}
      {statementOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setStatementOpen(false) }}>
        <section className="statement-modal" role="dialog" aria-modal="true" aria-labelledby="statement-title">
          <div className="statement-modal-top"><div><div className="eyebrow">ACCOUNT ACTIVITY</div><h2 id="statement-title">Your statement</h2></div><button className="icon-button" title="Close" onClick={() => setStatementOpen(false)}><X size={19} /></button></div>
          <p className="statement-description">Choose a date range to review and download your account activity. The default is the last 30 days.</p>
          <div className="statement-date-range">
            <label>From<input type="date" value={statementStartDate} max={statementEndDate || todayDate} onChange={(event) => setStatementStartDate(event.target.value)} /></label>
            <ArrowRight size={16} />
            <label>To<input type="date" value={statementEndDate} min={statementStartDate} max={todayDate} onChange={(event) => setStatementEndDate(event.target.value)} /></label>
          </div>
          <div className="statement-period-label">{displayDate(statementStartDate)} – {displayDate(statementEndDate)}</div>
          <div className="statement-stats">
            <div><span>Money in</span><strong>{money(statementTotals.income, currency)}</strong></div>
            <div><span>Money out</span><strong>{money(statementTotals.spending, currency)}</strong></div>
            <div><span>Transactions</span><strong>{statementTransactions.length}</strong></div>
          </div>
          <div className="statement-preview" aria-live="polite">
            {statementLoading ? <div className="statement-message">Loading statement…</div>
              : statementError ? <div className="statement-message statement-error">{statementError}</div>
                : statementTransactions.length ? statementTransactions.map((transaction) => <div className="statement-row" key={transaction.id}>
                  <div><strong>{transaction.title}</strong><span>{displayDate(transaction.created_at.slice(0, 10))} · {transaction.category}</span></div>
                  <strong className={transaction.direction === 'in' ? 'statement-income' : ''}>{transaction.direction === 'in' ? '+' : '−'}{money(transaction.amount_cents, currency)}</strong>
                </div>)
                  : <div className="statement-message">No transactions in this date range.</div>}
          </div>
          {statementDownloadStatus && <div className="statement-download-status" role="status">{statementDownloadStatus}</div>}
          <button className="statement-download" onClick={downloadStatementPdf} disabled={statementLoading || statementDownloading || Boolean(statementError)}><Download size={16} /> {statementDownloading ? 'Preparing PDF…' : 'Download PDF statement'}</button>
        </section>
      </div>}
      {cardsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCardsOpen(false) }}>
        <section className="cards-modal" role="dialog" aria-modal="true" aria-labelledby="cards-title">
          <div className="cards-modal-top"><div><div className="eyebrow">YOUR WALLET</div><h2 id="cards-title">Your cards</h2></div><button className="icon-button" title="Close" onClick={() => setCardsOpen(false)}><X size={19} /></button></div>
          <p className="cards-description">Your TizPay Visa debit card and security controls.</p>
          <div className={`visa-card ${cardFrozen ? 'visa-card-frozen' : ''}`}>
            <div className="visa-card-top"><div className="visa-brand"><span className="visa-brand-mark"><CircleDollarSign size={17} /></span><span>tiz<span>pay</span></span></div><span className="visa-contactless">)))</span></div>
            <div className="visa-chip"><span /></div>
            <div className="visa-number" aria-label="Card number">
              <span>4242</span><span>{cardDetailsVisible ? '5618' : '••••'}</span><span>{cardDetailsVisible ? '0395' : '••••'}</span><span>1842</span>
            </div>
            <div className="visa-card-bottom"><div><small>CARD HOLDER</small><strong>{ownerName.toUpperCase()}</strong></div><div><small>EXPIRES</small><strong>08/29</strong></div><div><small>CVC</small><strong>{cardDetailsVisible ? '482' : '•••'}</strong></div><span className="visa-wordmark">VISA</span></div>
            {cardFrozen && <div className="frozen-overlay"><Snowflake size={17} /> CARD FROZEN</div>}
          </div>
          <div className="card-security-note"><ShieldCheck size={15} /><span>Only the first and last four digits are shown by default. This is a fictional demo card.</span></div>
          <div className="card-controls">
            <button className="card-detail-toggle" onClick={() => setCardDetailsVisible((visible) => !visible)}>{cardDetailsVisible ? <EyeOff size={16} /> : <Eye size={16} />}{cardDetailsVisible ? 'Hide demo details' : 'Reveal demo details'}<span>{cardDetailsVisible ? '••••' : '••••'}</span></button>
            <button className={`freeze-card-button ${cardFrozen ? 'is-frozen' : ''}`} onClick={() => setCardFrozen((frozen) => !frozen)}><Snowflake size={17} /><span><strong>{cardFrozen ? 'Unfreeze card' : 'Freeze card'}</strong><small>{cardFrozen ? 'Resume card use' : 'Temporarily lock this card'}</small></span><span className={`freeze-switch ${cardFrozen ? 'switch-on' : ''}`}><i /></span></button>
          </div>
          <p className="card-demo-note">Demo Visa card details for display only. No real card or payment network is connected.</p>
        </section>
      </div>}
      <div className="tizchat-widget">
        {chatOpen && <section className="tizchat-panel" aria-label="TizChat assistant">
          <header className="tizchat-header">
            <span className="tizchat-avatar"><Bot size={19} /></span>
            <div className="tizchat-heading"><strong>TizChat</strong><span><i /> Here to help</span></div>
            <button className="tizchat-close" aria-label="Close TizChat" onClick={() => setChatOpen(false)}><X size={17} /></button>
          </header>
          <div className="tizchat-messages" aria-live="polite">
            {chatMessages.map((message, index) => <div className={`tizchat-message ${message.role}`} key={`${message.role}-${index}`}>
              {message.role === 'assistant' && <span className="message-avatar"><Bot size={13} /></span>}
              <p>{message.text}</p>
            </div>)}
            {chatMessages.length === 1 && <div className="tizchat-quick-actions">
              <button onClick={() => { setChatOpen(false); setTransferOpen(true) }}>Send money</button>
              <button onClick={() => { setChatOpen(false); setReceiveOpen(true) }}>Receive money</button>
            </div>}
            <div ref={chatEndRef} />
          </div>
          <form className="tizchat-composer" onSubmit={sendChatMessage}>
            <input aria-label="Message TizChat" placeholder="Ask about your wallet…" value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} />
            <button aria-label="Send message" type="submit" disabled={!chatDraft.trim()}><Send size={16} /></button>
          </form>
          <div className="tizchat-footnote">TizChat is an automated demo helper.</div>
        </section>}
        <button className={`tizchat-launcher ${chatOpen ? 'chat-is-open' : ''}`} aria-label={chatOpen ? 'Close TizChat' : 'Open TizChat'} aria-expanded={chatOpen} onClick={() => setChatOpen((open) => !open)}>
          {chatOpen ? <X size={20} /> : <MessageCircle size={20} />}<span>TizChat</span>
        </button>
      </div>
    </div>
    )
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