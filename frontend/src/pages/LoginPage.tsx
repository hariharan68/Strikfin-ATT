import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { BarChart3, Brain, Landmark, Zap, Check, AtSign, Lock, Eye, EyeOff } from 'lucide-react'
import { getMe, login, register } from '../api/endpoints'
import { applyServerPreferences } from '../lib/session'
import { useAuthStore, REFRESH_TOKEN_KEY } from '../stores/authStore'
import { getErrorMessage } from '../api/client'
import { useToast } from '../components/ui/Toast'

const FEATURES: { Icon: LucideIcon; title: string; desc: string }[] = [
  {
    Icon: BarChart3,
    title: 'Options Intelligence',
    desc: 'Live chain analytics, PCR, max pain and OI build-up across NIFTY & SENSEX.',
  },
  {
    Icon: Brain,
    title: 'AI Signal Engine',
    desc: 'Model-driven bias, regime detection and illustrative risk frameworks.',
  },
  {
    Icon: Landmark,
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
    await applyServerPreferences()
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
      toast.success('Welcome to Strikfin')
      navigate('/dashboard', { replace: true })
    } catch (err) {
      toast.error(getErrorMessage(err, 'Authentication failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-[#0a0c10]">
      {/* Left — brand panel (terracotta → near-black) */}
      <div className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-gradient-to-br from-[#a83e1d] via-[#6e2c15] to-[#120805] p-12 text-white lg:flex">
        {/* Warm glows + faint grid for a terminal feel */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#f0763f]/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-black/30 blur-2xl" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)',
            backgroundSize: '36px 36px',
          }}
        />

        <div className="relative flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 shadow-lg ring-1 ring-white/30">
            <Zap size={22} fill="currentColor" />
          </span>
          <span className="text-lg font-bold tracking-tight">Strikfin</span>
        </div>

        <div className="relative">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Analyse Markets.
            <br />
            Trade Smarter.
          </h1>
          <p className="mt-4 max-w-md text-sm text-white/75">
            An AI trading-intelligence terminal for NIFTY 50 and SENSEX — options
            analytics, market regimes and institutional flow in one place.
          </p>

          <div className="mt-10 space-y-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="flex items-start gap-3 rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm transition-colors hover:bg-white/15"
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/20 ring-1 ring-white/15">
                  <f.Icon size={18} />
                </span>
                <div>
                  <div className="text-sm font-semibold">{f.title}</div>
                  <div className="mt-0.5 text-xs text-white/70">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-xs text-white/55">
          For educational purposes only · Not investment advice
        </div>
      </div>

      {/* Right — form (near-black) */}
      <div className="relative flex w-full flex-col items-center justify-center overflow-hidden bg-[#0a0c10] px-8 py-12 sm:px-14 lg:w-[56%]">
        {/* Subtle terracotta corner glows */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#e2562a]/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-8 h-48 w-48 rounded-full bg-[#f0763f]/8 blur-3xl" />

        <div className="relative w-full max-w-md">

          {/* Mobile logo */}
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e2562a] text-white"><Zap size={17} fill="currentColor" /></span>
            <span className="font-bold text-white">Strikfin</span>
          </div>

          {justRegistered ? (
            /* ── Success screen ── */
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400"><Check size={36} strokeWidth={2.5} /></div>
              <h3 className="text-xl font-bold text-emerald-300">Account created!</h3>
              <p className="mt-2 text-sm text-emerald-200/80">
                Your account is ready. Please sign in with your registered email and password.
              </p>
              <p className="mt-4 text-sm font-medium text-slate-600">
                Redirecting in{' '}
                <span className="font-bold text-[#f0763f]">{countdown}</span>s…
              </p>
              <button
                type="button"
                onClick={goToLoginNow}
                className="mt-6 w-full rounded-xl bg-[#e2562a] py-3 text-sm font-semibold text-white transition-all hover:bg-[#b8431f]"
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
              <p className="text-3xl font-bold text-white">Welcome back</p>
              <p className="mt-2 text-sm text-slate-600">
                Sign in to your Strikfin account to continue.
              </p>

              {/* Form */}
              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <LabeledField
                  label="Email or username"
                  icon={AtSign}
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
                <PasswordField
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                />

                {/* Remember me + Forgot */}
                <div className="flex items-center justify-between pt-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 select-none">
                    <input type="checkbox" className="h-4 w-4 rounded border-white/20 bg-white/5 accent-[#e2562a]" />
                    Remember me
                  </label>
                  <button
                    type="button"
                    onClick={() => toast.toast('Development in Progress')}
                    className="text-sm font-medium text-[#f0763f] hover:text-[#e2562a]"
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-[#e2562a] py-3 text-sm font-semibold text-white transition-all hover:bg-[#b8431f] hover:shadow-lg hover:shadow-[#e2562a]/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Please wait…' : 'Log In'}
                </button>
              </form>

              {/* Divider */}
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs text-slate-500">or continue with</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              {/* Social logins — spaced apart */}
              <div className="space-y-3">
                <SocialButton onClick={() => toast.toast('Development in Progress')} fullWidth>
                  <svg viewBox="0 0 24 24" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </SocialButton>

                <SocialButton onClick={() => toast.toast('Development in Progress')} fullWidth>
                  <svg viewBox="0 0 24 24" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
                    <path fill="#F25022" d="M2 2h9.3v9.3H2z"/>
                    <path fill="#7FBA00" d="M12.7 2H22v9.3h-9.3z"/>
                    <path fill="#00A4EF" d="M2 12.7h9.3V22H2z"/>
                    <path fill="#FFB900" d="M12.7 12.7H22V22h-9.3z"/>
                  </svg>
                  Continue with Microsoft
                </SocialButton>
              </div>

              {/* Switch to register */}
              <p className="mt-8 text-center text-sm text-slate-600">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => setTab('register')}
                  className="font-semibold text-[#f0763f] hover:text-[#e2562a]"
                >
                  Sign up free
                </button>
              </p>
            </>
          ) : (
            /* ══════════════════════════════════
               REGISTER VIEW
            ══════════════════════════════════ */
            <>
              {/* Heading */}
              <p className="text-3xl font-bold text-white">Join us</p>
              <p className="mt-0.5 text-3xl font-bold text-white">Create your account</p>
              <p className="mt-2 text-sm text-slate-600">
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
                <label className="flex cursor-pointer items-start gap-2.5 pt-1 text-xs text-slate-600 select-none">
                  <input type="checkbox" required className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-white/5 accent-[#e2562a]" />
                  <span>
                    I agree to Strikfin's{' '}
                    <button type="button" onClick={() => toast.toast('Development in Progress')} className="font-medium text-[#f0763f] hover:underline">Terms of Service</button>
                    {' '}and{' '}
                    <button type="button" onClick={() => toast.toast('Development in Progress')} className="font-medium text-[#f0763f] hover:underline">Privacy Policy</button>.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-[#e2562a] py-3 text-sm font-semibold text-white transition-all hover:bg-[#b8431f] hover:shadow-lg hover:shadow-[#e2562a]/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Please wait…' : 'Sign up'}
                </button>
              </form>

              {/* Divider */}
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs text-slate-500">or continue with</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              {/* Social logins — spaced apart */}
              <div className="space-y-3">
                <SocialButton onClick={() => toast.toast('Development in Progress')} fullWidth>
                  <svg viewBox="0 0 24 24" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </SocialButton>

                <SocialButton onClick={() => toast.toast('Development in Progress')} fullWidth>
                  <svg viewBox="0 0 24 24" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
                    <path fill="#F25022" d="M2 2h9.3v9.3H2z"/>
                    <path fill="#7FBA00" d="M12.7 2H22v9.3h-9.3z"/>
                    <path fill="#00A4EF" d="M2 12.7h9.3V22H2z"/>
                    <path fill="#FFB900" d="M12.7 12.7H22V22h-9.3z"/>
                  </svg>
                  Continue with Microsoft
                </SocialButton>
              </div>

              {/* Switch to login */}
              <p className="mt-8 text-center text-sm text-slate-600">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => setTab('login')}
                  className="font-semibold text-[#f0763f] hover:text-[#e2562a]"
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
      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-sm text-white outline-none transition-all placeholder:text-slate-500 focus:border-[#e2562a] focus:bg-white/[0.07] focus:ring-2 focus:ring-[#e2562a]/25 hover:border-white/20"
    />
  )
}

const INPUT_CLS =
  'w-full rounded-xl border border-white/10 bg-white/5 py-3.5 text-sm text-white outline-none transition-all placeholder:text-slate-500 focus:border-[#e2562a] focus:bg-white/[0.07] focus:ring-2 focus:ring-[#e2562a]/25 hover:border-white/20'

/** Labeled input with a leading icon (e.g. email). */
function LabeledField({
  label, icon: Icon, type, value, onChange, placeholder, required, autoComplete,
}: FieldProps & { label: string; icon: LucideIcon }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-600">{label}</label>
      <div className="relative">
        <Icon size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          autoComplete={autoComplete}
          className={`${INPUT_CLS} pl-11 pr-4`}
        />
      </div>
    </div>
  )
}

/** Password input with a leading lock icon and a show/hide toggle. */
function PasswordField({
  label, value, onChange, placeholder, required, autoComplete,
}: Omit<FieldProps, 'type'> & { label: string }) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-600">{label}</label>
      <div className="relative">
        <Lock size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          autoComplete={autoComplete}
          className={`${INPUT_CLS} pl-11 pr-11`}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-700"
        >
          {show ? <Eye size={17} /> : <EyeOff size={17} />}
        </button>
      </div>
    </div>
  )
}

/** Dark glassy OAuth button used on the form panel. */
function SocialButton({
  children,
  onClick,
  fullWidth,
}: {
  children: React.ReactNode
  onClick: () => void
  fullWidth?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 py-3 text-sm font-semibold text-white transition-all hover:border-white/30 hover:bg-white/15 ${
        fullWidth ? 'w-full gap-3' : ''
      }`}
    >
      {children}
    </button>
  )
}
