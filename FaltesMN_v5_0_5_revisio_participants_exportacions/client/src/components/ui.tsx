import type { ReactNode } from 'react'

const COLORS = {
  greenDark: '#1f5fa8',
  greenMid: '#3b82c4',
  greenLight: '#dbeafe',
  greenSoft: '#eff6ff',
  red: '#c62828',
  redLight: '#fde8e8',
  text: '#1f2937',
  border: '#c8dcc7'
}

export function Button(props: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
  style?: React.CSSProperties
  type?: 'button' | 'submit'
}) {
  const { variant = 'primary' } = props
  const bg = variant === 'danger' ? COLORS.red : variant === 'secondary' ? COLORS.greenLight : COLORS.greenDark
  const color = variant === 'secondary' ? COLORS.greenDark : '#ffffff'
  const border = variant === 'danger' ? '#9f1d1d' : variant === 'secondary' ? '#9dc2ea' : COLORS.greenMid

  return (
    <button
      type={props.type || 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: bg,
        color,
        border: `1px solid ${border}`,
        padding: '10px 12px',
        borderRadius: 10,
        fontWeight: 700,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
        appearance: 'none',
        WebkitAppearance: 'none',
        opacity: props.disabled ? 0.75 : 1,
        ...props.style
      }}
    >
      {props.children}
    </button>
  )
}

export function Input(props: {
  id?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  style?: React.CSSProperties
  type?: React.InputHTMLAttributes<HTMLInputElement>['type']
  autoFocus?: boolean
  inputRef?: React.Ref<HTMLInputElement>
  pattern?: string
  enterKeyHint?: React.HTMLAttributes<HTMLInputElement>['enterKeyHint']
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  onPaste?: React.ClipboardEventHandler<HTMLInputElement>
  min?: number | string
  max?: number | string
  step?: number | string
  maxLength?: number
  autoComplete?: string
  disabled?: boolean
  onBlur?: React.FocusEventHandler<HTMLInputElement>
  onFocus?: React.FocusEventHandler<HTMLInputElement>
}) {
  return (
    <input
      id={props.id}
      ref={props.inputRef}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={props.onKeyDown}
      placeholder={props.placeholder}
      inputMode={props.inputMode}
      type={props.type || 'text'}
      autoFocus={props.autoFocus}
      pattern={props.pattern}
      enterKeyHint={props.enterKeyHint}
      onPaste={props.onPaste}
      min={props.min}
      max={props.max}
      step={props.step}
      maxLength={props.maxLength}
      autoComplete={props.autoComplete}
      disabled={props.disabled}
      onBlur={props.onBlur}
      onFocus={props.onFocus}
      style={{
        width: '100%',
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${COLORS.border}`,
        fontSize: 16,
        background: '#ffffff',
        color: COLORS.text,
        appearance: 'none',
        WebkitAppearance: 'none',
        opacity: props.disabled ? 0.75 : 1,
        ...props.style
      }}
    />
  )
}

export function Card(props: { title?: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: '#f7fcf6',
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: 14,
        boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
        ...props.style
      }}
    >
      {props.title ? (
        <div style={{ fontWeight: 800, marginBottom: 10, fontSize: 16, color: COLORS.text }}>{props.title}</div>
      ) : null}
      {props.children}
    </div>
  )
}

export function Pill(props: { children: ReactNode; bg?: string; fg?: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        background: props.bg || COLORS.greenSoft,
        color: props.fg || COLORS.text,
        fontSize: 12,
        fontWeight: 700,
        border: '1px solid rgba(0,0,0,0.06)'
      }}
    >
      {props.children}
    </span>
  )
}

export function Divider() {
  return <div style={{ height: 1, background: '#d8e6d7', margin: '12px 0' }} />
}

export function BandTitle(props: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: '#111827',
        color: '#ffffff',
        borderRadius: 10,
        padding: '8px 10px',
        fontWeight: 900,
        letterSpacing: 0.4,
        ...props.style
      }}
    >
      {props.children}
    </div>
  )
}
