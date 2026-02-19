declare namespace svelteHTML {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-interface
  interface HTMLAttributes<T> {
    // Add any global attributes here if needed
  }
}

declare module '*.svelte' {
  export { SvelteComponent as default } from 'svelte';
}
