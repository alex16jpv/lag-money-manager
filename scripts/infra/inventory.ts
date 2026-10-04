export function undeclared(inAccount: string[], declared: string[]): string[] {
  return inAccount.filter(
    (name) =>
      !declared.some(
        (id) =>
          id === name ||
          id.endsWith(`/${name}`) ||
          id.endsWith(`:${name}`) ||
          id.endsWith(`|${name}`),
      ),
  );
}
