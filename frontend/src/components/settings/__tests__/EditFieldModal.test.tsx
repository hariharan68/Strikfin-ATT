import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditFieldModal } from '../EditFieldModal'

describe('EditFieldModal', () => {
  it('calls onSave with the edited input value', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <EditFieldModal
        open
        field="name"
        initialValue="Ada"
        onCancel={() => {}}
        onSave={onSave}
      />,
    )

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Grace')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Grace'))
  })

  it('disables Save while the field is empty', async () => {
    const user = userEvent.setup()
    render(
      <EditFieldModal
        open
        field="name"
        initialValue="Ada"
        onCancel={() => {}}
        onSave={vi.fn()}
      />,
    )
    await user.clear(screen.getByRole('textbox'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
