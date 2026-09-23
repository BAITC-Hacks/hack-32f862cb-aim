import { useEffect, useState } from 'react'
import { useWorkspace } from '../store'
import type { Explanation, Product } from '../types'
import { errorMessage } from './format'

export function useExplanation(product?: Product) {
  const ws = useWorkspace()
  const [state, setState] = useState<{ id?: string; explanation: Explanation | null; error: string }>({
    explanation: null,
    error: '',
  })
  useEffect(() => {
    let active = true
    if (!product) return
    ws.getExplanation(product)
      .then((explanation) => {
        if (active) setState({ id: product.recommendationId, explanation, error: '' })
      })
      .catch((e) => {
        if (active) setState({ id: product.recommendationId, explanation: null, error: errorMessage(e) })
      })
    return () => {
      active = false
    }
    // Recommendation IDs are immutable and change when a new plan is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, ws.api])
  return product?.recommendationId === state.id ? state : { explanation: null, error: '' }
}
