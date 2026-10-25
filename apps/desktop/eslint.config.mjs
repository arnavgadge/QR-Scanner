// The desktop app uses the web app's lint rules (and its ESLint install: see "lint" in package.json).
import web from '../web/eslint.config.js';

export default [{ ignores: ['build', 'dist', 'node_modules'] }, ...web];
