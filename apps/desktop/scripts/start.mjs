// Starts the built desktop app. Clears ELECTRON_RUN_AS_NODE (set by some editors' terminals, e.g.
// VS Code), which would otherwise make Electron run as plain Node and not open the app.
import { spawn } from 'node:child_process';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
