/**
 * The collation of the unique name indexes (accounts, categories): case is
 * folded, accents stay distinct. A query that looks a name up has to pass it
 * too, or it neither matches what the index refuses nor uses the index.
 */
export const NAME_COLLATION = { locale: "es", strength: 2 } as const;
