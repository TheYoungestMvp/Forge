export function loginDestination(value: string | null | undefined) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(value)
  )
    return "/";
  try {
    const destination = new URL(value, "https://forge.internal");
    if (
      destination.origin !== "https://forge.internal" ||
      /^\/login\/?$/.test(destination.pathname)
    )
      return "/";
    return destination.pathname + destination.search + destination.hash;
  } catch {
    return "/";
  }
}
