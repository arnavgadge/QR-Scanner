/**
 * True in the desktop (Electron) build (`vite build --mode desktop`).
 * Where a check guards a desktop-only import, write `import.meta.env.MODE === 'desktop'` inline
 * instead: the bundler only drops the import when the comparison is in the same module.
 */
export const IS_DESKTOP: boolean = import.meta.env.MODE === 'desktop';
