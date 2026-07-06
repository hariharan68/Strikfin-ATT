import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InfoRow } from '../InfoRow'

describe('InfoRow', () => {
  it('renders the edit button only when editable', () => {
    const { rerender } = render(
      <InfoRow label="Name" value="Ada" editable onEdit={() => {}} />,
    )
    expect(screen.getByLabelText('Edit Name')).toBeInTheDocument()

    rerender(<InfoRow label="Name" value="Ada" />)
    expect(screen.queryByLabelText('Edit Name')).not.toBeInTheDocument()
  })

  it('calls onEdit when the edit button is clicked', () => {
    const onEdit = vi.fn()
    render(<InfoRow label="State" value="Goa" editable onEdit={onEdit} />)
    screen.getByLabelText('Edit State').click()
    expect(onEdit).toHaveBeenCalledOnce()
  })
})
