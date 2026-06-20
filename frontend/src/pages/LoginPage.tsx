import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { getMe, login, register } from '../api/endpoints'
import { useAuthStore, REFRESH_TOKEN_KEY } from '../stores/authStore'
import { getErrorMessage } from '../api/client'
import { useToast } from '../components/ui/Toast'
import { cn } from '../lib/format'

const FEATURES = [
  {
    icon: '📊',
    title: 'Options Intelligence',
    desc: 'Live chain analytics, PCR, max pain and OI build-up across NIFTY & SENSEX.',
  },
  {
    icon: '🧠',
    title: 'AI Signal Engine',
    desc: 'Model-driven bias, regime detection and illustrative risk frameworks.',
  },
  {
    icon: '🏦',
    title: 'Institutional Flow',
    desc: 'Track FII/DII positioning and smart-money footprints in real time.',
  },
]

type Tab = 'login' | 'register'

export function LoginPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const setSession = useAuthStore((s) => s.setSession)
  const setAccessToken = useAuthStore((s) => s.setAccessToken)

  const [tab, setTab] = useState<Tab>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [justRegistered, setJustRegistered] = useState(false)
  const [countdown, setCountdown] = useState(10)

  // After a successful registration, count down then switch to the login tab.
  useEffect(() => {
    if (!justRegistered) return
    if (countdown <= 0) {
      setTab('login')
      setJustRegistered(false)
      return
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [justRegistered, countdown])

  function goToLoginNow() {
    setJustRegistered(false)
    setTab('login')
  }

  if (isAuthenticated) return <Navigate to="/dashboard" replace />

  /** Logs in, fetches the user, then persists the full session. */
  async function establishSession(creds: { email: string; password: string }) {
    const tokens = await login(creds)
    setAccessToken(tokens.access_token)
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token)
    const me = await getMe()
    setSession(tokens, me)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      if (tab === 'register') {
        // Register only — do NOT auto-login. Show the success screen and
        // let the user sign in manually after the countdown.
        await register({ email, password, display_name: displayName })
        toast.success('Account created successfully')
        setPassword('')
        setDisplayName('')
        setCountdown(10)
        setJustRegistered(true)
        return
      }
      await establishSession({ email, password })
      toast.success('Welcome to Alphalytic AI')
      navigate('/dashboard', { replace: true })
    } catch (err) {
      toast.error(getErrorMessage(err, 'Authentication failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-white">
      {/* Left — brand panel */}
      <div className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-gradient-to-br from-[#1535c8] to-[#2350e8] p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/5 blur-2xl" />

        <div className="relative flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-xl">
            ⚡
          </span>
          <span className="text-lg font-bold tracking-tight">Alphalytic AI</span>
        </div>

        <div className="relative">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Analyse Markets.
            <br />
            Trade Smarter.
          </h1>
          <p className="mt-4 max-w-md text-sm text-white/70">
            An AI trading-intelligence terminal for NIFTY 50 and SENSEX — options
            analytics, market regimes and institutional flow in one place.
          </p>

          <div className="mt-10 space-y-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="flex items-start gap-3 rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm"
              >
                <span className="text-xl">{f.icon}</span>
                <div>
                  <div className="text-sm font-semibold">{f.title}</div>
                  <div className="mt-0.5 text-xs text-white/70">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-xs text-white/50">
          For educational purposes only · Not investment advice
        </div>
      </div>

      {/* Right — form */}
      <div className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-[56%]">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-1.5 flex items-center gap-2 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white">
              ⚡
            </span>
            <span className="font-bold text-slate-900">Alphalytic AI</span>
          </div>

          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-600">
            Alphalytic AI
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            {tab === 'login' ? 'Welcome Back' : 'Create your account'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {tab === 'login'
              ? 'Sign in to access your intelligence terminal.'
              : 'Register to start analysing the markets.'}
          </p>

          {justRegistered ? (
            <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-600">
                ✓
              </div>
              <h3 className="text-lg font-bold text-emerald-800">
                Account created successfully
              </h3>
              <p className="mt-1.5 text-sm text-emerald-700">
                Your account is ready. Please sign in with your registered email
                and password.
              </p>
              <p className="mt-4 text-sm font-medium text-slate-600">
                Redirecting to login in{' '}
                <span className="font-bold text-primary-600">{countdown}</span>{' '}
                second{countdown === 1 ? '' : 's'}…
              </p>
              <button
                type="button"
                onClick={goToLoginNow}
                className="mt-5 w-full rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700"
              >
                Go to login now
              </button>
            </div>
          ) : (
          <>
          {/* Tab toggle */}
          <div className="mt-6 grid grid-cols-2 rounded-lg bg-slate-100 p-1">
            {(['login', 'register'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-md py-2 text-sm font-medium transition-colors',
                  tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
                )}
              >
                {t === 'login' ? 'Sign In' : 'Register'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {tab === 'register' && (
              <Field
                label="Display name"
                type="text"
                value={displayName}
                onChange={setDisplayName}
                placeholder="Jane Trader"
                required
              />
            )}
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              required
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
            />

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? 'Please wait…'
                : tab === 'login'
                  ? 'Sign In'
                  : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            {tab === 'login' ? (
              <>
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  onClick={() => setTab('register')}
                  className="font-semibold text-primary-600 hover:text-primary-700"
                >
                  Register now
                </button>
              </>
            ) : (
              <>
                Already registered?{' '}
                <button
                  type="button"
                  onClick={() => setTab('login')}
                  className="font-semibold text-primary-600 hover:text-primary-700"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
          </>
          )}
        </div>
      </div>
    </div>
  )
}

interface FieldProps {
  label: string
  type: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  autoComplete?: string
}

function Field({ label, type, value, onChange, placeholder, required, autoComplete }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
      />
    </label>
  )
}
