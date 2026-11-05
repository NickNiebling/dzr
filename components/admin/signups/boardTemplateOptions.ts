const MAX_CATEGORIES = 25

export type Category = { emoji: string; label: string; value: string; roleId?: string }

/** Stable signup key. Underscores are safe: the bot splits the button id and keeps the rest as the key. */
export function categoryKey(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

export function categoriesToOptions(categories: Category[]) {
  const options: Array<{ label: string; value: string; emoji?: string; roleId?: string }> = []
  const seen = new Set<string>()
  for (const row of categories) {
    const label = row.label.trim()
    const emoji = row.emoji.trim()
    const typedKey = row.value.trim()
    if (!label && !emoji && !typedKey) continue
    if (!label) throw new Error('Each category needs a name')
    if (label.length > 80) throw new Error(`"${label}" is longer than Discord’s 80-character button limit`)
    const value = categoryKey(typedKey || label)
    if (!value) throw new Error(`"${label}" needs a key made of letters or numbers`)
    if (seen.has(value)) throw new Error(`Two categories would both use the key "${value}"`)
    seen.add(value)
    const option: { label: string; value: string; emoji?: string; roleId?: string } = { label, value }
    if (emoji) option.emoji = emoji
    if (row.roleId) option.roleId = row.roleId
    options.push(option)
  }
  if (options.length === 0) throw new Error('Add at least one category')
  if (options.length > MAX_CATEGORIES) throw new Error(`Discord allows at most ${MAX_CATEGORIES} category buttons`)
  return options
}
