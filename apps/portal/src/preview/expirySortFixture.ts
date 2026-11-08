import { okAsync } from 'neverthrow'
import { type AddressNameItem, byShownExpiry } from '@/utils/names/addressNames'

const at = (iso: string) => new Date(iso)

const row = (
  name: string,
  expiryDate: Date | null,
  protocolVersion: AddressNameItem['protocolVersion'],
  parentExpiryDate?: Date | null,
): AddressNameItem => ({
  name,
  expiryDate,
  graceEndDate: null,
  status: 'active',
  relations: ['owner'],
  protocolVersion,
  ...(parentExpiryDate !== undefined ? { parentExpiryDate } : {}),
})

/** The six names the expiry-sort preview shows for every address. */
const FIXTURE: readonly AddressNameItem[] = [
  row('dns.com', null, 'ENSv1'),
  row('later.eth', at('2031-01-01T00:00:00Z'), 'ENSv2'),
  row('sub.never.eth', null, 'ENSv1', null),
  row('soon.eth', at('2030-01-01T00:00:00Z'), 'ENSv2'),
  row('sub.parent.eth', null, 'ENSv1', at('2030-06-30T00:00:00Z')),
  row('parent.eth', at('2030-06-30T00:00:00Z'), 'ENSv1'),
]

/** Sorted fixture when the preview flag is exactly `1`. Otherwise the live read. */
export const previewAddressNames = () =>
  import.meta.env.VITE_PREVIEW_EXPIRY_FIXTURE === '1'
    ? okAsync([...FIXTURE].toSorted(byShownExpiry))
    : null
