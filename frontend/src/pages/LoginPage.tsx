import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { getMe, login, register } from '../api/endpoints'
import { useAuthStore, REFRESH_TOKEN_KEY } from '../stores/authStore'
import { getErrorMessage } from '../api/client'
import { useToast } from '../components/ui/Toast'

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
    <div className="flex min-h-screen">
      {/* Left — brand panel */}
      <div className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-gradient-to-br from-[#1535c8] to-[#2350e8] p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/5 blur-2xl" />

        <div className="relative flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-xl shadow-lg">
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
      <div className="relative flex w-full flex-col items-center justify-center overflow-hidden bg-white px-8 py-12 sm:px-14 lg:w-[56%]">
        {/* Subtle blue corner glows */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#1535c8]/6 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-8 h-48 w-48 rounded-full bg-[#2350e8]/6 blur-3xl" />

        <div className="relative w-full max-w-md">

          {/* Mobile logo */}
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1535c8] text-white">⚡</span>
            <span className="font-bold text-slate-900">Alphalytic AI</span>
          </div>

          {justRegistered ? (
            /* ── Success screen ── */
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-4xl text-emerald-600">✓</div>
              <h3 className="text-xl font-bold text-emerald-800">Account created!</h3>
              <p className="mt-2 text-sm text-emerald-700">
                Your account is ready. Please sign in with your registered email and password.
              </p>
              <p className="mt-4 text-sm font-medium text-slate-600">
                Redirecting in{' '}
                <span className="font-bold text-[#1535c8]">{countdown}</span>s…
              </p>
              <button
                type="button"
                onClick={goToLoginNow}
                className="mt-6 w-full rounded-xl bg-[#1535c8] py-3 text-sm font-semibold text-white transition-all hover:bg-[#1229a8]"
              >
                Go to login now
              </button>
            </div>
          ) : tab === 'login' ? (
            /* ══════════════════════════════════
               LOGIN VIEW
            ══════════════════════════════════ */
            <>
              {/* Heading */}
              <p className="text-3xl font-bold text-slate-900">Welcome back!</p>
              <p className="mt-0.5 text-3xl font-bold text-slate-900">Login to your account</p>
              <p className="mt-2 text-sm text-slate-500">
                It's nice to see you again. Ready to trade smarter?
              </p>

              {/* Form */}
              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <HRField
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="Your username or email"
                  required
                  autoComplete="email"
                />
                <HRField
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Your password"
                  required
                  autoComplete="current-password"
                />

                {/* Remember me + Forgot */}
                <div className="flex items-center justify-between pt-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 select-none">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-[#1535c8]" />
                    Remember me
                  </label>
                  <button
                    type="button"
                    onClick={() => toast.toast('Development in Progress')}
                    className="text-sm font-medium text-[#1535c8] hover:text-[#1229a8]"
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-[#1535c8] py-3 text-sm font-semibold text-white transition-all hover:bg-[#1229a8] hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Please wait…' : 'Log In'}
                </button>
              </form>

              {/* Divider */}
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-xs text-slate-400">or</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              {/* Continue with Google — full width */}
              <button
                type="button"
                onClick={() => toast.toast('Development in Progress')}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              {/* GitHub + Apple — side by side */}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => toast.toast('Development in Progress')}
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-800" fill="currentColor">
                    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                  </svg>
                  GitHub
                </button>
                <button
                  type="button"
                  onClick={() => toast.toast('Development in Progress')}
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-800" fill="currentColor">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                  </svg>
                  Apple
                </button>
              </div>

              {/* Switch to register */}
              <p className="mt-8 text-center text-sm text-slate-500">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => setTab('register')}
                  className="font-semibold text-[#1535c8] hover:text-[#1229a8]"
                >
                  Sign up
                </button>
              </p>
            </>
          ) : (
            /* ══════════════════════════════════
               REGISTER VIEW
            ══════════════════════════════════ */
            <>
              {/* Heading */}
              <p className="text-3xl font-bold text-slate-900">Join us</p>
              <p className="mt-0.5 text-3xl font-bold text-slate-900">Create your account</p>
              <p className="mt-2 text-sm text-slate-500">
                Start analysing markets with AI-powered intelligence.
              </p>

              {/* Form */}
              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <HRField
                  type="text"
                  value={displayName}
                  onChange={setDisplayName}
                  placeholder="Full Name"
                  required
                />
                <HRField
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="Email"
                  required
                  autoComplete="email"
                />
                <HRField
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Your password"
                  required
                  autoComplete="new-password"
                />

                {/* Terms checkbox */}
                <label className="flex cursor-pointer items-start gap-2.5 pt-1 text-xs text-slate-500 select-none">
                  <input type="checkbox" required className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-[#1535c8]" />
                  <span>
                    I agree to Alphalytic AI's{' '}
                    <button type="button" onClick={() => toast.toast('Development in Progress')} className="font-medium text-[#1535c8] hover:underline">Terms of Service</button>
                    {' '}and{' '}
                    <button type="button" onClick={() => toast.toast('Development in Progress')} className="font-medium text-[#1535c8] hover:underline">Privacy Policy</button>.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-[#1535c8] py-3 text-sm font-semibold text-white transition-all hover:bg-[#1229a8] hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Please wait…' : 'Sign up'}
                </button>
              </form>

              {/* Divider */}
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-xs text-slate-400">or</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              {/* Continue with Google — full width */}
              <button
                type="button"
                onClick={() => toast.toast('Development in Progress')}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              {/* GitHub + Apple — side by side */}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => toast.toast('Development in Progress')}
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-800" fill="currentColor">
                    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                  </svg>
                  GitHub
                </button>
                <button
                  type="button"
                  onClick={() => toast.toast('Development in Progress')}
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-800" fill="currentColor">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                  </svg>
                  Apple
                </button>
              </div>

              {/* Switch to login */}
              <p className="mt-8 text-center text-sm text-slate-500">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => setTab('login')}
                  className="font-semibold text-[#1535c8] hover:text-[#1229a8]"
                >
                  Log in
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface FieldProps {
  type: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  autoComplete?: string
}

function HRField({ type, value, onChange, placeholder, required, autoComplete }: FieldProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      autoComplete={autoComplete}
      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-[#1535c8] focus:ring-2 focus:ring-[#1535c8]/12 hover:border-slate-300"
    />
  )
}
