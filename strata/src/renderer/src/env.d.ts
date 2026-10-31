/// <reference types="vite/client" />
import type { StrataAPI } from '@shared/api'
import type { JSX as ReactJSX } from 'react'

declare global {
  interface Window {
    strata: StrataAPI
  }
  // React 19 no longer ships the global JSX namespace; keep `JSX.Element` usable.
  namespace JSX {
    type Element = ReactJSX.Element
  }
}

export {}
